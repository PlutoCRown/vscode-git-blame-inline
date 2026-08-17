import { describe, expect, test } from 'bun:test';
import type * as vscode from 'vscode';
import {
  GitUriResolutionService,
  ResolvedGitUri,
  UriResolverRegistry
} from '../src/uriResolverRegistry';
import { registerDefaultUriResolvers } from '../src/defaultUriResolvers';
import { GIT_BLAME_DIFF_SCHEME, GIT_GRAPH_SCHEME } from '../src/uriUtils';

const repoPath = '/workspace/repo';

function createUri(
  scheme: string,
  fsPath: string,
  query = ''
): vscode.Uri {
  return {
    scheme,
    fsPath,
    path: fsPath,
    query,
    toString: () => `${scheme}:${fsPath}?${query}`
  } as unknown as vscode.Uri;
}

function encodeCommitUri(
  scheme: string,
  data: { filePath: string; commit: string; repo: string; exists: boolean }
): vscode.Uri {
  return createUri(
    scheme,
    `/virtual/${data.filePath}`,
    Buffer.from(JSON.stringify(data)).toString('base64')
  );
}

function createGitService(): GitUriResolutionService {
  return {
    async getRepositoryRoot() {
      return repoPath;
    },
    async resolveGitUriBlameTarget(_repoPath, _filePath, ref) {
      return {
        commit: ref,
        cacheKeySuffix: ref ?? 'working-tree'
      };
    }
  };
}

function createDefaultRegistry(
  gitService: GitUriResolutionService = createGitService()
): UriResolverRegistry {
  const registry = new UriResolverRegistry(gitService);
  registerDefaultUriResolvers(registry, {
    notebookCellScheme: 'vscode-notebook-cell',
    resolveNotebookUri: () => undefined
  });
  return registry;
}

describe('UriResolverRegistry default adapters', () => {
  test('resolves this extension own commit Diff URI', async () => {
    const registry = createDefaultRegistry();
    const uri = encodeCommitUri(GIT_BLAME_DIFF_SCHEME, {
      repo: repoPath,
      filePath: 'src/extension.ts',
      commit: 'aaaa1111',
      exists: true
    });

    expect(await registry.resolve(uri)).toEqual({
      source: 'git-blame-inline',
      repoPath,
      filePath: 'src/extension.ts',
      commit: 'aaaa1111',
      cacheKeySuffix: 'aaaa1111',
      workingTreePath: '/workspace/repo/src/extension.ts',
      isWorkingTree: false
    });
  });

  test('resolves VS Code Git URIs through Git ref semantics', async () => {
    const calls: Array<[string, string, string | undefined]> = [];
    const registry = createDefaultRegistry({
      async getRepositoryRoot(filePath) {
        expect(filePath).toBe('/workspace/repo/src/gitService.ts');
        return repoPath;
      },
      async resolveGitUriBlameTarget(repository, filePath, ref) {
        calls.push([repository, filePath, ref]);
        return { commit: ref, cacheKeySuffix: ref ?? 'working-tree' };
      }
    });
    const uri = createUri(
      'git',
      '/workspace/repo/src/gitService.ts.git',
      JSON.stringify({ path: '/workspace/repo/src/gitService.ts', ref: 'bbbb2222' })
    );

    expect(await registry.resolve(uri)).toMatchObject({
      source: 'vscode-git',
      repoPath,
      filePath: 'src/gitService.ts',
      commit: 'bbbb2222',
      cacheKeySuffix: 'bbbb2222',
      workingTreePath: '/workspace/repo/src/gitService.ts'
    });
    expect(calls).toEqual([[repoPath, 'src/gitService.ts', 'bbbb2222']]);
  });

  test('resolves Git Graph base64 Diff URIs with the same normalized contract', async () => {
    const registry = createDefaultRegistry();
    const uri = encodeCommitUri(GIT_GRAPH_SCHEME, {
      repo: repoPath,
      filePath: 'src/blameController.ts',
      commit: 'cccc3333',
      exists: true
    });

    expect(await registry.resolve(uri)).toMatchObject({
      source: 'git-graph',
      repoPath,
      filePath: 'src/blameController.ts',
      commit: 'cccc3333',
      cacheKeySuffix: 'cccc3333'
    });
    expect(registry.isDiffRelatedScheme(GIT_GRAPH_SCHEME)).toBe(true);
    expect(registry.getPath(uri)).toBe('src/blameController.ts');
  });

  test('rejects missing and malformed virtual documents without throwing', async () => {
    const registry = createDefaultRegistry();
    const missing = encodeCommitUri(GIT_GRAPH_SCHEME, {
      repo: repoPath,
      filePath: 'deleted.ts',
      commit: 'dddd4444',
      exists: false
    });
    const malformed = createUri(GIT_GRAPH_SCHEME, '/virtual/file.ts', 'not-base64-json');

    expect(await registry.resolve(missing)).toBeNull();
    expect(await registry.resolve(malformed)).toBeNull();
  });

  test('does not treat every notebook cell as a Diff editor', () => {
    const registry = createDefaultRegistry();

    expect(registry.isDiffRelatedScheme('vscode-notebook-cell')).toBe(false);
  });
});

