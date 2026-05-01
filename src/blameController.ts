import * as vscode from 'vscode';
import * as path from 'path';
import { GitService } from './gitService';
import { DecorationProvider } from './decorationProvider';
import { BlameHoverProvider } from './hoverProvider';
import { BlameInfo, RemoteInfo } from './types';
import { t } from './i18n';
import { decodeDiffDocUri, DiffDocProvider } from './diffDocProvider';
import { parseGitUriQuery } from './uriUtils';

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
  }>();
  private documentCacheKeys = new Map<string, Set<string>>();
  private remoteCache = new Map<string, RemoteInfo | null>();
  private enabled = true;
  private updateTimeout: NodeJS.Timeout | undefined;
  
  // 存储当前光标位置的 commit hash，供命令使用
  static currentCommitHash: string | undefined;

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
        return blameMap?.get(line);
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
          const hasGitDiff = vscode.window.visibleTextEditors.some(
            e => e.document.uri.scheme === 'git'
          );
          if (editor.document.uri.scheme === DiffDocProvider.scheme || hasGitDiff) {
            vscode.window.visibleTextEditors
              .forEach(e => this.updateBlame(e));
          } else {
            this.updateBlame(editor);
          }
        }
      })
    );

    // 监听光标位置变化（使用防抖避免过于频繁的更新）
    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection(event => {
        // 清除之前的定时器
        if (this.updateTimeout) {
          clearTimeout(this.updateTimeout);
        }
        // 使用防抖延迟更新，不立即清除装饰以避免闪烁
        this.updateTimeout = setTimeout(() => {
          const hasGitDiff = vscode.window.visibleTextEditors.some(
            e => e.document.uri.scheme === 'git'
          );
          const isDiff = event.textEditor.document.uri.scheme === DiffDocProvider.scheme;
          if (isDiff || hasGitDiff) {
            vscode.window.visibleTextEditors.forEach(editor => this.updateBlame(editor));
          } else {
            this.updateBlame(event.textEditor);
          }
        }, 50);
      })
    );

    // 监听文档变化（清除缓存）
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument(event => {
        this.clearDocumentCaches(event.document.uri);
        this.clearDocumentDecorations(event.document);
      })
    );

    // 监听文档保存（更新 blame）
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument(document => {
        const editor = vscode.window.visibleTextEditors.find(
          e => e.document.uri.fsPath === document.uri.fsPath
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
  private async updateBlame(editor: vscode.TextEditor): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const document = editor.document;

    if (document.uri.scheme === 'file' && document.isDirty) {
      this.decorationProvider.clearDecorations(editor);
      return;
    }
    
    const info = await this.getDocumentInfo(document);
    if (!info) {
      return;
    }

    this.documentInfoCache.set(document.uri.toString(), info);

    try {
      // 获取 blame 信息
      const blameMap = await this.gitService.getBlameForRepoFile(
        info.repoPath,
        info.filePath,
        info.commit,
        info.cacheKey
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

  private async getDocumentInfo(document: vscode.TextDocument): Promise<{
    cacheKey: string;
    repoPath: string;
    filePath: string;
    commit?: string;
  } | null> {
    if (document.uri.scheme === 'file') {
      const repoPath = await this.gitService.getRepositoryRoot(document.uri.fsPath);
      if (!repoPath) {
        return null;
      }

      const filePath = path.relative(repoPath, document.uri.fsPath);
      return {
        cacheKey: `${repoPath}::${filePath}::working-tree`,
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
      const repoPath = await this.gitService.getRepositoryRoot(fsPath);
      if (!repoPath) {
        return null;
      }

      const filePath = path.relative(repoPath, fsPath);
      return {
        cacheKey: `${repoPath}::${filePath}::${queryRef ?? 'git'}`,
        repoPath,
        filePath,
        commit: queryRef
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
