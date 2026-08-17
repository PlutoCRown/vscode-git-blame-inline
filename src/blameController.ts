import * as vscode from 'vscode';
import * as path from 'path';
import { readFile } from 'fs/promises';
import { GitService } from './gitService';
import { DecorationProvider } from './decorationProvider';
import { BlameHoverProvider } from './hoverProvider';
import { BlameInfo, RemoteInfo } from './types';
import { t } from './i18n';
import { decodeDiffDocUri, DiffDocProvider } from './diffDocProvider';
import {
  NOTEBOOK_CELL_SCHEME,
  buildNotebookCellSourceLineMaps,
  findNotebookCellRef,
  mapFileBlameToCellBlame,
  notebookRelativePath
} from './notebookUtils';
import {
  GIT_GRAPH_SCHEME,
  isLikelyBinaryDocument,
  parseGitGraphDiffUri,
  parseGitUriQuery
} from './uriUtils';

function isDiffRelatedScheme(scheme: string): boolean {
  return scheme === 'git' ||
    scheme === DiffDocProvider.scheme ||
    scheme === GIT_GRAPH_SCHEME ||
    scheme === NOTEBOOK_CELL_SCHEME;
}

/**
 * Blame 控制器：协调各组件工作
 */
export class BlameController {
  private gitService: GitService;
  private decorationProvider: DecorationProvider;
  private disposables: vscode.Disposable[] = [];
  private blameCache = new Map<string, Map<number, BlameInfo>>();
  private documentInfoCache = new Map<string, {
    cacheKey: string;
    repoPath: string;
    filePath: string;
    commit?: string;
    contents?: string;
    isRangeMode?: boolean;
  }>();
  private documentCacheKeys = new Map<string, Set<string>>();
  private remoteCache = new Map<string, RemoteInfo | null>();
  private enabled = true;
  private rangeBlameThreshold = 500;
  private rangeBlamePadding = 100;
  private updateTimeout: NodeJS.Timeout | undefined;
  private selectionUpdateTimeout: NodeJS.Timeout | undefined;
  private pendingSelectionEditors = new Set<vscode.TextEditor>();

  // 存储当前光标位置的 commit 信息，供命令使用
  static currentCommitHash: string | undefined;
  /** 当前 blame 行在对应 commit 时的仓库内路径（处理 rename） */
  static currentCommitFilePath: string | undefined;
  /** parent 侧路径（rename 发生在该 commit 时） */
  static currentPreviousFilePath: string | undefined;

