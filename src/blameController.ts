import * as vscode from 'vscode';
import * as path from 'path';
import { GitService } from './gitService';
import { DecorationProvider } from './decorationProvider';
import { BlameHoverProvider } from './hoverProvider';
import { BlameInfo, RemoteInfo } from './types';
import { t } from './i18n';
import { decodeDiffDocUri, DiffDocProvider } from './diffDocProvider';
import { isLikelyBinaryDocument, parseGitUriQuery } from './uriUtils';

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
  }>();
  private documentCacheKeys = new Map<string, Set<string>>();
  private remoteCache = new Map<string, RemoteInfo | null>();
  private enabled = true;
  private updateTimeout: NodeJS.Timeout | undefined;

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
        [{ scheme: 'file' }, { scheme: DiffDocProvider.scheme }, { scheme: 'git' }],
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
        const hasDiff = editors.some(
          e => e.document.uri.scheme === 'git' || e.document.uri.scheme === DiffDocProvider.scheme
        );
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

    // 监听光标位置变化：优先使用已缓存的 blame 信息同步更新，保证多光标移动时装饰实时刷新
    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection(event => {
        if (!this.enabled) {
          return;
        }

        const hasGitDiff = vscode.window.visibleTextEditors.some(
          e => e.document.uri.scheme === 'git'
        );
        const isDiff = event.textEditor.document.uri.scheme === DiffDocProvider.scheme;
        const editors = isDiff || hasGitDiff
          ? vscode.window.visibleTextEditors
          : [event.textEditor];

        for (const editor of editors) {
          if (!this.updateDecorationsFromCachedBlame(editor)) {
            this.updateBlame(editor);
          }
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

    // 读取配置
    const config = vscode.workspace.getConfiguration('gitBlameInline');
    this.enabled = config.get('enabled', true);

    // 监听配置变化
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration(event => {
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
    const hasGitDiff = vscode.window.visibleTextEditors.some(
      e => e.document.uri.scheme === 'git'
    );
    if (editor.document.uri.scheme === DiffDocProvider.scheme || hasGitDiff) {
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

    // 二进制 / 媒体文件不做 blame，也不去 git show 整文件，避免干扰内置 Diff 预览
    if (isLikelyBinaryDocument(document)) {
      this.decorationProvider.clearDecorations(editor);
      return;
    }

    const info = await this.getDocumentInfo(document);
    if (!info) {
      return;
    }

    this.documentInfoCache.set(document.uri.toString(), info);

    try {
      // dirty 时用编辑器内容对齐行号；未改动的行仍显示已提交 blame
      const blameMap = await this.gitService.getBlameForRepoFile(
        info.repoPath,
        info.filePath,
        info.commit,
        info.cacheKey,
        info.contents ??
        (document.uri.scheme === 'file' && document.isDirty ? document.getText() : undefined)
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
        this.trackDocumentCacheKey(document.uri.fsPath, info.cacheKey);
        this.blameCache.set(info.cacheKey, blameMap);
        this.decorationProvider.updateDecorations(editor, blameMap);
      } else {
        this.decorationProvider.clearDecorations(editor);
      }
    } catch (error) {
      console.error('Failed to update blame:', error);
    }
  }

  private async applyUncommittedTimestamps(
    document: vscode.TextDocument,
    blameMap: Map<number, BlameInfo>
  ): Promise<void> {
    const hasUncommitted = [...blameMap.values()].some(info => info.isUncommitted);
    if (!hasUncommitted) {
      return;
    }

    // 仅在已保存文件上展示未提交行，时间取文件 mtime
    const timestamp =
      (document.uri.scheme === 'file'
        ? await this.gitService.getFileMtimeSeconds(document.uri.fsPath)
        : null) ?? Math.floor(Date.now() / 1000);

    for (const info of blameMap.values()) {
      if (info.isUncommitted) {
        info.timestamp = timestamp;
      }
    }
  }

  private updateDecorationsFromCachedBlame(editor: vscode.TextEditor): boolean {
    const key = this.getCacheKey(editor.document);
    if (!key) {
      return false;
    }

    const blameMap = this.blameCache.get(key);
    if (!blameMap) {
      return false;
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
    this.disposables.forEach(d => d.dispose());
    this.decorationProvider.dispose();
    this.gitService.clearAllCache();
  }
}
