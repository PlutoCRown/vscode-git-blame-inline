import * as vscode from 'vscode';
import { readFile } from 'fs/promises';
import { GitService } from './gitService';
import { DecorationProvider } from './decorationProvider';
import { BlameHoverProvider } from './hoverProvider';
import { BlameInfo, RemoteInfo } from './types';
import { t } from './i18n';
import {
  NOTEBOOK_CELL_SCHEME,
  buildNotebookCellSourceMaps,
  findNotebookCellRef,
  mapFileBlameToCellBlame
} from './notebookUtils';
import { alignCurrentLinesToSavedFileLines } from './lineAlignment';
import { isLikelyBinaryPath } from './uriUtils';
import { getBlameLineRange } from './rangeUtils';
import { ResolvedGitUri, UriResolverRegistry } from './uriResolverRegistry';

const MAX_CACHE_KEYS_PER_DOCUMENT = 8;

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
    workingTreePath: string;
    isWorkingTree: boolean;
    useDirtyDocumentContents?: boolean;
  }>();
  private documentCacheKeys = new Map<string, Set<string>>();
  private remoteCache = new Map<string, RemoteInfo | null>();
  private enabled = true;
  private notebookEnabled = true;
  private rangeBlameThreshold = 500;
  private rangeBlamePadding = 100;
  private updateTimeout: NodeJS.Timeout | undefined;
  private selectionUpdateTimeout: NodeJS.Timeout | undefined;
  private pendingSelectionEditors = new Set<vscode.TextEditor>();

  constructor(
    context: vscode.ExtensionContext,
    gitService: GitService,
    private readonly uriResolvers: UriResolverRegistry
  ) {
    this.gitService = gitService;
    this.decorationProvider = new DecorationProvider();

    // 注册 hover provider
    const hoverProvider = new BlameHoverProvider(
      (document, line) => {
        if (
          document.uri.scheme === NOTEBOOK_CELL_SCHEME &&
          !this.notebookEnabled
        ) {
          return undefined;
        }
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
        this.uriResolvers.getSchemes().map(scheme => ({ scheme })),
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
        const hasNotebookCells = editors.some(
          editor => editor.document.uri.scheme === NOTEBOOK_CELL_SCHEME
        );
        const hasDiff = editors.some(e =>
          this.uriResolvers.isDiffRelatedScheme(e.document.uri.scheme)
        );
        if (!hasDiff && !hasNotebookCells) {
          return;
        }

        if (this.updateTimeout) {
          clearTimeout(this.updateTimeout);
        }
        this.updateTimeout = setTimeout(() => {
          if (hasNotebookCells) {
            this.synchronizeVisibleNotebookCellBlame();
          }
          if (hasDiff) {
            for (const editor of vscode.window.visibleTextEditors) {
              if (editor.document.uri.scheme === NOTEBOOK_CELL_SCHEME) {
                continue;
              }
              this.updateBlame(editor);
            }
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
        if (!this.enabled) {
          return;
        }
        if (editor) {
          this.updateActiveNotebookCellBlame(editor);
        } else {
          this.clearInactiveVisibleNotebookCellDecorations();
        }
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

        this.clearInactiveVisibleNotebookCellDecorations();

        const hasDiff = vscode.window.visibleTextEditors.some(
          e => this.uriResolvers.isDiffRelatedScheme(e.document.uri.scheme)
        );
        const editors = hasDiff
          ? vscode.window.visibleTextEditors.filter(
              editor =>
                editor.document.uri.scheme !== NOTEBOOK_CELL_SCHEME ||
                this.isSelectedNotebookCell(editor.document.uri)
            )
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

    this.disposables.push(
      vscode.workspace.onDidCloseTextDocument(document => {
        this.clearDocumentCaches(document.uri);
      })
    );

    // Notebook 保存后按 cell id 重新映射 blame
    this.disposables.push(
      vscode.workspace.onDidSaveNotebookDocument(notebook => {
        this.clearNotebookCaches(notebook);
        this.refreshNotebookEditors(notebook.uri);
      })
    );

    // Notebook 结构 / 内容变更：清缓存并延迟刷新可见 cell
    this.disposables.push(
      vscode.workspace.onDidChangeNotebookDocument(event => {
        this.clearNotebookCaches(event.notebook);
        if (this.updateTimeout) {
          clearTimeout(this.updateTimeout);
        }
        this.updateTimeout = setTimeout(() => {
          this.refreshNotebookEditors(event.notebook.uri);
        }, 200);
      })
    );
    this.disposables.push(
      vscode.workspace.onDidCloseNotebookDocument(notebook => {
        this.clearNotebookCaches(notebook);
      })
    );

    // 读取配置
    const config = vscode.workspace.getConfiguration('gitBlameInline');
    this.enabled = config.get('enabled', true);
    this.notebookEnabled = config.get('notebookEnabled', true);
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
        if (event.affectsConfiguration('gitBlameInline.notebookEnabled')) {
          const config = vscode.workspace.getConfiguration('gitBlameInline');
          this.notebookEnabled = config.get('notebookEnabled', true);
          if (this.enabled && this.notebookEnabled) {
            this.synchronizeVisibleNotebookCellBlame();
          } else {
            this.disableNotebookBlame();
          }
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
    if (editor.document.uri.scheme === NOTEBOOK_CELL_SCHEME) {
      this.synchronizeVisibleNotebookCellBlame();
      return;
    }

    const hasDiff = vscode.window.visibleTextEditors.some(
      e => this.uriResolvers.isDiffRelatedScheme(e.document.uri.scheme)
    );
    if (this.uriResolvers.isDiffRelatedScheme(editor.document.uri.scheme) || hasDiff) {
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
    if (this.isLikelyBinaryDocument(document)) {
      this.decorationProvider.clearDecorations(editor);
      return;
    }

    const info = await this.getDocumentInfo(document);
    if (!info) {
      return;
    }

    // 大文件（如 lockfile）使用行范围 blame，只查光标附近 ±padding 行，避免全量 blame
    const cursorLine = editor.selections[0]?.active.line ?? 0;
    const lineRange = getBlameLineRange(
      document.lineCount,
      cursorLine,
      this.rangeBlameThreshold,
      this.rangeBlamePadding
    );
    const useRangeMode = lineRange !== undefined;
    info.isRangeMode = useRangeMode;

    let cacheKey = info.cacheKey;

    if (lineRange) {
      cacheKey = `${info.cacheKey}::L${lineRange.start}-${lineRange.end}`;
    }

    this.documentInfoCache.set(document.uri.toString(), { ...info, cacheKey });
    this.trackDocumentCacheKey(this.getDocumentCacheTrackingKey(document.uri), cacheKey);

    try {
      // dirty 时用编辑器内容对齐行号；未改动的行仍显示已提交 blame
      const blameMap = await this.gitService.getBlameForRepoFile(
        info.repoPath,
        info.filePath,
        info.commit,
        cacheKey,
        info.contents ??
        (info.useDirtyDocumentContents && document.isDirty ? document.getText() : undefined),
        lineRange
      );

      // A newer selection/document update may have replaced this request while Git was running.
      if (this.documentInfoCache.get(document.uri.toString())?.cacheKey !== cacheKey) {
        return;
      }

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
          await this.applyUncommittedTimestampsForPath(
            info.isWorkingTree ? info.workingTreePath : undefined,
            blameMap
          );
        }
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
   * 仅对当前聚焦的 notebook cell 显示 blame（按 cell 结构映射到 .ipynb 文件行）
   * 支持工作区 file: 与 Diff/SCM 中的 git: notebook（左右两侧均可连续跳转）
   */
  private async updateNotebookCellBlame(editor: vscode.TextEditor): Promise<void> {
    const document = editor.document;
    if (!this.shouldShowNotebookCellBlame(document.uri)) {
      this.decorationProvider.clearDecorations(editor);
      return;
    }

    const ref = findNotebookCellRef(document);
    if (!ref) {
      this.decorationProvider.clearDecorations(editor);
      return;
    }

    const resolved = await this.uriResolvers.resolve(document.uri, document);
    if (!resolved) {
      this.decorationProvider.clearDecorations(editor);
      return;
    }

    const { repoPath, filePath } = resolved;
    const target = await this.materializeNotebookBlameTarget(ref.notebook, resolved);
    if (!target) {
      this.decorationProvider.clearDecorations(editor);
      return;
    }
    if (!this.shouldShowNotebookCellBlame(document.uri)) {
      this.decorationProvider.clearDecorations(editor);
      return;
    }

    const cellCacheKey = `${repoPath}::${filePath}::${target.fileCacheKeySuffix}::cell:${ref.cellId}::v${document.version}`;
    const fileCacheKey = `${repoPath}::${filePath}::${target.fileCacheKeySuffix}`;

    this.documentInfoCache.set(document.uri.toString(), {
      cacheKey: cellCacheKey,
      repoPath,
      filePath,
      workingTreePath: target.workingTreePath,
      isWorkingTree: target.isWorkingTree
    });
    this.trackDocumentCacheKey(
      this.getDocumentCacheTrackingKey(ref.notebook.uri),
      fileCacheKey
    );
    this.trackDocumentCacheKey(
      this.getDocumentCacheTrackingKey(document.uri),
      cellCacheKey
    );

    try {
      const sourceMaps = buildNotebookCellSourceMaps(target.raw);
      const sourceMap = sourceMaps.get(ref.cellId);
      if (!sourceMap || sourceMap.fileLines.length === 0) {
        this.decorationProvider.clearDecorations(editor);
        return;
      }

      const isDirty =
        target.isWorkingTree &&
        (target.isDirty || ref.notebook.isDirty || document.isDirty);
      const sourceFileLines = isDirty
        ? alignCurrentLinesToSavedFileLines(
            sourceMap.source,
            document.getText(),
            sourceMap.fileLines
          )
        : sourceMap.fileLines;

      const fileBlame = await this.gitService.getBlameForRepoFile(
        repoPath,
        filePath,
        target.commit,
        fileCacheKey,
        target.contents
      );

      if (this.documentInfoCache.get(document.uri.toString())?.cacheKey !== cellCacheKey) {
        return;
      }

      if (!this.shouldShowNotebookCellBlame(document.uri)) {
        this.decorationProvider.clearDecorations(editor);
        return;
      }

      await this.ensureRemoteCached(repoPath);

      if (!fileBlame) {
        this.decorationProvider.clearDecorations(editor);
        return;
      }

      const cellBlame = mapFileBlameToCellBlame(fileBlame, sourceFileLines);

      if (target.isWorkingTree) {
        if (!isDirty) {
          await this.applyUncommittedTimestampsForPath(target.workingTreePath, cellBlame);
        } else {
          for (const [line, info] of [...cellBlame.entries()]) {
            if (info.isUncommitted) {
              cellBlame.delete(line);
            }
          }
        }
      }

      if (!this.shouldShowNotebookCellBlame(document.uri)) {
        this.decorationProvider.clearDecorations(editor);
        return;
      }

      this.blameCache.set(cellCacheKey, cellBlame);
      this.decorationProvider.updateDecorations(editor, cellBlame);
    } catch (error) {
      console.error('Failed to update notebook cell blame:', error);
    }
  }

  private async materializeNotebookBlameTarget(
    notebook: vscode.NotebookDocument,
    resolved: ResolvedGitUri
  ): Promise<{
    raw: string;
    commit?: string;
    contents?: string;
    fileCacheKeySuffix: string;
    isWorkingTree: boolean;
    isDirty: boolean;
    workingTreePath: string;
  } | null> {
    if (resolved.contents !== undefined) {
      return {
        raw: resolved.contents,
        contents: resolved.contents,
        fileCacheKeySuffix: resolved.cacheKeySuffix,
        isWorkingTree: resolved.isWorkingTree,
        isDirty: false,
        workingTreePath: resolved.workingTreePath
      };
    }

    if (resolved.isWorkingTree) {
      let raw: string;
      try {
        raw = await readFile(resolved.workingTreePath, 'utf8');
      } catch {
        return null;
      }
      return {
        raw,
        fileCacheKeySuffix: resolved.cacheKeySuffix,
        isWorkingTree: true,
        isDirty: notebook.isDirty,
        workingTreePath: resolved.workingTreePath
      };
    }

    const commit = resolved.commit ?? 'HEAD';
    const raw = await this.gitService.getFileContentsAtCommit(
      resolved.repoPath,
      resolved.filePath,
      commit
    );
    if (raw === null) {
      return null;
    }
    return {
      raw,
      commit,
      fileCacheKeySuffix: resolved.cacheKeySuffix,
      isWorkingTree: false,
      isDirty: false,
      workingTreePath: resolved.workingTreePath
    };
  }

  private updateActiveNotebookCellBlame(notebookEditor: vscode.NotebookEditor): void {
    void notebookEditor;
    this.synchronizeVisibleNotebookCellBlame();
  }

  private refreshNotebookEditors(notebookUri: vscode.Uri): void {
    void notebookUri;
    this.synchronizeVisibleNotebookCellBlame();
  }

  /** Keep decorations only on the selected cell of each visible NotebookEditor. */
  private synchronizeVisibleNotebookCellBlame(): void {
    if (!this.enabled || !this.notebookEnabled) {
      this.clearVisibleNotebookCellDecorations();
      return;
    }

    const selectedCellUris = this.clearInactiveVisibleNotebookCellDecorations();
    for (const editor of vscode.window.visibleTextEditors) {
      if (
        editor.document.uri.scheme === NOTEBOOK_CELL_SCHEME &&
        selectedCellUris.has(editor.document.uri.toString())
      ) {
        void this.updateBlame(editor);
      }
    }
  }

  private clearInactiveVisibleNotebookCellDecorations(): Set<string> {
    const selectedCellUris = this.getSelectedNotebookCellUris();

    for (const editor of [...this.pendingSelectionEditors]) {
      if (
        editor.document.uri.scheme === NOTEBOOK_CELL_SCHEME &&
        !selectedCellUris.has(editor.document.uri.toString())
      ) {
        this.pendingSelectionEditors.delete(editor);
      }
    }

    for (const editor of vscode.window.visibleTextEditors) {
      if (
        editor.document.uri.scheme === NOTEBOOK_CELL_SCHEME &&
        !selectedCellUris.has(editor.document.uri.toString())
      ) {
        this.decorationProvider.clearDecorations(editor);
      }
    }

    return selectedCellUris;
  }

  private clearVisibleNotebookCellDecorations(): void {
    for (const editor of [...this.pendingSelectionEditors]) {
      if (editor.document.uri.scheme === NOTEBOOK_CELL_SCHEME) {
        this.pendingSelectionEditors.delete(editor);
      }
    }

    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.scheme === NOTEBOOK_CELL_SCHEME) {
        this.decorationProvider.clearDecorations(editor);
      }
    }
  }

  private disableNotebookBlame(): void {
    this.clearVisibleNotebookCellDecorations();
    for (const notebook of vscode.workspace.notebookDocuments) {
      this.clearNotebookCaches(notebook);
    }
  }

  private getSelectedNotebookCellUris(): Set<string> {
    const selectedCellUris = new Set<string>();
    for (const notebookEditor of vscode.window.visibleNotebookEditors) {
      const selection = notebookEditor.selections[0];
      if (
        !selection ||
        selection.start < 0 ||
        selection.start >= notebookEditor.notebook.cellCount
      ) {
        continue;
      }
      selectedCellUris.add(
        notebookEditor.notebook.cellAt(selection.start).document.uri.toString()
      );
    }
    return selectedCellUris;
  }

  private isSelectedNotebookCell(cellUri: vscode.Uri): boolean {
    return this.getSelectedNotebookCellUris().has(cellUri.toString());
  }

  private shouldShowNotebookCellBlame(cellUri: vscode.Uri): boolean {
    return this.enabled && this.notebookEnabled && this.isSelectedNotebookCell(cellUri);
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
    if (
      editor.document.uri.scheme === NOTEBOOK_CELL_SCHEME &&
      !this.shouldShowNotebookCellBlame(editor.document.uri)
    ) {
      this.pendingSelectionEditors.delete(editor);
      this.decorationProvider.clearDecorations(editor);
      return true;
    }

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
    workingTreePath: string;
    isWorkingTree: boolean;
    useDirtyDocumentContents?: boolean;
  } | null> {
    const resolved = await this.uriResolvers.resolve(document.uri, document);
    if (!resolved) {
      return null;
    }

    const versionSuffix = resolved.cacheDocumentVersion
      ? `::v${document.version}`
      : '';
    return {
      cacheKey: `${resolved.repoPath}::${resolved.filePath}::${resolved.cacheKeySuffix}${versionSuffix}`,
      repoPath: resolved.repoPath,
      filePath: resolved.filePath,
      commit: resolved.commit,
      contents: resolved.contents,
      workingTreePath: resolved.workingTreePath,
      isWorkingTree: resolved.isWorkingTree,
      useDirtyDocumentContents: resolved.useDirtyDocumentContents
    };
  }

  private isLikelyBinaryDocument(document: vscode.TextDocument): boolean {
    if (document.languageId === 'binary') {
      return true;
    }
    const candidatePath =
      this.uriResolvers.getPath(document.uri) ??
      document.uri.fsPath ??
      document.uri.path;
    return isLikelyBinaryPath(candidatePath);
  }

  private getCacheKey(document: vscode.TextDocument): string | null {
    return this.documentInfoCache.get(document.uri.toString())?.cacheKey ?? null;
  }

  private getRepoPath(document: vscode.TextDocument): string | null {
    return this.documentInfoCache.get(document.uri.toString())?.repoPath ?? null;
  }

  private getDocumentCacheTrackingKey(uri: vscode.Uri): string {
    return uri.toString();
  }

  private trackDocumentCacheKey(documentKey: string, cacheKey: string): void {
    const keys = this.documentCacheKeys.get(documentKey) ?? new Set<string>();
    keys.add(cacheKey);
    this.documentCacheKeys.set(documentKey, keys);

    while (keys.size > MAX_CACHE_KEYS_PER_DOCUMENT) {
      const oldestKey = keys.values().next().value as string | undefined;
      if (!oldestKey) {
        break;
      }
      keys.delete(oldestKey);
      this.gitService.clearCache(oldestKey);
      this.blameCache.delete(oldestKey);
    }
  }

  private clearDocumentCaches(documentUri: vscode.Uri): void {
    const documentKey = this.getDocumentCacheTrackingKey(documentUri);
    const cacheKeys = this.documentCacheKeys.get(documentKey);

    if (cacheKeys) {
      for (const cacheKey of cacheKeys) {
        this.gitService.clearCache(cacheKey);
        this.blameCache.delete(cacheKey);
      }
      this.documentCacheKeys.delete(documentKey);
    }

    this.documentInfoCache.delete(documentUri.toString());
  }

  private clearNotebookCaches(notebook: vscode.NotebookDocument): void {
    this.clearDocumentCaches(notebook.uri);
    for (const cell of notebook.getCells()) {
      this.clearDocumentCaches(cell.document.uri);
    }
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
