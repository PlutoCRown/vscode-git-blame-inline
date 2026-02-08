import * as vscode from 'vscode';
import { BlameController } from './blameController';

let blameController: BlameController | undefined;

/**
 * 扩展激活
 */
export function activate(context: vscode.ExtensionContext) {
  console.log('Git Blame Inline extension is now active');

  // 创建 Blame 控制器
  blameController = new BlameController(context);
  context.subscriptions.push(blameController);

  // 注册切换命令
  const toggleCommand = vscode.commands.registerCommand('git-blame-inline.toggle', () => {
    blameController?.toggle();
  });
  context.subscriptions.push(toggleCommand);
}

/**
 * 扩展停用
 */
export function deactivate() {
  blameController?.dispose();
}
