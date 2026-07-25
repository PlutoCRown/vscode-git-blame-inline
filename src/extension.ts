import * as vscode from 'vscode';
import { BlameController } from './blameController';
import { DiffDocProvider, decodeDiffDocUri, encodeDiffDocUri } from './diffDocProvider';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { t } from './i18n';
import { GitService } from './gitService';
import { findRepositoryForPath, getFilePathFromUri } from './uriUtils';
import { findNotebookCellRef, NOTEBOOK_CELL_SCHEME } from './notebookUtils';
import { UNCOMMITTED_HASH } from './types';

const execFileAsync = promisify(execFile);
const gitService = new GitService();

let blameController: BlameController | undefined;
let diffDocProvider: DiffDocProvider | undefined;

type GitApi = {
  repositories: Array<{ rootUri: vscode.Uri }>;
  toGitUri(uri: vscode.Uri, ref: string): vscode.Uri;
};

type GitBlameStashChoice = {
  label: string;
  value: 'staged' | 'unstaged';
};

type StashResourceState = {
  resourceUri?: vscode.Uri;
};

type StashResourceGroup = {
  id?: string;
  resourceStates?: ReadonlyArray<StashResourceState>;
  sourceControl?: { rootUri?: vscode.Uri };
  provider?: { rootUri?: vscode.Uri };
  repository?: { rootUri?: vscode.Uri };
};

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
      const { BlameController } = await import('./blameController');
      // 如果没有传递参数，从全局变量获取
      const hash = commitHash || BlameController.currentCommitHash;
      const pathAtCommit = BlameController.currentCommitFilePath;
      const previousPath = BlameController.currentPreviousFilePath;
      console.log('showCommitDiff called with:', hash, pathAtCommit, previousPath);
      if (hash) {
        await showCommitDiff(hash, pathAtCommit, previousPath);
      } else {
        vscode.window.showErrorMessage(t.error.noCommitHash);
      }
    }
  );
  context.subscriptions.push(showCommitDiffCommand);

  // 注册 Stash 命令
  const stashCommand = vscode.commands.registerCommand(
    'git-blame-lite.stashChanges',
    async (...args: unknown[]) => {
      await stashChanges(args[0] as StashResourceGroup | undefined);
    }
  );
  context.subscriptions.push(stashCommand);
}

/**
 * 显示 commit 的差异
 */
async function showCommitDiff(
  commitHash: string,
  pathAtCommit?: string,
  previousPath?: string
): Promise<void> {
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

    const resolved = await resolveDiffContext(editor);
    if (!resolved) {
      vscode.window.showErrorMessage(t.error.notInWorkspace);
      return;
    }
    const { cwd, relativeFilePath, workingTreeUri } = resolved;

    // 未提交改动：对比 HEAD ↔ 工作区文件
    if (commitHash === UNCOMMITTED_HASH) {
      const fileName = path.basename(relativeFilePath);
      await showUncommittedDiff(cwd, relativeFilePath, fileName, workingTreeUri);
      return;
    }

    // rename 后应用历史路径：blame 的 filename 是该 commit 时的路径
    const rightPath = (pathAtCommit || relativeFilePath).split(path.sep).join('/');

    // 获取父 commit hash
    let parentHash: string;
    try {
      const { stdout: parentStdout } = await execFileAsync('git', ['rev-parse', `${commitHash}^`], { cwd });
      parentHash = parentStdout.trim();
    } catch {
      parentHash = '4b825dc642cb6eb9a060e54bf8d34988fbee4904'; // Git empty tree hash
    }

    // parent 侧路径：若该 commit 发生了 rename，则用 previous；否则与 right 相同
    let leftPath = rightPath;
    const rightExists = await pathExistsInCommit(cwd, commitHash, rightPath);
    let leftExists = await pathExistsInCommit(cwd, parentHash, leftPath);
    if (!leftExists && previousPath) {
      const normalizedPrevious = previousPath.split(path.sep).join('/');
      if (await pathExistsInCommit(cwd, parentHash, normalizedPrevious)) {
        leftPath = normalizedPrevious;
        leftExists = true;
      }
    }

    const shortHash = commitHash.substring(0, 8);
    const shortParentHash = parentHash.substring(0, 8);
    const titleName = path.basename(rightPath);

    // 优先用内置 git: URI（与 SCM「打开更改」相同），notebook / 媒体可走富 Diff
    const leftUri = leftExists
      ? await toGitUri(vscode.Uri.file(path.join(cwd, leftPath)), parentHash)
      : encodeDiffDocUri(cwd, leftPath, parentHash, false);
    const rightUri = rightExists
      ? await toGitUri(vscode.Uri.file(path.join(cwd, rightPath)), commitHash)
      : encodeDiffDocUri(cwd, rightPath, commitHash, false);

    await vscode.commands.executeCommand(
      'vscode.diff',
      leftUri,
      rightUri,
      `${titleName} (${shortParentHash} ↔ ${shortHash})`,
      { preview: true }
    );

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Failed to show commit diff:', error);
    vscode.window.showErrorMessage(`${t.error.showDiffFailed}: ${msg}`);
  }
}

