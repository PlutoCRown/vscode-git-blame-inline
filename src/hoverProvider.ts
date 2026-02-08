import * as vscode from 'vscode';
import { BlameInfo, RemoteInfo } from './types';
import { formatDate } from './utils';
import { BlameController } from './blameController';
import { t } from './i18n';

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
    md.appendMarkdown(`### ${t.hover.title}\n\n`);

    md.appendMarkdown(`**${t.hover.commit}:** \`${shortHash}\`\n\n`);
    
    // 作者信息（GitHub/GitLab 用户链接）
    if (remoteInfo) {
      const authorUrl = this.getAuthorUrl(remoteInfo, blame.authorEmail);
      if (authorUrl) {
        md.appendMarkdown(`**${t.hover.author}:** [${blame.author}](${authorUrl})\n\n`);
      } else {
        md.appendMarkdown(`**${t.hover.author}:** ${blame.author}\n\n`);
      }
    } else {
      md.appendMarkdown(`**${t.hover.author}:** ${blame.author}\n\n`);
    }

    md.appendMarkdown(`**${t.hover.email}:** ${blame.authorEmail}\n\n`);
    md.appendMarkdown(`**${t.hover.time}:** ${formattedDate}\n\n`);
    
    md.appendMarkdown(`**${t.hover.message}:** ${blame.summary}\n\n`);

    // 添加操作链接
    md.appendMarkdown(`---\n\n`);
    
    if (remoteInfo) {
      const commitUrl = this.getCommitUrl(remoteInfo, blame.hash);
      md.appendMarkdown(`[${t.hover.viewOn} ${remoteInfo.host}](${commitUrl}) | `);
    }
    
    // 保存当前 commit hash 到全局变量，供命令使用
    BlameController.currentCommitHash = blame.hash;
    
    // 添加查看差异命令链接（不传参数，命令内部从全局变量读取）
    md.appendMarkdown(`[${t.hover.viewChanges}](command:git-blame-inline.showCommitDiff)`);
    
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
