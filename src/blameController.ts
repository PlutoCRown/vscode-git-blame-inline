import * as vscode from 'vscode';
import { GitService } from './gitService';
import { DecorationProvider } from './decorationProvider';
import { BlameHoverProvider } from './hoverProvider';
import { BlameInfo, RemoteInfo } from './types';

/**
 * Blame 控制器：协调各组件工作
 */
export class BlameController {
  private gitService: GitService;
  private decorationProvider: DecorationProvider;
  private disposables: vscode.Disposable[] = [];
  private blameCache = new Map<string, Map<number, BlameInfo>>();
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
        const blameMap = this.blameCache.get(document.uri.fsPath);
        return blameMap?.get(line);
      },
      (document) => {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        if (!workspaceFolder) {
          return null;
        }
        return this.remoteCache.get(workspaceFolder.uri.fsPath) || null;
      }
    );
    
    this.disposables.push(
      vscode.languages.registerHoverProvider({ scheme: 'file' }, hoverProvider)
    );

    // 监听编辑器切换
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor) {
          this.updateBlame(editor);
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
          this.updateBlame(event.textEditor);
        }, 50);
      })
    );

    // 监听文档变化（清除缓存）
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument(event => {
        const filePath = event.document.uri.fsPath;
        this.gitService.clearCache(filePath);
        this.blameCache.delete(filePath);
      })
    );

    // 监听文档保存（更新 blame）
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument(document => {
        const editor = vscode.window.visibleTextEditors.find(
          e => e.document.uri.fsPath === document.uri.fsPath
        );
        if (editor) {
          this.gitService.clearCache(document.uri.fsPath);
          this.blameCache.delete(document.uri.fsPath);
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
    
    // 只处理文件 scheme
    if (document.uri.scheme !== 'file') {
      return;
    }

    // 检查是否在 Git 仓库中
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) {
      return;
    }

    try {
      // 获取 blame 信息
      const blameMap = await this.gitService.getBlameForFile(document);
      
      // 获取远程仓库信息（如果还没有缓存）
      if (!this.remoteCache.has(workspaceFolder.uri.fsPath)) {
        const remoteUrl = await this.gitService.getRemoteUrl(workspaceFolder);
        if (remoteUrl) {
          const remoteInfo = this.gitService.parseRemoteUrl(remoteUrl);
          this.remoteCache.set(workspaceFolder.uri.fsPath, remoteInfo);
        } else {
          this.remoteCache.set(workspaceFolder.uri.fsPath, null);
        }
      }
      
      if (blameMap) {
        this.blameCache.set(document.uri.fsPath, blameMap);
        this.decorationProvider.updateDecorations(editor, blameMap);
      } else {
        this.decorationProvider.clearDecorations(editor);
      }
    } catch (error) {
      console.error('Failed to update blame:', error);
    }
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
      `Git Blame Inline ${this.enabled ? '已启用' : '已禁用'}`
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
