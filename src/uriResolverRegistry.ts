import type * as vscode from 'vscode';

export interface ResolvedGitUri {
  /** Stable identifier of the resolver that produced this result. */
  source: string;
  repoPath: string;
  /** Git path relative to repoPath, always using forward slashes. */
  filePath: string;
  /** Revision passed to git blame. Omitted for the working tree or supplied contents. */
  commit?: string;
  /** Index/stage content to feed to git blame through --contents. */
  contents?: string;
  /** Revision-specific portion of the blame cache key. */
  cacheKeySuffix: string;
  /** Absolute path of the corresponding working-tree file. */
  workingTreePath: string;
  isWorkingTree: boolean;
  /** Whether dirty editor text should be passed through --contents. */
  useDirtyDocumentContents?: boolean;
  /** Whether the TextDocument version participates in the cache key. */
  cacheDocumentVersion?: boolean;
}

export interface UriResolverRequest {
  uri: vscode.Uri;
  document?: vscode.TextDocument;
}

export interface GitUriResolutionService {
  getRepositoryRoot(filePath: string): Promise<string | null>;
  resolveGitUriBlameTarget(
    repoPath: string,
    filePath: string,
    ref: string | undefined
  ): Promise<{
    commit?: string;
    contents?: string;
    cacheKeySuffix: string;
  } | null>;
}

export interface UriResolverContext {
  gitService: GitUriResolutionService;
  /** Resolve an underlying URI, used by adapter resolvers such as notebook cells. */
  resolve(uri: vscode.Uri, document?: vscode.TextDocument): Promise<ResolvedGitUri | null>;
}

export interface UriResolver {
  /** Unique adapter id, useful for diagnostics and deterministic replacement. */
  id: string;
  schemes: readonly string[];
  /** Higher-priority resolvers get the first chance and may fall back by returning null. */
  priority?: number;
  /** Marks schemes whose visible editors should refresh together as a Diff view. */
  isDiffRelated?: boolean;
  /** Cheap path extraction used to reject binary files before any Git blob is read. */
  getPath?(uri: vscode.Uri): string | undefined;
  resolve(
    request: UriResolverRequest,
    context: UriResolverContext
  ): Promise<ResolvedGitUri | null> | ResolvedGitUri | null;
}

type RegisteredResolver = {
  resolver: UriResolver;
  order: number;
};

/**
 * Ordered, fall-through registry for URI adapters.
 *
 * A new provider only needs to register a resolver. Blame, hover registration,
 * coordinated Diff refresh, and the "show commit Diff" command all consume the
 * same resolution result.
 */
export class UriResolverRegistry implements vscode.Disposable {
  private readonly resolvers: RegisteredResolver[] = [];
  private nextOrder = 0;

  constructor(
    private readonly gitService: UriResolverContext['gitService'],
    private readonly onResolverError: (resolver: UriResolver, error: unknown) => void =
      (resolver, error) => console.warn(`URI resolver "${resolver.id}" failed:`, error)
  ) {}

  register(resolver: UriResolver): vscode.Disposable {
    if (!resolver.id || resolver.schemes.length === 0) {
      throw new Error('A URI resolver requires a non-empty id and at least one scheme.');
    }
    if (this.resolvers.some(entry => entry.resolver.id === resolver.id)) {
      throw new Error(`URI resolver "${resolver.id}" is already registered.`);
    }

    const entry = { resolver, order: this.nextOrder++ };
    this.resolvers.push(entry);
    this.sortResolvers();

    return {
      dispose: () => {
        const index = this.resolvers.indexOf(entry);
        if (index >= 0) {
          this.resolvers.splice(index, 1);
        }
      }
    };
  }

  getSchemes(): string[] {
    return [...new Set(this.resolvers.flatMap(entry => entry.resolver.schemes))];
  }

  isSupportedScheme(scheme: string): boolean {
    return this.resolvers.some(entry => entry.resolver.schemes.includes(scheme));
  }

  isDiffRelatedScheme(scheme: string): boolean {
    return this.resolvers.some(
      entry => entry.resolver.isDiffRelated && entry.resolver.schemes.includes(scheme)
    );
  }

  getPath(uri: vscode.Uri): string | undefined {
    for (const { resolver } of this.matchingResolvers(uri.scheme)) {
      try {
        const candidate = resolver.getPath?.(uri);
        if (candidate) {
          return candidate;
        }
      } catch (error) {
        this.onResolverError(resolver, error);
      }
    }
    return undefined;
  }

  resolve(uri: vscode.Uri, document?: vscode.TextDocument): Promise<ResolvedGitUri | null> {
    return this.resolveInternal({ uri, document }, new Set<string>());
  }

  dispose(): void {
    this.resolvers.length = 0;
  }

  private async resolveInternal(
    request: UriResolverRequest,
    ancestors: Set<string>
  ): Promise<ResolvedGitUri | null> {
    const uriKey = request.uri.toString();
    if (ancestors.has(uriKey)) {
      return null;
    }

    const nextAncestors = new Set(ancestors);
    nextAncestors.add(uriKey);
    const context: UriResolverContext = {
      gitService: this.gitService,
      resolve: (uri, document) => this.resolveInternal({ uri, document }, nextAncestors)
    };

    for (const { resolver } of this.matchingResolvers(request.uri.scheme)) {
      try {
        const result = await resolver.resolve(request, context);
        if (result) {
          return result;
        }
      } catch (error) {
        this.onResolverError(resolver, error);
      }
    }

    return null;
  }

  private matchingResolvers(scheme: string): RegisteredResolver[] {
    return this.resolvers.filter(entry => entry.resolver.schemes.includes(scheme));
  }

  private sortResolvers(): void {
    this.resolvers.sort((a, b) =>
      (b.resolver.priority ?? 0) - (a.resolver.priority ?? 0) || b.order - a.order
    );
  }
}
