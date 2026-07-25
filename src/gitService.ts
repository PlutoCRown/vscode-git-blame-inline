import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { stat } from 'fs/promises';
import { BlameInfo, RemoteInfo, UNCOMMITTED_HASH } from './types';

const execFileAsync = promisify(execFile);

/**
 * Git 服务：执行 git blame 命令并解析结果
 */
export class GitService {
  private cache = new Map<string, Map<number, BlameInfo>>();
  private cacheTimestamps = new Map<string, number>();
  private repoRootCache = new Map<string, string | null>();
  private readonly CACHE_TTL = 60000; // 缓存 60 秒

  /**
   * 将 VS Code 内置 Git 的 git: URI ref 解析为可 blame 的目标。
   * VS Code 使用私有标记：`~`（HEAD 或 index）、`''`（index）、`~1/~2/~3`（冲突 stage）。
   */
  async resolveGitUriBlameTarget(
    repoPath: string,
    filePath: string,
    ref: string | undefined
  ): Promise<{ commit?: string; contents?: string; cacheKeySuffix: string } | null> {
    if (ref === undefined) {
      return { cacheKeySuffix: 'working-tree' };
    }

    // 空字符串 = index（暂存区）
    if (ref === '') {
      const contents = await this.getGitObjectContents(repoPath, filePath);
      if (contents === null) {
        return null;
      }
      return { contents, cacheKeySuffix: 'index' };
    }

    // `~`：有暂存版本则用 index，否则用 HEAD（与 VS Code sanitizeRef 一致）
    if (ref === '~') {
      const hasStaged = await this.hasStagedVersion(repoPath, filePath);
      if (hasStaged) {
        const contents = await this.getGitObjectContents(repoPath, filePath);
        if (contents === null) {
          return null;
        }
        return { contents, cacheKeySuffix: 'index' };
      }
      return { commit: 'HEAD', cacheKeySuffix: 'HEAD' };
    }

    // `~1` / `~2` / `~3` → merge stage `:1` / `:2` / `:3`
    const stageMatch = /^~(\d)$/.exec(ref);
    if (stageMatch) {
      const stage = stageMatch[1];
      const contents = await this.getGitObjectContents(repoPath, filePath, stage);
      if (contents === null) {
        return null;
      }
      return { contents, cacheKeySuffix: `stage-${stage}` };
    }

    return { commit: ref, cacheKeySuffix: ref };
  }

  /**
   * 获取指定仓库/文件/提交的 blame 信息
   */
  async getBlameForRepoFile(
    repoPath: string,
    filePath: string,
    commit?: string,
    cacheKey?: string,
    contents?: string
  ): Promise<Map<number, BlameInfo> | null> {
    const key = cacheKey ?? `${repoPath}::${filePath}::${commit ?? 'working-tree'}`;

    const cached = this.getCachedBlame(key);
    if (cached) {
      return cached;
    }

    try {
      const args = ['blame', '--line-porcelain'];
      if (commit) {
        args.push(commit);
      }
      if (contents !== undefined) {
        args.push('--contents', '-');
      }
      args.push('--', filePath);

      const { stdout } = await this.execGit(args, repoPath, contents);

      const blameMap = this.parseBlameOutput(stdout);

      this.cache.set(key, blameMap);
      this.cacheTimestamps.set(key, Date.now());

      return blameMap;
    } catch (error) {
      console.error('Git blame failed:', error);
      return null;
    }
  }

  /**
   * 获取文件最近修改时间（秒）。用于未提交行的相对时间展示。
   */
  async getFileMtimeSeconds(filePath: string): Promise<number | null> {
    try {
      const stats = await stat(filePath);
      return Math.floor(stats.mtimeMs / 1000);
    } catch {
      return null;
    }
  }