  constructor(context: vscode.ExtensionContext) {
    this.gitService = new GitService();
    this.decorationProvider = new DecorationProvider();

    // 注册 hover provider
    const hoverProvider = new BlameHoverProvider(
      (document, line) => {
        const key = this.getCacheKey(document);
        if (!key) {
          return undefined;
        }
        const blameMap = this.blameCache.get(key);
        const info = blameMap?.get(line);
        // dirty 时不展示 Not Committed Yet，其余正常
        if (info?.isUncommitted && document.isDirty) {
          return undefined;
        }
        return info;
      },
      (document) => {
        const repoPath = this.getRepoPath(document);
        if (!repoPath) {
          return null;
        }
        return this.remoteCache.get(repoPath) || null;
      }
    );

    this.disposables.push(
      vscode.languages.registerHoverProvider(
        [
          { scheme: 'file' },
          { scheme: DiffDocProvider.scheme },
          { scheme: 'git' },
          { scheme: GIT_GRAPH_SCHEME },
          { scheme: NOTEBOOK_CELL_SCHEME }
        ],
        hoverProvider
      )
    );

    // 监听编辑器切换
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor) {
          this.updateVisibleDiffEditors(editor);
        }
      })
    );

    // Diff 两侧进入可见列表时再刷一次（SCM 打开时左侧可能尚未成为 active）
    // 稍延迟，避免与内置 Git 读取 blob / 二进制预览抢同一时机
    this.disposables.push(
      vscode.window.onDidChangeVisibleTextEditors(editors => {
        const hasDiff = editors.some(e => isDiffRelatedScheme(e.document.uri.scheme));
        if (!hasDiff) {
          return;
        }

        if (this.updateTimeout) {
          clearTimeout(this.updateTimeout);
        }
        this.updateTimeout = setTimeout(() => {
          for (const editor of vscode.window.visibleTextEditors) {
            this.updateBlame(editor);
          }
        }, 250);
      })
    );

    // Notebook Diff / 编辑器切 cell 时刷新聚焦 cell 的 blame
    this.disposables.push(
      vscode.window.onDidChangeNotebookEditorSelection(event => {
        if (!this.enabled) {
          return;
        }
        this.updateActiveNotebookCellBlame(event.notebookEditor);
      })
    );
    this.disposables.push(
      vscode.window.onDidChangeActiveNotebookEditor(editor => {
        if (!this.enabled || !editor) {
          return;
        }
        this.updateActiveNotebookCellBlame(editor);
      })
    );

    // 监听光标位置变化：优先使用已缓存的 blame 信息同步更新，保证多光标移动时装饰实时刷新
    // 缓存未命中时不立即 spawn git blame，而是防抖 300ms 后批量执行，
    // 避免大文件上光标快速移动时堆积数十个 git 进程
    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection(event => {
        if (!this.enabled) {
          return;
        }

        const hasDiff = vscode.window.visibleTextEditors.some(
          e => isDiffRelatedScheme(e.document.uri.scheme)
        );
        const editors = hasDiff
          ? vscode.window.visibleTextEditors
          : [event.textEditor];

        for (const editor of editors) {
          if (!this.updateDecorationsFromCachedBlame(editor)) {
            this.pendingSelectionEditors.add(editor);
          }
        }

        if (this.pendingSelectionEditors.size > 0) {
          if (this.selectionUpdateTimeout) {
            clearTimeout(this.selectionUpdateTimeout);
          }
          this.selectionUpdateTimeout = setTimeout(() => {
            for (const editor of this.pendingSelectionEditors) {
              this.updateBlame(editor);
            }
            this.pendingSelectionEditors.clear();
            this.selectionUpdateTimeout = undefined;
          }, 300);
        }
      })
    );

    // 监听文档变化（清除缓存并延迟刷新；dirty 时仍显示已提交行的 blame）
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument(event => {
        this.clearDocumentCaches(event.document.uri);
        this.scheduleDocumentUpdate(event.document);
      })
    );

    // 监听文档保存（刷新 blame，此时未提交行才显示 Not Committed Yet）
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument(document => {
        const editor = vscode.window.visibleTextEditors.find(
          e => e.document.uri.toString() === document.uri.toString()
        );
        if (editor) {
          this.clearDocumentCaches(document.uri);
          this.updateBlame(editor);
        }
      })
    );

    // Notebook 保存后按 cell id 重新映射 blame
    this.disposables.push(
      vscode.workspace.onDidSaveNotebookDocument(notebook => {
        this.clearDocumentCaches(notebook.uri);
        this.refreshNotebookEditors(notebook.uri.fsPath);
      })
    );

    // Notebook 结构 / 内容变更：清缓存并延迟刷新可见 cell
    this.disposables.push(
      vscode.workspace.onDidChangeNotebookDocument(event => {
        this.clearDocumentCaches(event.notebook.uri);
        if (this.updateTimeout) {
          clearTimeout(this.updateTimeout);
        }
        this.updateTimeout = setTimeout(() => {
          this.refreshNotebookEditors(event.notebook.uri.fsPath);
        }, 200);
      })
    );

    // 读取配置
    const config = vscode.workspace.getConfiguration('gitBlameInline');
    this.enabled = config.get('enabled', true);
    this.rangeBlameThreshold = config.get('rangeBlameThreshold', 500);
    this.rangeBlamePadding = config.get('rangeBlamePadding', 100);

    // 监听配置变化
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('gitBlameInline.rangeBlameThreshold')) {
          const config = vscode.workspace.getConfiguration('gitBlameInline');
          this.rangeBlameThreshold = config.get('rangeBlameThreshold', 500);
        }
        if (event.affectsConfiguration('gitBlameInline.rangeBlamePadding')) {
          const config = vscode.workspace.getConfiguration('gitBlameInline');
          this.rangeBlamePadding = config.get('rangeBlamePadding', 100);
        }
        if (event.affectsConfiguration('gitBlameInline.enabled')) {
          const config = vscode.workspace.getConfiguration('gitBlameInline');
          this.enabled = config.get('enabled', true);

          // 更新当前编辑器
          const editor = vscode.window.activeTextEditor;
          if (editor) {
            if (this.enabled) {
              this.updateBlame(editor);
            } else {
              this.decorationProvider.clearDecorations(editor);
            }
          }
        }
      })
    );

    // 初始化当前编辑器
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
      this.updateBlame(activeEditor);
    }
  }

  /**
   * 更新编辑器的 blame 信息
   */
  private updateVisibleDiffEditors(editor: vscode.TextEditor): void {
    const hasDiff = vscode.window.visibleTextEditors.some(
      e => isDiffRelatedScheme(e.document.uri.scheme)
    );
    if (isDiffRelatedScheme(editor.document.uri.scheme) || hasDiff) {
      vscode.window.visibleTextEditors.forEach(e => this.updateBlame(e));
    } else {
      this.updateBlame(editor);
    }
  }

  private async updateBlame(editor: vscode.TextEditor): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const document = editor.document;

    if (document.uri.scheme === NOTEBOOK_CELL_SCHEME) {
      await this.updateNotebookCellBlame(editor);
      return;
    }

    // 二进制 / 媒体文件不做 blame，也不去 git show 整文件，避免干扰内置 Diff 预览
    if (isLikelyBinaryDocument(document)) {
      this.decorationProvider.clearDecorations(editor);
      return;
    }

    const info = await this.getDocumentInfo(document);
    if (!info) {
      return;
    }

    // 大文件（如 lockfile）使用行范围 blame，只查光标附近 ±padding 行，避免全量 blame
    const useRangeMode = document.lineCount > this.rangeBlameThreshold;
    info.isRangeMode = useRangeMode;

    let cacheKey = info.cacheKey;
    let lineRange: { start: number; end: number } | undefined;

    if (useRangeMode) {
      const cursorLine = editor.selections[0]?.active.line ?? 0;
      const startLine = Math.max(1, cursorLine + 1 - this.rangeBlamePadding);
      const endLine = Math.min(document.lineCount, cursorLine + 1 + this.rangeBlamePadding);
      lineRange = { start: startLine, end: endLine };
      cacheKey = `${info.cacheKey}::L${startLine}-${endLine}`;
    }

    this.documentInfoCache.set(document.uri.toString(), { ...info, cacheKey });

    try {
      // dirty 时用编辑器内容对齐行号；未改动的行仍显示已提交 blame
      const blameMap = await this.gitService.getBlameForRepoFile(
        info.repoPath,
        info.filePath,
        info.commit,
        cacheKey,
        info.contents ??
        (document.uri.scheme === 'file' && document.isDirty ? document.getText() : undefined),
        lineRange
      );

      // 获取远程仓库信息（如果还没有缓存）
      if (!this.remoteCache.has(info.repoPath)) {
        const remoteUrl = await this.gitService.getRemoteUrlForRepo(info.repoPath);
        if (remoteUrl) {
          const remoteInfo = this.gitService.parseRemoteUrl(remoteUrl);
          this.remoteCache.set(info.repoPath, remoteInfo);
        } else {
          this.remoteCache.set(info.repoPath, null);
        }
      }

      if (blameMap) {
        if (!document.isDirty) {
          await this.applyUncommittedTimestamps(document, blameMap);
        }
        this.trackDocumentCacheKey(document.uri.fsPath, cacheKey);
        this.blameCache.set(cacheKey, blameMap);
        this.decorationProvider.updateDecorations(editor, blameMap);
      } else {
        this.decorationProvider.clearDecorations(editor);
      }
    } catch (error) {
      console.error('Failed to update blame:', error);
    }
  }

  /**
   * 仅对当前聚焦的 notebook cell 显示 blame（按 cell id 映射到 .ipynb 文件行）
   * 支持工作区 file: 与 Diff/SCM 中的 git: notebook（左右两侧均可连续跳转）
   */
  private async updateNotebookCellBlame(editor: vscode.TextEditor): Promise<void> {
    const document = editor.document;
    const ref = findNotebookCellRef(document);
    if (!ref) {
      this.decorationProvider.clearDecorations(editor);
      return;
    }

    const repoPath = await this.gitService.getRepositoryRoot(ref.notebookFsPath);
    if (!repoPath) {
      this.decorationProvider.clearDecorations(editor);
      return;
    }

    const filePath = notebookRelativePath(repoPath, ref.notebookFsPath);
    const target = await this.resolveNotebookBlameTarget(ref.notebook.uri, repoPath, filePath);
    if (!target) {
      this.decorationProvider.clearDecorations(editor);
      return;
    }

    const cellCacheKey = `${repoPath}::${filePath}::${target.fileCacheKeySuffix}::cell:${ref.cellId}::v${document.version}`;
    const fileCacheKey = `${repoPath}::${filePath}::${target.fileCacheKeySuffix}`;

    this.documentInfoCache.set(document.uri.toString(), {
      cacheKey: cellCacheKey,
      repoPath,
      filePath
    });

    try {
      const lineMaps = buildNotebookCellSourceLineMaps(target.raw);
      const sourceFileLines = lineMaps.get(ref.cellId);
      if (!sourceFileLines || sourceFileLines.length === 0) {
        this.decorationProvider.clearDecorations(editor);
        return;
      }

      const fileBlame = await this.gitService.getBlameForRepoFile(
        repoPath,
        filePath,
        target.commit,
        fileCacheKey,
        target.contents
      );

      await this.ensureRemoteCached(repoPath);

      if (!fileBlame) {
        this.decorationProvider.clearDecorations(editor);
        return;
      }

      const cellBlame = mapFileBlameToCellBlame(fileBlame, sourceFileLines);

      if (target.isWorkingTree) {
        const isDirty = target.isDirty || ref.notebook.isDirty || document.isDirty;
        if (!isDirty) {
          await this.applyUncommittedTimestampsForPath(ref.notebookFsPath, cellBlame);
        } else {
          for (const [line, info] of [...cellBlame.entries()]) {
            if (info.isUncommitted) {
              cellBlame.delete(line);
            }
          }
        }
      }

      this.trackDocumentCacheKey(ref.notebookFsPath, fileCacheKey);
      this.trackDocumentCacheKey(ref.notebookFsPath, cellCacheKey);
      this.blameCache.set(cellCacheKey, cellBlame);
      this.decorationProvider.updateDecorations(editor, cellBlame);
    } catch (error) {
      console.error('Failed to update notebook cell blame:', error);
    }
  }

  private async resolveNotebookBlameTarget(
    notebookUri: vscode.Uri,
    repoPath: string,
    filePath: string
  ): Promise<{
    raw: string;
    commit?: string;
    contents?: string;
    fileCacheKeySuffix: string;
    isWorkingTree: boolean;
    isDirty: boolean;
  } | null> {
    if (notebookUri.scheme === 'file') {
      let raw: string;
      try {
        raw = await readFile(notebookUri.fsPath, 'utf8');
      } catch {
        return null;
      }
      const notebook = vscode.workspace.notebookDocuments.find(
        n => n.uri.toString() === notebookUri.toString()
      );
      return {
        raw,
        fileCacheKeySuffix: 'working-tree',
        isWorkingTree: true,
        isDirty: notebook?.isDirty ?? false
      };
    }

    if (notebookUri.scheme === 'git') {
      const { ref: queryRef } = parseGitUriQuery(notebookUri);
      const resolved = await this.gitService.resolveGitUriBlameTarget(
        repoPath,
        filePath,
        queryRef
      );
      if (!resolved) {
        return null;
      }

      if (resolved.contents !== undefined) {
        return {
          raw: resolved.contents,
          contents: resolved.contents,
          fileCacheKeySuffix: resolved.cacheKeySuffix,
          isWorkingTree: false,
          isDirty: false
        };
      }

      const commit = resolved.commit ?? 'HEAD';
      const raw = await this.gitService.getFileContentsAtCommit(repoPath, filePath, commit);
      if (raw === null) {
        return null;
      }
      return {
        raw,
        commit,
        fileCacheKeySuffix: resolved.cacheKeySuffix,
        isWorkingTree: false,
        isDirty: false
      };
    }

    return null;
  }

  private updateActiveNotebookCellBlame(notebookEditor: vscode.NotebookEditor): void {
    const selection = notebookEditor.selections[0];
    if (!selection) {
      return;
    }
    const cell = notebookEditor.notebook.cellAt(selection.start);
    const cellUri = cell.document.uri.toString();
    const editor =
      vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === cellUri) ??
      (vscode.window.activeTextEditor?.document.uri.toString() === cellUri
        ? vscode.window.activeTextEditor
        : undefined);
    if (editor) {
      void this.updateBlame(editor);
    }
  }

  private refreshNotebookEditors(notebookFsPath: string): void {
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.scheme !== NOTEBOOK_CELL_SCHEME) {
        continue;
      }
      const ref = findNotebookCellRef(editor.document);
      if (ref?.notebookFsPath === notebookFsPath) {
        void this.updateBlame(editor);
      }
    }
  }

  private async ensureRemoteCached(repoPath: string): Promise<void> {
    if (this.remoteCache.has(repoPath)) {
      return;
    }
    const remoteUrl = await this.gitService.getRemoteUrlForRepo(repoPath);
    if (remoteUrl) {
      this.remoteCache.set(repoPath, this.gitService.parseRemoteUrl(remoteUrl));
    } else {
      this.remoteCache.set(repoPath, null);
    }
  }

  private async applyUncommittedTimestamps(
    document: vscode.TextDocument,
    blameMap: Map<number, BlameInfo>
  ): Promise<void> {
    const fsPath = document.uri.scheme === 'file' ? document.uri.fsPath : undefined;
    await this.applyUncommittedTimestampsForPath(fsPath, blameMap);
  }

  private async applyUncommittedTimestampsForPath(
    fsPath: string | undefined,
    blameMap: Map<number, BlameInfo>
  ): Promise<void> {
    const hasUncommitted = [...blameMap.values()].some(info => info.isUncommitted);
    if (!hasUncommitted) {
      return;
    }

    // 仅在已保存文件上展示未提交行，时间取文件 mtime
    const timestamp =
      (fsPath ? await this.gitService.getFileMtimeSeconds(fsPath) : null) ??
      Math.floor(Date.now() / 1000);

    for (const info of blameMap.values()) {
      if (info.isUncommitted) {
        info.timestamp = timestamp;
      }
    }
  }

  private updateDecorationsFromCachedBlame(editor: vscode.TextEditor): boolean {
    const docInfo = this.documentInfoCache.get(editor.document.uri.toString());
    if (!docInfo) {
      return false;
    }

    const blameMap = this.blameCache.get(docInfo.cacheKey);
    if (!blameMap) {
      return false;
    }

    // 范围模式下，当前光标可能已移出已缓存的行范围；
    // 若所有光标行都不在 blameMap 中，返回 false 触发重新查询
    if (docInfo.isRangeMode) {
      const hasCurrentLine = editor.selections.some(s => blameMap.has(s.active.line + 1));
      if (!hasCurrentLine) {
        return false;
      }
    }

    this.decorationProvider.updateDecorations(editor, blameMap);
    return true;
  }

  private async getDocumentInfo(document: vscode.TextDocument): Promise<{
    cacheKey: string;
    repoPath: string;
    filePath: string;
    commit?: string;
    contents?: string;
    isRangeMode?: boolean;
  } | null> {
    if (document.uri.scheme === 'file') {
      const repoPath = await this.gitService.getRepositoryRoot(document.uri.fsPath);
      if (!repoPath) {
        return null;
      }

      const filePath = path.relative(repoPath, document.uri.fsPath);
      return {
        cacheKey: `${repoPath}::${filePath}::working-tree::v${document.version}`,
        repoPath,
        filePath
      };
    }

    if (document.uri.scheme === DiffDocProvider.scheme) {
      const data = decodeDiffDocUri(document.uri);
      if (!data.exists) {
        return null;
      }
      return {
        cacheKey: `${data.repo}::${data.filePath}::${data.commit}`,
        repoPath: data.repo,
        filePath: data.filePath,
        commit: data.commit
      };
    }

    if (document.uri.scheme === GIT_GRAPH_SCHEME) {
      const data = parseGitGraphDiffUri(document.uri);
      if (!data?.exists) {
        return null;
      }
      return {
        cacheKey: `${data.repo}::${data.filePath}::${data.commit}`,
        repoPath: data.repo,
        filePath: data.filePath,
        commit: data.commit
      };
    }

    if (document.uri.scheme === 'git') {
      const { path: queryPath, ref: queryRef } = parseGitUriQuery(document.uri);
      const fsPath = queryPath ?? document.uri.fsPath;

      // 二进制 git: 文档：不要 resolve（会 git show 整 blob）
      if (isLikelyBinaryDocument(document)) {
        return null;
      }

      const repoPath = await this.gitService.getRepositoryRoot(fsPath);
      if (!repoPath) {
        return null;
      }

      const filePath = path.relative(repoPath, fsPath).split(path.sep).join('/');
      const target = await this.gitService.resolveGitUriBlameTarget(repoPath, filePath, queryRef);
      if (!target) {
        return null;
      }

      return {
        cacheKey: `${repoPath}::${filePath}::${target.cacheKeySuffix}`,
        repoPath,
        filePath,
        commit: target.commit,
        contents: target.contents
      };
    }

    return null;
  }

  private getCacheKey(document: vscode.TextDocument): string | null {
    return this.documentInfoCache.get(document.uri.toString())?.cacheKey ?? null;
  }

  private getRepoPath(document: vscode.TextDocument): string | null {
    return this.documentInfoCache.get(document.uri.toString())?.repoPath ?? null;
  }

  private trackDocumentCacheKey(documentPath: string, cacheKey: string): void {
    const keys = this.documentCacheKeys.get(documentPath) ?? new Set<string>();
    keys.add(cacheKey);
    this.documentCacheKeys.set(documentPath, keys);
  }

  private clearDocumentCaches(documentUri: vscode.Uri): void {
    const documentPath = documentUri.fsPath;
    const cacheKeys = this.documentCacheKeys.get(documentPath);

    if (cacheKeys) {
      for (const cacheKey of cacheKeys) {
        this.gitService.clearCache(cacheKey);
        this.blameCache.delete(cacheKey);
      }
      this.documentCacheKeys.delete(documentPath);
    }

    this.documentInfoCache.delete(documentUri.toString());
    this.gitService.clearCache(documentPath);
    this.blameCache.delete(documentPath);
  }

  private clearDocumentDecorations(document: vscode.TextDocument): void {
    vscode.window.visibleTextEditors
      .filter(editor => editor.document.uri.toString() === document.uri.toString())
      .forEach(editor => this.decorationProvider.clearDecorations(editor));
  }

  private scheduleDocumentUpdate(document: vscode.TextDocument): void {
    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout);
    }

    this.updateTimeout = setTimeout(() => {
      vscode.window.visibleTextEditors
        .filter(editor => editor.document.uri.toString() === document.uri.toString())
        .forEach(editor => this.updateBlame(editor));
    }, 200);
  }

  /**
   * 切换 blame 显示
   */
  toggle(): void {
    this.enabled = !this.enabled;

    // 更新配置
    const config = vscode.workspace.getConfiguration('gitBlameInline');
    config.update('enabled', this.enabled, vscode.ConfigurationTarget.Global);

    // 更新所有可见编辑器
    if (this.enabled) {
      vscode.window.visibleTextEditors.forEach(editor => {
        this.updateBlame(editor);
      });
    } else {
      vscode.window.visibleTextEditors.forEach(editor => {
        this.decorationProvider.clearDecorations(editor);
      });
    }

    vscode.window.showInformationMessage(
      this.enabled ? t.success.enabled : t.success.disabled
    );
  }

  /**
   * 释放资源
   */
  dispose(): void {
    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout);
    }
    if (this.selectionUpdateTimeout) {
      clearTimeout(this.selectionUpdateTimeout);
    }
    this.pendingSelectionEditors.clear();
    this.disposables.forEach(d => d.dispose());
    this.decorationProvider.dispose();
    this.gitService.clearAllCache();
  }
}
