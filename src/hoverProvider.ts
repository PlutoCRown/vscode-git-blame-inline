import * as vscode from 'vscode';
import { BlameInfo, RemoteInfo } from './types';
import { formatDate } from './utils';

/**
 * 悬停提示提供器：显示完整的 commit 信息
 */
export class BlameHoverProvider implements vscode.HoverProvider {
  constructor(
    private getBlameInfo: (document: vscode.TextDocument, line: number) => BlameInfo | undefined,
    private getRemoteInfo: (document: vscode.TextDocument) => RemoteInfo | null
  ) {}

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Hover> {
    const lineNumber = position.line + 1; // blame 行号从 1 开始
    const blameInfo = this.getBlameInfo(document, lineNumber);

    if (!blameInfo) {
      return null;
    }

    const remoteInfo = this.getRemoteInfo(document);
    const markdown = this.createMarkdown(blameInfo, remoteInfo);
    return new vscode.Hover(markdown);
  }

  /**
   * 创建 Markdown 格式的悬停内容
   */
  private createMarkdown(blame: BlameInfo, remoteInfo: RemoteInfo | null): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.supportHtml = true;
    md.isTrusted = true;

    const formattedDate = formatDate(blame.timestamp);
    const shortHash = blame.hash.substring(0, 8);

    // 创建格式化的 commit 信息（使用 HTML 限制宽度）
    md.appendMarkdown(`<div style="max-width: 600px; word-wrap: break-word;">\n\n`);
    md.appendMarkdown(`### Git Blame\n\n`);

    md.appendMarkdown(`**Commit:** \`${shortHash}\`\n\n`);
    
    // 作者信息（GitHub/GitLab 用户链接）
    if (remoteInfo) {
      const authorUrl = this.getAuthorUrl(remoteInfo, blame.authorEmail);
      if (authorUrl) {
        md.appendMarkdown(`**作者:** [${blame.author}](${authorUrl})\n\n`);
      } else {
        md.appendMarkdown(`**作者:** ${blame.author}\n\n`);
      }
    } else {
      md.appendMarkdown(`**作者:** ${blame.author}\n\n`);
    }

    md.appendMarkdown(`**邮箱:** ${blame.authorEmail}\n\n`);
    md.appendMarkdown(`**时间:** ${formattedDate}\n\n`);
    
    md.appendMarkdown(`**提交信息:** ${blame.summary}\n\n`);

    // 添加操作链接
    md.appendMarkdown(`---\n\n`);
    
    if (remoteInfo) {
      const commitUrl = this.getCommitUrl(remoteInfo, blame.hash);
      md.appendMarkdown(`[在 ${remoteInfo.host} 上查看](${commitUrl}) | `);
    }
    
    // 添加查看差异命令链接（使用正确的参数格式）
    const diffCommand = `command:git-blame-inline.showCommitDiff?${encodeURIComponent(JSON.stringify([blame.hash]))}`;
    md.appendMarkdown(`[查看更改](${diffCommand})`);
    
    md.appendMarkdown(`\n\n</div>`);

    return md;
  }

  /**
   * 获取 commit URL
   */
  private getCommitUrl(remote: RemoteInfo, hash: string): string {
    // GitHub/GitLab 格式
    if (remote.baseUrl.includes('github.com')) {
      return `${remote.baseUrl}/${remote.owner}/${remote.repo}/commit/${hash}`;
    } else if (remote.baseUrl.includes('gitlab')) {
      return `${remote.baseUrl}/${remote.owner}/${remote.repo}/-/commit/${hash}`;
    } else {
      // 默认使用 GitHub 格式
      return `${remote.baseUrl}/${remote.owner}/${remote.repo}/commit/${hash}`;
    }
  }

  /**
   * 获取作者 URL（从邮箱推断）
   */
  private getAuthorUrl(remote: RemoteInfo, email: string): string | null {
    // 尝试从邮箱提取用户名
    // GitHub: user@users.noreply.github.com
    // GitLab: user@gitlab.com
    
    const githubMatch = email.match(/^(\d+\+)?([^@]+)@users\.noreply\.github\.com$/);
    if (githubMatch && remote.baseUrl.includes('github.com')) {
      return `${remote.baseUrl}/${githubMatch[2]}`;
    }

    // 尝试使用邮箱前缀（通用方法）
    const username = email.split('@')[0];
    if (username && remote.baseUrl.includes('github.com')) {
      return `${remote.baseUrl}/${username}`;
    }

    if (username && remote.baseUrl.includes('gitlab')) {
      return `${remote.baseUrl}/${username}`;
    }

    return null;
  }
}