async function pathExistsInCommit(
  cwd: string,
  commit: string,
  filePath: string
): Promise<boolean> {
  try {
    await execFileAsync('git', ['cat-file', '-e', `${commit}:${filePath}`], { cwd });
    return true;
  } catch {
    return false;
  }
}

/**
 * 从当前编辑器解析仓库路径与工作区文件 URI（含 notebook cell / git: Diff）
 */
async function resolveDiffContext(editor: vscode.TextEditor): Promise<{
  cwd: string;
  relativeFilePath: string;
  workingTreeUri: vscode.Uri;
} | null> {
  const uri = editor.document.uri;

  if (uri.scheme === DiffDocProvider.scheme) {
    const data = decodeDiffDocUri(uri);
    if (!data.exists) {
      return null;
    }
    return {
      cwd: data.repo,
      relativeFilePath: data.filePath,
      workingTreeUri: vscode.Uri.file(path.join(data.repo, data.filePath))
    };
  }

  if (uri.scheme === NOTEBOOK_CELL_SCHEME) {
    const cellRef = findNotebookCellRef(editor.document);
    if (!cellRef) {
      return null;
    }
    const repoPath = await gitService.getRepositoryRoot(cellRef.notebookFsPath);
    if (!repoPath) {
      return null;
    }
    return {
      cwd: repoPath,
      relativeFilePath: path.relative(repoPath, cellRef.notebookFsPath).split(path.sep).join('/'),
      workingTreeUri: vscode.Uri.file(cellRef.notebookFsPath)
    };
  }

  if (uri.scheme === 'git') {
    const fsPath = getFilePathFromUri(uri) ?? uri.fsPath;
    const repoPath = await gitService.getRepositoryRoot(fsPath);
    if (!repoPath) {
      return null;
    }
    return {
      cwd: repoPath,
      relativeFilePath: path.relative(repoPath, fsPath).split(path.sep).join('/'),
      workingTreeUri: vscode.Uri.file(fsPath)
    };
  }

  if (uri.scheme === 'file') {
    const repoPath = await gitService.getRepositoryRoot(uri.fsPath);
    if (!repoPath) {
      return null;
    }
    return {
      cwd: repoPath,
      relativeFilePath: path.relative(repoPath, uri.fsPath).split(path.sep).join('/'),
      workingTreeUri: uri
    };
  }

  return null;
}

/** 构造与内置 Git 扩展一致的 git: URI，供 vscode.diff 打开富 Diff */
async function toGitUri(fileUri: vscode.Uri, ref: string): Promise<vscode.Uri> {
  const git = await getGitApi();
  if (git?.toGitUri) {
    return git.toGitUri(fileUri, ref);
  }
  return fileUri.with({
    scheme: 'git',
    query: JSON.stringify({ path: fileUri.fsPath, ref })
  });
}

async function showUncommittedDiff(
  _cwd: string,
  _relativeFilePath: string,
  fileName: string,
  workingTreeUri: vscode.Uri
): Promise<void> {
  // 与 SCM「打开更改」相同：左侧 git:（ref=~），右侧工作区文件。
  // 右侧必须是真实 file URI，不能指向 rename 后已删除的旧路径。
  const gitUri = workingTreeUri.with({
    scheme: 'git',
    query: JSON.stringify({ path: workingTreeUri.fsPath, ref: '~' })
  });
  await vscode.commands.executeCommand(
    'vscode.diff',
    gitUri,
    workingTreeUri,
    `${fileName} (${t.diff.workingTree})`,
    { preview: true }
  );
}

