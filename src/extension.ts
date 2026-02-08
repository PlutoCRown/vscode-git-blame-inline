import * as vscode from 'vscode';
import { BlameController } from './blameController';
import { DiffDocProvider, encodeDiffDocUri } from './diffDocProvider';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execFileAsync = promisify(execFile);

let blameController: BlameController | undefined;
let diffDocProvider: DiffDocProvider | undefined;

/**
 * 扩展激活
 */
export function activate(context: vscode.ExtensionContext) {
  console.log('Git Blame Inline extension is now active');

  // 注册 Diff 文档提供器
  diffDocProvider = new DiffDocProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      DiffDocProvider.scheme,
      diffDocProvider
    )
  );

  // 创建 Blame 控制器
  blameController = new BlameController(context);
  context.subscriptions.push(blameController);

  // 注册切换命令
  const toggleCommand = vscode.commands.registerCommand('git-blame-inline.toggle', () => {
    blameController?.toggle();
  });
  context.subscriptions.push(toggleCommand);

  // 注册查看 commit diff 命令
  const showCommitDiffCommand = vscode.commands.registerCommand(
    'git-blame-inline.showCommitDiff',
    async (commitHash?: string) => {
      // 如果没有传递参数，从全局变量获取
      const hash = commitHash || (await import('./blameController')).BlameController.currentCommitHash;
      console.log('showCommitDiff called with:', hash, 'type:', typeof hash);
      if (hash) {
        await showCommitDiff(hash);
      } else {
        vscode.window.showErrorMessage('无法获取 commit 信息');
      }
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
  if (!commitHash || typeof commitHash !== 'string') {
    vscode.window.showErrorMessage('无法显示提交差异: 缺少 commit hash');
    console.error('showCommitDiff called with invalid commitHash:', commitHash);
    return;
  }

  try {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('无法显示提交差异: 没有打开的编辑器');
      return;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('无法显示提交差异: 文件不在工作区中');
      return;
    }

    const cwd = workspaceFolder.uri.fsPath;
    const filePath = editor.document.uri.fsPath;
    const relativeFilePath = path.relative(cwd, filePath);

    // 获取父 commit hash
    let parentHash: string;
    try {
      const { stdout: parentStdout } = await execFileAsync('git', ['rev-parse', `${commitHash}^`], { cwd });
      parentHash = parentStdout.trim();
    } catch (error) {
      // 如果是第一个 commit，没有父 commit，则与空树比较
      parentHash = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'; // Git empty tree hash
    }

    const fileName = path.basename(filePath);
    const shortHash = commitHash.substring(0, 8);
    const shortParentHash = parentHash.substring(0, 8);

    // 使用自定义的 DiffDocProvider 创建 URI
    const leftUri = encodeDiffDocUri(cwd, relativeFilePath, parentHash, true);
    const rightUri = encodeDiffDocUri(cwd, relativeFilePath, commitHash, true);

    await vscode.commands.executeCommand(
      'vscode.diff',
      leftUri,
      rightUri,
      `${fileName} (${shortParentHash} ↔ ${shortHash})`,
      { preview: true }
    );

  } catch (error: any) {
    console.error('Failed to show commit diff:', error);
    vscode.window.showErrorMessage(`无法显示提交差异: ${error.message || error}`);
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
