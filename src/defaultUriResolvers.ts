import * as path from 'path';
import type * as vscode from 'vscode';
import { UriResolver, UriResolverRegistry } from './uriResolverRegistry';
import {
  GIT_BLAME_DIFF_SCHEME,
  GIT_GRAPH_SCHEME,
  getFilePathFromUri,
  parseEncodedDiffUri,
  parseGitUriQuery
} from './uriUtils';

export interface DefaultUriResolverOptions {
  notebookCellScheme: string;
  resolveNotebookUri(document: vscode.TextDocument): vscode.Uri | undefined;
}

/** Register every URI source supported out of the box. */
export function registerDefaultUriResolvers(
  registry: UriResolverRegistry,
  options: DefaultUriResolverOptions
): vscode.Disposable[] {
  return [
    registry.register(createFileResolver()),
    registry.register(createGitResolver()),
    registry.register(createEncodedCommitResolver('git-blame-inline', GIT_BLAME_DIFF_SCHEME)),
    registry.register(createEncodedCommitResolver('git-graph', GIT_GRAPH_SCHEME)),
    registry.register(createNotebookCellResolver(options))
  ];
}

function createFileResolver(): UriResolver {
  return {
    id: 'file',
    schemes: ['file'],
    getPath: uri => uri.fsPath,
    async resolve({ uri }, { gitService }) {
      const repoPath = await gitService.getRepositoryRoot(uri.fsPath);
      if (!repoPath) {
        return null;
      }
      return {
        source: 'file',
        repoPath,
        filePath: relativeGitPath(repoPath, uri.fsPath),
        cacheKeySuffix: 'working-tree',
        workingTreePath: uri.fsPath,
        isWorkingTree: true,
        useDirtyDocumentContents: true,
        cacheDocumentVersion: true
      };
    }
  };
}

function createGitResolver(): UriResolver {
  return {
    id: 'vscode-git',
    schemes: ['git'],
    isDiffRelated: true,
    getPath: uri => getFilePathFromUri(uri) ?? uri.fsPath,
    async resolve({ uri }, { gitService }) {
      const { path: queryPath, ref } = parseGitUriQuery(uri);
      const fileSystemPath = queryPath ?? uri.fsPath;
      if (!fileSystemPath) {
        return null;
      }

      const repoPath = await gitService.getRepositoryRoot(fileSystemPath);
      if (!repoPath) {
        return null;
      }
      const filePath = relativeGitPath(repoPath, fileSystemPath);
      const target = await gitService.resolveGitUriBlameTarget(repoPath, filePath, ref);
      if (!target) {
        return null;
      }

      return {
        source: 'vscode-git',
        repoPath,
        filePath,
        commit: target.commit,
        contents: target.contents,
        cacheKeySuffix: target.cacheKeySuffix,
        workingTreePath: fileSystemPath,
        isWorkingTree: ref === undefined
      };
    }
  };
}

function createEncodedCommitResolver(id: string, scheme: string): UriResolver {
  return {
    id,
    schemes: [scheme],
    isDiffRelated: true,
    getPath(uri) {
      return parseEncodedDiffUri(uri, scheme)?.filePath;
    },
    resolve({ uri }) {
      const data = parseEncodedDiffUri(uri, scheme);
      if (!data?.exists) {
        return null;
      }
      const filePath = normalizeGitPath(data.filePath);
      return {
        source: id,
        repoPath: data.repo,
        filePath,
        commit: data.commit,
        cacheKeySuffix: data.commit,
        workingTreePath: path.join(data.repo, filePath),
        isWorkingTree: false
      };
    }
  };
}

function createNotebookCellResolver(options: DefaultUriResolverOptions): UriResolver {
  return {
    id: 'vscode-notebook-cell',
    schemes: [options.notebookCellScheme],
    async resolve({ document }, context) {
      if (!document) {
        return null;
      }
      const notebookUri = options.resolveNotebookUri(document);
      return notebookUri ? context.resolve(notebookUri) : null;
    }
  };
}

function relativeGitPath(repoPath: string, filePath: string): string {
  return normalizeGitPath(path.relative(repoPath, filePath));
}

function normalizeGitPath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}
