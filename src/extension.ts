import * as vscode from 'vscode';
import { BlameController } from './blameController';
import { registerShowCommitDiffCommand } from './commands/showCommitDiff';
import { registerStashChangesCommand } from './commands/stashChanges';
import { DiffDocProvider } from './diffDocProvider';
import { GitService } from './gitService';

/** Extension composition root. */
export function activate(context: vscode.ExtensionContext): void {
  console.log('Git Blame Lite extension is now active');

  const gitService = new GitService();
  const diffDocProvider = new DiffDocProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      DiffDocProvider.scheme,
      diffDocProvider
    )
  );

  const blameController = new BlameController(context, gitService);
  context.subscriptions.push(blameController);

  context.subscriptions.push(
    vscode.commands.registerCommand('git-blame-lite.toggle', () => {
      blameController?.toggle();
    })
  );

  registerShowCommitDiffCommand(context, gitService);
  registerStashChangesCommand(context, gitService);
}

export function deactivate(): void {
  // VS Code disposes everything registered in context.subscriptions.
}
