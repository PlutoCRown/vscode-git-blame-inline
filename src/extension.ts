import * as vscode from 'vscode';
import { BlameController } from './blameController';
import { DiffDocProvider, decodeDiffDocUri, encodeDiffDocUri } from './diffDocProvider';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { t } from './i18n';

const execFileAsync = promisify(execFile);

let blameController: BlameController | undefined;
let diffDocProvider: DiffDocProvider | undefined;

/**
 * 扩展激活
 */
export function activate(context: vscode.ExtensionContext) {
  console.log('Git Blame Lite extension is now active');

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
  const toggleCommand = vscode.commands.registerCommand('git-blame-lite.toggle', () => {
    blameController?.toggle();
  });
  context.subscriptions.push(toggleCommand);

  // 注册查看 commit diff 命令
  const showCommitDiffCommand = vscode.commands.registerCommand(
    'git-blame-lite.showCommitDiff',
    async (commitHash?: string) => {
      // 如果没有传递参数，从全局变量获取
      const hash = commitHash || (await import('./blameController')).BlameController.currentCommitHash;
      console.log('showCommitDiff called with:', hash, 'type:', typeof hash);
      if (hash) {
        await showCommitDiff(hash);
      } else {
        vscode.window.showErrorMessage(t.error.noCommitHash);
      }
    }
  );
  context.subscriptions.push(showCommitDiffCommand);

  // 注册 Stash 命令
  const stashCommand = vscode.commands.registerCommand(
    'git-blame-lite.stashChanges',
    async (...args: any[]) => {
      await stashChanges(args[0]);
    }
  );
  context.subscriptions.push(stashCommand);
}

/**
 * 显示 commit 的差异
 */
async function showCommitDiff(commitHash: string): Promise<void> {
  if (!commitHash || typeof commitHash !== 'string') {
    vscode.window.showErrorMessage(`${t.error.showDiffFailed}: ${t.error.noCommitHash}`);
    console.error('showCommitDiff called with invalid commitHash:', commitHash);
    return;
  }

  try {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage(t.error.noEditor);
      return;
    }

    let cwd: string;
    let relativeFilePath: string;
    let fileName: string;

    if (editor.document.uri.scheme === DiffDocProvider.scheme) {
      const data = decodeDiffDocUri(editor.document.uri);
      if (!data.exists) {
        vscode.window.showErrorMessage(t.error.notInWorkspace);
        return;
      }
      cwd = data.repo;
      relativeFilePath = data.filePath;
      fileName = path.basename(relativeFilePath);
    } else if (editor.document.uri.scheme === 'git') {
      let queryPath: string | undefined;
      try {
        const data = JSON.parse(editor.document.uri.query) as { path?: string };
        queryPath = data.path;
      } catch {}

      const fsPath = queryPath ?? editor.document.uri.fsPath;
      const fileUri = vscode.Uri.file(fsPath);
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);
      if (!workspaceFolder) {
        vscode.window.showErrorMessage(t.error.notInWorkspace);
        return;
      }
      cwd = workspaceFolder.uri.fsPath;
      relativeFilePath = path.relative(cwd, fsPath);
      fileName = path.basename(fsPath);
    } else {
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
      if (!workspaceFolder) {
        vscode.window.showErrorMessage(t.error.notInWorkspace);
        return;
      }
      cwd = workspaceFolder.uri.fsPath;
      const filePath = editor.document.uri.fsPath;
      relativeFilePath = path.relative(cwd, filePath);
      fileName = path.basename(filePath);
    }

    // 获取父 commit hash
    let parentHash: string;
    try {
      const { stdout: parentStdout } = await execFileAsync('git', ['rev-parse', `${commitHash}^`], { cwd });
      parentHash = parentStdout.trim();
    } catch (error) {
      // 如果是第一个 commit，没有父 commit，则与空树比较
      parentHash = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'; // Git empty tree hash
    }

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
    vscode.window.showErrorMessage(`${t.error.showDiffFailed}: ${error.message || error}`);
  }
}

/**
 * Stash 更改
 */
async function stashChanges(resourceGroup: any): Promise<void> {
  try {
    console.log('stashChanges called with:', resourceGroup);

    // 获取 Git 扩展 API
    const gitExtension = vscode.extensions.getExtension('vscode.git');
    if (!gitExtension) {
      vscode.window.showErrorMessage(t.error.noGitExtension);
      return;
    }

    const git = gitExtension.exports.getAPI(1);
    if (git.repositories.length === 0) {
      vscode.window.showErrorMessage(t.error.noRepository);
      return;
    }

    // 获取当前仓库
    const repo = git.repositories[0];
    const cwd = repo.rootUri.fsPath;

    // 判断是哪个资源组
    const groupId = resourceGroup?.id;
    console.log('Resource group ID:', groupId);

    let isStaged = false;
    let groupLabel = t.stash.unstaged;

    if (groupId === 'index') {
      isStaged = true;
      groupLabel = t.stash.staged;
    } else if (groupId === 'workingTree') {
      isStaged = false;
      groupLabel = t.stash.unstaged;
    } else {
      // 如果无法识别资源组，提示用户选择
      const choice = await vscode.window.showQuickPick(
        [
          { label: t.stash.staged, value: 'staged' },
          { label: t.stash.unstaged, value: 'unstaged' }
        ],
        { placeHolder: t.stash.selectType }
      );

      if (!choice) {
        return;
      }

      isStaged = choice.value === 'staged';
      groupLabel = choice.label;
    }

    // 弹出输入框让用户输入 stash 消息
    const message = await vscode.window.showInputBox({
      prompt: `${t.stash.inputMessage}（${groupLabel}）`,
      placeHolder: t.stash.inputPlaceholder,
      value: `Stashed ${groupLabel} at ${new Date().toLocaleString()}`
    });

    // 用户取消了输入
    if (message === undefined) {
      return;
    }

    // 根据资源组类型执行不同的 stash 命令
    if (isStaged) {
      // Stash 暂存的更改
      await execFileAsync('git', [
        'stash',
        'push',
        '--staged',
        '-m',
        message || t.stash.defaultStagedMessage
      ], { cwd });
      console.log(t.success.stagedStashed);
    } else {
      // Stash 未暂存的更改（包括未跟踪的文件）
      await execFileAsync('git', [
        'stash',
        'push',
        '--keep-index',
        '--include-untracked',
        '-m',
        message || t.stash.defaultUnstagedMessage
      ], { cwd });
      console.log(t.success.unstagedStashed);
    }

  } catch (error: any) {
    console.error('Failed to stash changes:', error);
    vscode.window.showErrorMessage(`${t.error.stashFailed}: ${error.message}`);
  }
}

/**
 * 扩展停用
 */
export function deactivate() {
  blameController?.dispose();
}
