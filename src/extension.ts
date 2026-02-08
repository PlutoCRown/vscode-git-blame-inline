import * as vscode from 'vscode';
import { BlameController } from './blameController';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

let blameController: BlameController | undefined;

/**
 * 扩展激活
 */
export function activate(context: vscode.ExtensionContext) {
  console.log('Git Blame Inline extension is now active');

  // 创建 Blame 控制器
  blameController = new BlameController(context);
  context.subscriptions.push(blameController);

  // 注册切换命令
  const toggleCommand = vscode.commands.registerCommand('git-blame-inline.toggle', () => {
    blameController?.toggle();
  });
  context.subscriptions.push(toggleCommand);

  // 注册查看 commit diff 命令（参数是 string，不是对象）
  const showCommitDiffCommand = vscode.commands.registerCommand(
    'git-blame-inline.showCommitDiff',
    async (commitHash: string) => {
      await showCommitDiff(commitHash);
    }
  );
  context.subscriptions.push(showCommitDiffCommand);

  // 注册 Stash 命令
  const stashAllCommand = vscode.commands.registerCommand(
    'git-blame-inline.stashAllChanges',
    async () => {
      await stashAllChanges();
    }
  );
  context.subscriptions.push(stashAllCommand);
}

/**
 * 显示 commit 的差异
 */
async function showCommitDiff(commitHash: string): Promise<void> {
  try {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('没有打开的编辑器');
      return;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('文件不在工作区中');
      return;
    }

    const cwd = workspaceFolder.uri.fsPath;

    // 尝试使用 VSCode 内置的 Git 扩展 API
    const gitExtension = vscode.extensions.getExtension('vscode.git');
    if (gitExtension) {
      const git = gitExtension.exports.getAPI(1);
      const repo = git.repositories.find((r: any) => 
        editor.document.uri.fsPath.startsWith(r.rootUri.fsPath)
      );

      if (repo) {
        try {
          // 使用 Git 扩展的 show 命令
          await vscode.commands.executeCommand('git.openChange', commitHash);
          return;
        } catch (err) {
          console.log('git.openChange failed, trying alternatives', err);
        }
      }
    }

    // 备选方案：在终端中显示
    const result = await vscode.window.showInformationMessage(
      `查看提交 ${commitHash.substring(0, 8)}`,
      '在终端查看',
      '取消'
    );

    if (result === '在终端查看') {
      const terminal = vscode.window.createTerminal('Git Show');
      terminal.show();
      terminal.sendText(`cd "${cwd}" && git show ${commitHash}`);
    }
  } catch (error) {
    console.error('Failed to show commit diff:', error);
    vscode.window.showErrorMessage(`无法显示提交差异: ${error}`);
  }
}

/**
 * Stash 所有更改（包括未跟踪文件）
 */
async function stashAllChanges(): Promise<void> {
  try {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showErrorMessage('没有打开的工作区');
      return;
    }

    const cwd = workspaceFolders[0].uri.fsPath;
    const timestamp = new Date().toLocaleString('zh-CN');

    // 执行 git stash 命令
    await execFileAsync('git', [
      'stash',
      'push',
      '--include-untracked',
      '-m',
      `Stashed at ${timestamp}`
    ], { cwd });

    vscode.window.showInformationMessage('✅ 所有更改已暂存（包括未跟踪文件）');
  } catch (error: any) {
    console.error('Failed to stash changes:', error);
    vscode.window.showErrorMessage(`暂存失败: ${error.message}`);
  }
}

/**
 * 扩展停用
 */
export function deactivate() {
  blameController?.dispose();
}
