import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export const enum DiffSide {
  Old,
  New
}

/**
 * Diff 文档数据
 */
type DiffDocUriData = {
  filePath: string;
  commit: string;
  repo: string;
  exists: boolean;
};

/**
 * 提供特定 Git 提交的文件内容用于 Diff 视图
 */
export class DiffDocProvider implements vscode.TextDocumentContentProvider {
  public static readonly scheme = 'git-blame-inline';
  private docs = new Map<string, string>();

  /**
   * 提供文本文档内容
   */
  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const cacheKey = uri.toString();
    if (this.docs.has(cacheKey)) {
      return this.docs.get(cacheKey)!;
    }

    const data = decodeDiffDocUri(uri);
    if (!data.exists) {
      return '';
    }

    try {
      const { stdout } = await execFileAsync('git', ['show', `${data.commit}:${data.filePath}`], {
        cwd: data.repo,
        maxBuffer: 10 * 1024 * 1024 // 10MB
      });
      this.docs.set(cacheKey, stdout);
      return stdout;
    } catch (error) {
      console.error('Failed to get commit file:', error);
      return '';
    }
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this.docs.clear();
  }
}

/**
 * 编码 Diff URI
 */
export function encodeDiffDocUri(
  repo: string,
  filePath: string,
  commit: string,
  exists: boolean
): vscode.Uri {
  const data: DiffDocUriData = {
    filePath: filePath,
    commit: commit,
    repo: repo,
    exists: exists
  };

  // 从文件路径提取扩展名
  const extIndex = filePath.lastIndexOf('.');
  const extension = extIndex > -1 ? filePath.substring(extIndex) : '';

  return vscode.Uri.file('file' + extension).with({
    scheme: DiffDocProvider.scheme,
    query: Buffer.from(JSON.stringify(data)).toString('base64')
  });
}

/**
 * 解码 Diff URI
 */
export function decodeDiffDocUri(uri: vscode.Uri): DiffDocUriData {
  return JSON.parse(Buffer.from(uri.query, 'base64').toString());
}
