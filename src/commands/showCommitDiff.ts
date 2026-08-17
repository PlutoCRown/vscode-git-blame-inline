import { execFile } from 'child_process';
import * as path from 'path';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { decodeDiffDocUri, DiffDocProvider, encodeDiffDocUri } from '../diffDocProvider';
import { getGitApi } from '../gitApi';
import { GitService } from '../gitService';
import { t } from '../i18n';
import { findNotebookCellRef, NOTEBOOK_CELL_SCHEME } from '../notebookUtils';
import { UNCOMMITTED_HASH } from '../types';
import {
  GIT_GRAPH_SCHEME,
  getFilePathFromUri,
  parseGitGraphDiffUri
} from '../uriUtils';

const execFileAsync = promisify(execFile);
const EMPTY_TREE_HASH = '4b825dc642cb6eb9a060e54bf8d34988fbee4904';

export function registerShowCommitDiffCommand(
  context: vscode.ExtensionContext,
  gitService: GitService
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'git-blame-lite.showCommitDiff',
      async (commitHash?: unknown, pathAtCommit?: unknown, previousPath?: unknown) => {
        const hash = typeof commitHash === 'string' ? commitHash : undefined;
        const commitFilePath = typeof pathAtCommit === 'string' ? pathAtCommit : undefined;
        const previousFilePath = typeof previousPath === 'string' ? previousPath : undefined;
        if (!hash) {
          vscode.window.showErrorMessage(t.error.noCommitHash);
          return;
        }

        await showCommitDiff(gitService, hash, commitFilePath, previousFilePath);
      }
    )
  );
}

async function showCommitDiff(
  gitService: GitService,
  commitHash: string,
  pathAtCommit?: string,
  previousPath?: string
): Promise<void> {
  try {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage(t.error.noEditor);
      return;
    }

    const resolved = await resolveDiffContext(editor, gitService);
    if (!resolved) {
      vscode.window.showErrorMessage(t.error.notInWorkspace);
      return;
    }
    const { cwd, relativeFilePath, workingTreeUri } = resolved;

    if (commitHash === UNCOMMITTED_HASH) {
      await showUncommittedDiff(path.basename(relativeFilePath), workingTreeUri);
      return;
    }

    const rightPath = normalizeGitPath(pathAtCommit || relativeFilePath);
    let parentHash: string;
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', `${commitHash}^`], { cwd });
      parentHash = stdout.trim();
    } catch {
      parentHash = EMPTY_TREE_HASH;
    }

    let leftPath = rightPath;
    const rightExists = await pathExistsInCommit(cwd, commitHash, rightPath);
    let leftExists = await pathExistsInCommit(cwd, parentHash, leftPath);
    if (!leftExists && previousPath) {
      const normalizedPrevious = normalizeGitPath(previousPath);
      if (await pathExistsInCommit(cwd, parentHash, normalizedPrevious)) {
        leftPath = normalizedPrevious;
        leftExists = true;
      }
    }

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
      `${path.basename(rightPath)} (${parentHash.substring(0, 8)} ↔ ${commitHash.substring(0, 8)})`,
      { preview: true }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Failed to show commit diff:', error);
    vscode.window.showErrorMessage(`${t.error.showDiffFailed}: ${message}`);
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

async function resolveDiffContext(
  editor: vscode.TextEditor,
  gitService: GitService
): Promise<{
  cwd: string;
  relativeFilePath: string;
  workingTreeUri: vscode.Uri;
} | null> {
  const uri = editor.document.uri;

  if (uri.scheme === DiffDocProvider.scheme) {
    const data = decodeDiffDocUri(uri);
    return data.exists
      ? {
          cwd: data.repo,
          relativeFilePath: data.filePath,
          workingTreeUri: vscode.Uri.file(path.join(data.repo, data.filePath))
        }
      : null;
  }

  if (uri.scheme === GIT_GRAPH_SCHEME) {
    const data = parseGitGraphDiffUri(uri);
    return data?.exists
      ? {
          cwd: data.repo,
          relativeFilePath: data.filePath,
          workingTreeUri: vscode.Uri.file(path.join(data.repo, data.filePath))
        }
      : null;
  }

  if (uri.scheme === NOTEBOOK_CELL_SCHEME) {
    const cellRef = findNotebookCellRef(editor.document);
    if (!cellRef) {
      return null;
    }
    return resolveFileContext(cellRef.notebookFsPath, gitService);
  }

  if (uri.scheme === 'git') {
    return resolveFileContext(getFilePathFromUri(uri) ?? uri.fsPath, gitService);
  }

  if (uri.scheme === 'file') {
    return resolveFileContext(uri.fsPath, gitService, uri);
  }

  return null;
}

async function resolveFileContext(
  filePath: string,
  gitService: GitService,
  workingTreeUri = vscode.Uri.file(filePath)
): Promise<{
  cwd: string;
  relativeFilePath: string;
  workingTreeUri: vscode.Uri;
} | null> {
  const repoPath = await gitService.getRepositoryRoot(filePath);
  if (!repoPath) {
    return null;
  }
  return {
    cwd: repoPath,
    relativeFilePath: normalizeGitPath(path.relative(repoPath, filePath)),
    workingTreeUri
  };
}

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
  fileName: string,
  workingTreeUri: vscode.Uri
): Promise<void> {
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

function normalizeGitPath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}
