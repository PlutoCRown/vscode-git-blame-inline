import * as vscode from 'vscode';
import * as path from 'path';

export function getFilePathFromUri(uri: vscode.Uri | undefined): string | undefined {
  if (!uri) {
    return undefined;
  }

  if (uri.scheme === 'file') {
    return uri.fsPath;
  }

  if (uri.scheme === 'git') {
    try {
      const data = JSON.parse(uri.query) as { path?: string };
      return data.path;
    } catch {
      return uri.fsPath;
    }
  }

  return undefined;
}

export function parseGitUriQuery(uri: vscode.Uri): { path?: string; ref?: string } {
  if (uri.scheme !== 'git') {
    return {};
  }

  try {
    return JSON.parse(uri.query) as { path?: string; ref?: string };
  } catch {
    return {};
  }
}

export function isSameOrParentPath(filePath: string, parentPath: string): boolean {
  const relativePath = path.relative(path.resolve(parentPath), path.resolve(filePath));
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

export function findRepositoryForPath(
  repositories: Array<{ rootUri: vscode.Uri }>,
  filePath: string
) {
  return repositories
    .filter(repository => isSameOrParentPath(filePath, repository.rootUri.fsPath))
    .sort((a, b) => b.rootUri.fsPath.length - a.rootUri.fsPath.length)[0];
}
