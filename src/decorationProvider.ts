import * as vscode from 'vscode';
import { BlameInfo } from './types';
import { formatRelativeTime, truncateText } from './utils';

/**
 * 装饰提供器：在行尾显示 blame 信息
 */
export class DecorationProvider {
  private decorationType: vscode.TextEditorDecorationType;

  constructor() {
    this.decorationType = vscode.window.createTextEditorDecorationType({
      after: {
        color: new vscode.ThemeColor('editorLineNumber.foreground'),
        margin: '0 0 0 3em',
        fontStyle: 'italic'
      },
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
    });
  }

  /**
   * 更新编辑器的装饰
   */
  updateDecorations(editor: vscode.TextEditor, blameMap: Map<number, BlameInfo>): void {
    const decorations: vscode.DecorationOptions[] = [];

    // 只为可见区域的行创建装饰
    const visibleRanges = editor.visibleRanges;
    
    for (const range of visibleRanges) {
      for (let lineNum = range.start.line; lineNum <= range.end.line; lineNum++) {
        const blameInfo = blameMap.get(lineNum + 1); // blame 行号从 1 开始
        
        if (blameInfo) {
          const line = editor.document.lineAt(lineNum);
          const decoration = this.createDecoration(line, blameInfo);
          decorations.push(decoration);
        }
      }
    }

    editor.setDecorations(this.decorationType, decorations);
  }

  /**
   * 创建单行装饰
   */
  private createDecoration(line: vscode.TextLine, blameInfo: BlameInfo): vscode.DecorationOptions {
    const relativeTime = formatRelativeTime(blameInfo.timestamp);
    const shortSummary = truncateText(blameInfo.summary, 50);
    const text = `${blameInfo.author}, ${relativeTime} • ${shortSummary}`;

    return {
      range: line.range,
      renderOptions: {
        after: {
          contentText: text
        }
      }
    };
  }

  /**
   * 清除所有装饰
   */
  clearDecorations(editor: vscode.TextEditor): void {
    editor.setDecorations(this.decorationType, []);
  }

  /**
   * 释放资源
   */
  dispose(): void {
    this.decorationType.dispose();
  }
}