/**
 * Stash 更改
 */
async function stashChanges(resourceGroup?: StashResourceGroup) {
  try {
    console.log('stashChanges called with:', resourceGroup);

    // 获取 Git 扩展 API
    const git = await getGitApi();
    if (!git) {
      vscode.window.showErrorMessage(t.error.noGitExtension);
      return;
    }

    const cwd = await resolveStashRepositoryRoot(resourceGroup, git);
    if (!cwd) {
      vscode.window.showErrorMessage(t.error.noRepository);
      return;
    }

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
        ] satisfies GitBlameStashChoice[],
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
      await execFileAsync('git', ['stash', 'push', '--staged', '-m', message || t.stash.defaultStagedMessage], { cwd });
      console.log(t.success.stagedStashed);
    } else {
      // Stash 未暂存的更改（包括未跟踪的文件）
      await execFileAsync('git', ['stash', 'push', '--keep-index', '--include-untracked', '-m', message || t.stash.defaultUnstagedMessage], { cwd });
      console.log(t.success.unstagedStashed);
    }

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Failed to stash changes:', error);
    vscode.window.showErrorMessage(`${t.error.stashFailed}: ${msg}`);
  }
}

async function getGitApi(): Promise<GitApi | null> {
  const gitExtension = vscode.extensions.getExtension('vscode.git');
  if (!gitExtension) {
    return null;
  }

  const gitExtensionExports = gitExtension.isActive
    ? gitExtension.exports
    : await gitExtension.activate();

  return gitExtensionExports.getAPI(1);
}

async function resolveStashRepositoryRoot(
  resourceGroup: StashResourceGroup | undefined,
  git: GitApi
): Promise<string | null> {
  const candidateFilePaths = [
    getResourceGroupFilePath(resourceGroup),
    getFilePathFromUri(vscode.window.activeTextEditor?.document.uri)
  ].filter((filePath): filePath is string => Boolean(filePath));

  // 先从资源组里的文件路径反推仓库。
  // 这一层会拿不到，通常是因为资源组没有绑定到具体文件，或者当前编辑器不是可解析的 file/git URI。
  for (const filePath of candidateFilePaths) {
    const repoPath = await gitService.getRepositoryRoot(filePath);
    if (repoPath) {
      return repoPath;
    }

    const repository = findRepositoryForPath(git.repositories, filePath);
    if (repository) {
      return repository.rootUri.fsPath;
    }
  }

  // 上一层失败后，尝试资源组自己的根路径。
  // 这一层会拿不到，通常是因为资源组没有暴露 rootUri，或者这个 rootUri 不是 Git 根目录。
  const groupRoot = resourceGroup?.sourceControl?.rootUri?.fsPath;
  if (groupRoot) {
    const repoPath = await gitService.getRepositoryRootFromDirectory(groupRoot);
    if (repoPath) return repoPath;
    const repository = findRepositoryForPath(git.repositories, groupRoot);
    if (repository) return repository.rootUri.fsPath;
  }

  // 再往后，直接使用 Git 扩展已经识别到的仓库。
  // 这一层会拿不到，通常是因为 Git 扩展当前没有打开仓库，或者仓库列表还没准备好。
  if (git.repositories.length === 1) {
    return git.repositories[0].rootUri.fsPath;
  }

  // 如果 Git 扩展没有给出明确答案，就扫描工作区目录。
  // 这一层会拿不到，通常是因为多仓库工作区里当前文件不落在任何已识别的仓库内。
  for (const workspaceFolder of vscode.workspace.workspaceFolders ?? []) {
    const repoPath = await gitService.getRepositoryRootFromDirectory(workspaceFolder.uri.fsPath);
    if (repoPath) return repoPath;
  }

  // 最后只能退回到 Git 扩展给出的第一个仓库，至少避免直接失败。
  return git.repositories[0]?.rootUri.fsPath ?? null;
}

function getResourceGroupFilePath(resourceGroup: StashResourceGroup | undefined): string | undefined {
  const resourceStates = resourceGroup?.resourceStates || [];
  for (const resourceState of resourceStates) {
    const filePath = getFilePathFromUri(resourceState?.resourceUri);
    if (filePath) return filePath;
  }

  return undefined;
}

/**
 * 扩展停用
 */
export function deactivate() {
  blameController?.dispose();
}
