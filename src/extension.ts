import * as vscode from 'vscode';
import { BlameController } from './blameController';
import { registerShowCommitDiffCommand } from './commands/showCommitDiff';
import { registerStashChangesCommand } from './commands/stashChanges';
import { registerDefaultUriResolvers } from './defaultUriResolvers';
import { DiffDocProvider } from './diffDocProvider';
import { GitService } from './gitService';
import { findNotebookCellRef, NOTEBOOK_CELL_SCHEME } from './notebookUtils';
import { UriResolverRegistry } from './uriResolverRegistry';

/** Extension composition root. */
export function activate(context: vscode.ExtensionContext): void {
  console.log('Git Blame Lite extension is now active');

  const gitService = new GitService();
  const uriResolvers = new UriResolverRegistry(gitService);
  context.subscriptions.push(
    uriResolvers,
    ...registerDefaultUriResolvers(uriResolvers, {
      notebookCellScheme: NOTEBOOK_CELL_SCHEME,
      resolveNotebookUri: document => findNotebookCellRef(document)?.notebook.uri
    })
  );

  const diffDocProvider = new DiffDocProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      DiffDocProvider.scheme,
      diffDocProvider
    )
  );

  const blameController = new BlameController(context, gitService, uriResolvers);
  context.subscriptions.push(blameController);

  context.subscriptions.push(
    vscode.commands.registerCommand('git-blame-lite.toggle', () => {
      blameController?.toggle();
    })
  );

  registerShowCommitDiffCommand(context, gitService, uriResolvers);
  registerStashChangesCommand(context, gitService);
}

export function deactivate(): void {
  // VS Code disposes everything registered in context.subscriptions.
}
