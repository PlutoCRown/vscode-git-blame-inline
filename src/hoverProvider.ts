import * as vscode from 'vscode';
import { BlameInfo } from './types';
import { formatDate } from './utils';

/**
 * 悬停提示提供器：显示完整的 commit 信息
 */
export class BlameHoverProvider implements vscode.HoverProvider {
  constructor(private getBlameInfo: (document: vscode.TextDocument, line: number) => BlameInfo | undefined) {}

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

    const markdown = this.createMarkdown(blameInfo);
    return new vscode.Hover(markdown);
  }

  /**
   * 创建 Markdown 格式的悬停内容
   */
  private createMarkdown(blame: BlameInfo): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.supportHtml = true;
    md.isTrusted = true;

    const formattedDate = formatDate(blame.timestamp);

    // 创建格式化的 commit 信息
    md.appendMarkdown(`### Git Blame\n\n`);
    md.appendMarkdown(`**Commit:** \`${blame.hash.substring(0, 8)}\`\n\n`);
    md.appendMarkdown(`**作者:** ${blame.author}\n\n`);
    md.appendMarkdown(`**邮箱:** ${blame.authorEmail}\n\n`);
    md.appendMarkdown(`**时间:** ${formattedDate}\n\n`);
    md.appendMarkdown(`**提交信息:**\n\n`);
    md.appendMarkdown(`> ${blame.summary}\n\n`);

    return md;
  }
}
