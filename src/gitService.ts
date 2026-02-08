import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { BlameInfo } from './types';

const execFileAsync = promisify(execFile);

/**
 * Git 服务：执行 git blame 命令并解析结果
 */
export class GitService {
  private cache = new Map<string, Map<number, BlameInfo>>();
  private cacheTimestamps = new Map<string, number>();
  private readonly CACHE_TTL = 60000; // 缓存 60 秒

  /**
   * 获取文件的 blame 信息
   */
  async getBlameForFile(document: vscode.TextDocument): Promise<Map<number, BlameInfo> | null> {
    const filePath = document.uri.fsPath;
    
    // 检查缓存
    const cached = this.getCachedBlame(filePath);
    if (cached) {
      return cached;
    }

    try {
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
      if (!workspaceFolder) {
        return null;
      }

      const cwd = workspaceFolder.uri.fsPath;
      const relativePath = path.relative(cwd, filePath);

      // 执行 git blame --line-porcelain
      const { stdout } = await execFileAsync('git', [
        'blame',
        '--line-porcelain',
        relativePath
      ], {
        cwd,
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer
      });

      const blameMap = this.parseBlameOutput(stdout);
      
      // 缓存结果
      this.cache.set(filePath, blameMap);
      this.cacheTimestamps.set(filePath, Date.now());

      return blameMap;
    } catch (error) {
      // 静默失败，不影响编辑器使用
      console.error('Git blame failed:', error);
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
        // 实际代码行，保存 blame 信息
        if (currentHash && currentLineNumber > 0) {
          blameMap.set(currentLineNumber, {
            hash: currentHash,
            author: currentAuthor,
            authorEmail: currentAuthorEmail,
            timestamp: currentTimestamp,
            summary: currentSummary,
            lineNumber: currentLineNumber
          });
        }
      }
    }

    return blameMap;
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
   * 清除所有缓存
   */
  clearAllCache(): void {
    this.cache.clear();
    this.cacheTimestamps.clear();
  }
}
