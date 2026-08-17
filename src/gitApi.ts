import * as vscode from 'vscode';

export type GitApi = {
  repositories: Array<{ rootUri: vscode.Uri }>;
  toGitUri?(uri: vscode.Uri, ref: string): vscode.Uri;
};

/** Activate VS Code's built-in Git extension and return its public API. */
export async function getGitApi(): Promise<GitApi | null> {
  const gitExtension = vscode.extensions.getExtension('vscode.git');
  if (!gitExtension) {
    return null;
  }

  const exports = gitExtension.isActive
    ? gitExtension.exports
    : await gitExtension.activate();

  return exports.getAPI(1) as GitApi;
}