  private async hasStagedVersion(repoPath: string, filePath: string): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['diff', '--cached', '--name-only', '--', filePath],
        { cwd: repoPath, maxBuffer: 1024 * 1024 }
      );
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  private async getGitObjectContents(
    repoPath: string,
    filePath: string,
    stage?: string
  ): Promise<string | null> {
    try {
      const object = stage ? `:${stage}:${filePath}` : `:${filePath}`;
      const { stdout } = await execFileAsync('git', ['show', object], {
        cwd: repoPath,
        maxBuffer: 10 * 1024 * 1024,
        encoding: 'utf8'
      });
      return stdout;
    } catch {
      return null;
    }
  }

  /**
   * 解析 git blame --line-porcelain 输出
   */
  private parseBlameOutput(output: string): Map<number, BlameInfo> {
    const lines = output.split('\n');
    const blameMap = new Map<number, BlameInfo>();

    let currentHash = '';
    let currentAuthor = '';
    let currentAuthorEmail = '';
    let currentTimestamp = 0;
    let currentSummary = '';
    let currentLineNumber = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.match(/^[0-9a-f]{40}/)) {
        // 新的 commit 行: hash originalLine finalLine numLines
        const parts = line.split(' ');
        currentHash = parts[0];
        currentLineNumber = parseInt(parts[2], 10);
      } else if (line.startsWith('author ')) {
        currentAuthor = line.substring(7);
      } else if (line.startsWith('author-mail ')) {
        currentAuthorEmail = line.substring(12).replace(/^<|>$/g, '');
      } else if (line.startsWith('author-time ')) {
        currentTimestamp = parseInt(line.substring(12), 10);
      } else if (line.startsWith('summary ')) {
        currentSummary = line.substring(8);
      } else if (line.startsWith('\t')) {
        // 实际代码行，保存 blame 信息（含尚未提交的本地改动）
        if (currentHash && currentLineNumber > 0) {
          const isUncommitted = currentHash === UNCOMMITTED_HASH;
          blameMap.set(currentLineNumber, {
            hash: currentHash,
            author: currentAuthor,
            authorEmail: currentAuthorEmail,
            timestamp: currentTimestamp,
            summary: currentSummary,
            lineNumber: currentLineNumber,
            isUncommitted
          });
        }
      }
    }

    return blameMap;
  }

  private execGit(
    args: string[],
    cwd: string,
    input?: string
  ): Promise<{ stdout: string; stderr: string }> {
    if (input === undefined) {
      return execFileAsync('git', args, {
        cwd,
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer
      });
    }

    return new Promise((resolve, reject) => {
      const child = execFile(
        'git',
        args,
        {
          cwd,
          maxBuffer: 10 * 1024 * 1024 // 10MB buffer
        },
        (error: Error | null, stdout: string, stderr: string) => {
          if (error) {
            reject(error);
            return;
          }

          resolve({ stdout, stderr });
        }
      );

      child.stdin?.end(input);
    });
  }

  /**
   * 获取缓存的 blame 信息
   */
  private getCachedBlame(filePath: string): Map<number, BlameInfo> | null {
    const cached = this.cache.get(filePath);
    const timestamp = this.cacheTimestamps.get(filePath);

    if (cached && timestamp && (Date.now() - timestamp < this.CACHE_TTL)) {
      return cached;
    }

    return null;
  }

  /**
   * 清除指定文件的缓存
   */
  clearCache(filePath: string): void {
    this.cache.delete(filePath);
    this.cacheTimestamps.delete(filePath);
  }

  /**
   * 获取文件所属的 Git 仓库根目录
   */
  async getRepositoryRoot(filePath: string): Promise<string | null> {
    return this.getRepositoryRootFromDirectory(path.dirname(filePath));
  }

  /**
   * 获取目录所属的 Git 仓库根目录
   */
  async getRepositoryRootFromDirectory(directory: string): Promise<string | null> {
    if (this.repoRootCache.has(directory)) {
      return this.repoRootCache.get(directory) ?? null;
    }

    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
        cwd: directory,
        maxBuffer: 1024 * 1024
      });

      const repoPath = stdout.trim();
      this.repoRootCache.set(directory, repoPath || null);
      return repoPath || null;
    } catch {
      this.repoRootCache.set(directory, null);
      return null;
    }
  }

  /**
   * 清除所有缓存
   */
  clearAllCache(): void {
    this.cache.clear();
    this.cacheTimestamps.clear();
  }

  /**
   * 获取指定仓库的远程 URL
   */
  async getRemoteUrlForRepo(repoPath: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync('git', [
        'config',
        '--get',
        'remote.origin.url'
      ], {
        cwd: repoPath
      });

      return stdout.trim();
    } catch (error) {
      return null;
    }
  }

  /**
   * 解析远程仓库 URL 为 Web URL
   * 支持 GitHub 的 owner/repo，以及 GitLab 的多级 namespace（group/subgroup/repo）
   */
  parseRemoteUrl(remoteUrl: string): RemoteInfo | null {
    // HTTPS: https://host[:port]/group/subgroup/repo.git
    // SSH:   git@host:group/subgroup/repo.git
    const httpsMatch = remoteUrl.match(/^https?:\/\/([^/:]+)(?::\d+)?\/(.+?)$/i);
    const sshMatch = remoteUrl.match(/^git@([^:]+):(.+?)$/i);
    const match = httpsMatch ?? sshMatch;
    if (!match) {
      return null;
    }

    const [, hostName, rawPath] = match;
    const projectPath = rawPath
      .replace(/\.git$/i, '')
      .replace(/\/+$/, '')
      .replace(/^\/+/, '');

    // 至少需要两级路径（namespace/repo）；GitLab 可为更多级
    if (!projectPath || !projectPath.includes('/')) {
      return null;
    }

    return {
      baseUrl: `https://${hostName}`,
      projectPath,
      host: this.detectHostType(hostName)
    };
  }

  /**
   * 检测 Git 主机类型
   */
  private detectHostType(hostname: string): 'GitHub' | 'GitLab' | string {
    const lowerHost = hostname.toLowerCase();

    if (lowerHost.includes('github')) {
      return 'GitHub';
    } else if (lowerHost.includes('gitlab')) {
      return 'GitLab';
    } else if (lowerHost.includes('gitea')) {
      return 'Gitea';
    } else {
      return lowerHost;
    }
  }
}