describe('UriResolverRegistry extension behavior', () => {
  test('uses priority, then falls through after an adapter declines or fails', async () => {
    const errors: string[] = [];
    const order: string[] = [];
    const registry = new UriResolverRegistry(createGitService(), (resolver) => {
      errors.push(resolver.id);
    });
    const fallback: ResolvedGitUri = {
      source: 'fallback',
      repoPath,
      filePath: 'fallback.ts',
      cacheKeySuffix: 'HEAD',
      workingTreePath: '/workspace/repo/fallback.ts',
      isWorkingTree: false
    };

    registry.register({
      id: 'fallback',
      schemes: ['custom'],
      resolve() {
        order.push('fallback');
        return fallback;
      }
    });
    registry.register({
      id: 'declines',
      schemes: ['custom'],
      priority: 10,
      resolve() {
        order.push('declines');
        return null;
      }
    });
    registry.register({
      id: 'fails',
      schemes: ['custom'],
      priority: 20,
      resolve() {
        order.push('fails');
        throw new Error('adapter unavailable');
      }
    });

    expect(await registry.resolve(createUri('custom', '/virtual/custom'))).toBe(fallback);
    expect(order).toEqual(['fails', 'declines', 'fallback']);
    expect(errors).toEqual(['fails']);
  });

  test('resolves adapter URIs recursively and prevents resolver cycles', async () => {
    const registry = new UriResolverRegistry(createGitService());
    const fileUri = createUri('file', '/workspace/repo/notebook.ipynb');
    const aliasUri = createUri('alias', '/virtual/notebook-cell');

    registry.register({
      id: 'file',
      schemes: ['file'],
      async resolve({ uri }, { gitService }) {
        const root = await gitService.getRepositoryRoot(uri.fsPath);
        return root
          ? {
              source: 'file',
              repoPath: root,
              filePath: 'notebook.ipynb',
              cacheKeySuffix: 'working-tree',
              workingTreePath: uri.fsPath,
              isWorkingTree: true
            }
          : null;
      }
    });
    registry.register({
      id: 'alias',
      schemes: ['alias'],
      resolve: (_request, context) => context.resolve(fileUri)
    });
    registry.register({
      id: 'cycle',
      schemes: ['cycle'],
      resolve: ({ uri }, context) => context.resolve(uri)
    });

    expect(await registry.resolve(aliasUri)).toMatchObject({
      source: 'file',
      filePath: 'notebook.ipynb'
    });
    expect(await registry.resolve(createUri('cycle', '/virtual/cycle'))).toBeNull();
  });
});
