import type * as vscode from 'vscode';
import * as path from 'path';

/** This extension's fallback virtual document scheme. */
export const GIT_BLAME_DIFF_SCHEME = 'git-blame-inline';

/** Git Graph extension's virtual document scheme used in its Diff views. */
export const GIT_GRAPH_SCHEME = 'git-graph';

export type EncodedDiffUriData = {
  filePath: string;
  commit: string;
  repo: string;
  exists: boolean;
};

export type GitGraphDiffUriData = EncodedDiffUriData;

/** 常见二进制 / 媒体扩展名：对这些文件不做 blame，避免与 VS Code 媒体预览抢读 git blob */
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.tif', '.tiff', '.avif',
  '.pdf',
  '.zip', '.gz', '.tgz', '.tar', '.7z', '.rar', '.bz2', '.xz',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp3', '.mp4', '.m4a', '.wav', '.flac', '.ogg', '.webm', '.mov', '.avi', '.mkv',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.dat', '.wasm',
  '.psd', '.ai', '.sketch', '.fig', '.xd',
  '.pyc', '.pyo', '.class', '.o', '.a', '.lib', '.jar',
  '.sqlite', '.db', '.pack'
]);

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

/**
 * Decode the virtual document URI produced by mhutchie.git-graph.
 *
 * Git Graph encodes `{ repo, filePath, commit, exists }` as base64 JSON in the
 * query of a `git-graph:` URI. Keep this parser defensive because the scheme is
 * owned by another extension and malformed URIs should simply be ignored.
 */
export function parseGitGraphDiffUri(uri: vscode.Uri): GitGraphDiffUriData | null {
  return parseEncodedDiffUri(uri, GIT_GRAPH_SCHEME);
}

/** Decode the common base64 JSON payload used by commit-backed Diff URIs. */
export function parseEncodedDiffUri(
  uri: vscode.Uri,
  expectedScheme: string
): EncodedDiffUriData | null {
  if (uri.scheme !== expectedScheme) {
    return null;
  }

  try {
    const data = JSON.parse(
      Buffer.from(uri.query, 'base64').toString('utf8')
    ) as Partial<EncodedDiffUriData>;
    if (
      typeof data.filePath !== 'string' ||
      typeof data.commit !== 'string' ||
      typeof data.repo !== 'string' ||
      typeof data.exists !== 'boolean'
    ) {
      return null;
    }

    return data as EncodedDiffUriData;
  } catch {
    return null;
  }
}

/**
 * 判断路径是否像二进制文件（用于跳过 blame，避免干扰内置 Git 的二进制 Diff 预览）
 */
export function isLikelyBinaryPath(filePath: string | undefined): boolean {
  if (!filePath) {
    return false;
  }

  // VS Code Git 有时会给 git: URI 加上 .git 后缀
  const normalized = filePath.replace(/\.git$/i, '');
  const ext = path.extname(normalized).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

export function isLikelyBinaryDocument(document: vscode.TextDocument): boolean {
  if (document.languageId === 'binary') {
    return true;
  }

  const candidatePath =
    getFilePathFromUri(document.uri) ??
    document.uri.fsPath ??
    document.uri.path;

  return isLikelyBinaryPath(candidatePath);
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
