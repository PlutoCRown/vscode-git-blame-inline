import { execFile } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { getGitApi, GitApi } from '../gitApi';
import { GitService } from '../gitService';
import { t } from '../i18n';
import { findRepositoryForPath, getFilePathFromUri } from '../uriUtils';

const execFileAsync = promisify(execFile);

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
};

export function registerStashChangesCommand(
  context: vscode.ExtensionContext,
  gitService: GitService
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'git-blame-lite.stashChanges',
      async (resourceGroup?: StashResourceGroup) => {
        await stashChanges(resourceGroup, gitService);
      }
    )
  );
}

async function stashChanges(
  resourceGroup: StashResourceGroup | undefined,
  gitService: GitService
): Promise<void> {
  try {
    const git = await getGitApi();
    if (!git) {
      vscode.window.showErrorMessage(t.error.noGitExtension);
      return;
    }

    const cwd = await resolveStashRepositoryRoot(resourceGroup, git, gitService);
    if (!cwd) {
      vscode.window.showErrorMessage(t.error.noRepository);
      return;
    }

    const groupId = resourceGroup?.id;
    let isStaged: boolean;
    let groupLabel: string;

    if (groupId === 'index') {
      isStaged = true;
      groupLabel = t.stash.staged;
    } else if (groupId === 'workingTree') {
      isStaged = false;
      groupLabel = t.stash.unstaged;
    } else {
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

    const message = await vscode.window.showInputBox({
      prompt: `${t.stash.inputMessage}（${groupLabel}）`,
      placeHolder: t.stash.inputPlaceholder,
      value: `Stashed ${groupLabel} at ${new Date().toLocaleString()}`
    });
    if (message === undefined) {
      return;
    }

    if (isStaged) {
      await execFileAsync(
        'git',
        ['stash', 'push', '--staged', '-m', message || t.stash.defaultStagedMessage],
        { cwd }
      );
      console.log(t.success.stagedStashed);
    } else {
      await execFileAsync(
        'git',
        [
          'stash',
          'push',
          '--keep-index',
          '--include-untracked',
          '-m',
          message || t.stash.defaultUnstagedMessage
        ],
        { cwd }
      );
      console.log(t.success.unstagedStashed);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Failed to stash changes:', error);
    vscode.window.showErrorMessage(`${t.error.stashFailed}: ${message}`);
  }
}

async function resolveStashRepositoryRoot(
  resourceGroup: StashResourceGroup | undefined,
  git: GitApi,
  gitService: GitService
): Promise<string | null> {
  const candidateFilePaths = [
    getResourceGroupFilePath(resourceGroup),
    getFilePathFromUri(vscode.window.activeTextEditor?.document.uri)
  ].filter((filePath): filePath is string => Boolean(filePath));

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

  const groupRoot = resourceGroup?.sourceControl?.rootUri?.fsPath;
  if (groupRoot) {
    const repoPath = await gitService.getRepositoryRootFromDirectory(groupRoot);
    if (repoPath) {
      return repoPath;
    }
    const repository = findRepositoryForPath(git.repositories, groupRoot);
    if (repository) {
      return repository.rootUri.fsPath;
    }
  }

  if (git.repositories.length === 1) {
    return git.repositories[0].rootUri.fsPath;
  }

  for (const workspaceFolder of vscode.workspace.workspaceFolders ?? []) {
    const repoPath = await gitService.getRepositoryRootFromDirectory(workspaceFolder.uri.fsPath);
    if (repoPath) {
      return repoPath;
    }
  }

  return git.repositories[0]?.rootUri.fsPath ?? null;
}

function getResourceGroupFilePath(
  resourceGroup: StashResourceGroup | undefined
): string | undefined {
  for (const resourceState of resourceGroup?.resourceStates ?? []) {
    const filePath = getFilePathFromUri(resourceState.resourceUri);
    if (filePath) {
      return filePath;
    }
  }
  return undefined;
}
