import * as vscode from 'vscode';

export { buildNotebookCellSourceLineMaps } from './notebookSourceMap';

export const NOTEBOOK_CELL_SCHEME = 'vscode-notebook-cell';

export type NotebookCellRef = {
  notebook: vscode.NotebookDocument;
  cell: vscode.NotebookCell;
  /** nbformat cell id（来自 metadata.id） */
  cellId: string;
};

/**
 * 从 cell 文档找到所属 notebook / cell，并读取稳定 id。
 * 支持工作区 file: notebook，以及 SCM / Diff 中的 git: notebook。
 */
export function findNotebookCellRef(
  document: vscode.TextDocument
): NotebookCellRef | undefined {
  if (document.uri.scheme !== NOTEBOOK_CELL_SCHEME) {
    return undefined;
  }

  for (const notebook of vscode.workspace.notebookDocuments) {
    for (const cell of notebook.getCells()) {
      if (cell.document.uri.toString() !== document.uri.toString()) {
        continue;
      }

      const cellId = getNotebookCellId(cell);
      if (!cellId) {
        return undefined;
      }
      return {
        notebook,
        cell,
        cellId
      };
    }
  }

  return undefined;
}

export function getNotebookCellId(cell: vscode.NotebookCell): string | undefined {
  const id = cell.metadata?.id;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

/**
 * 将整文件 blame（按文件行）映射为 cell 编辑器行 blame（1-based）
 */
export function mapFileBlameToCellBlame<T extends { lineNumber: number }>(
  fileBlame: Map<number, T>,
  sourceFileLines: number[]
): Map<number, T> {
  const cellBlame = new Map<number, T>();

  for (let i = 0; i < sourceFileLines.length; i++) {
    const fileLine = sourceFileLines[i];
    const info = fileBlame.get(fileLine);
    if (!info) {
      continue;
    }
    cellBlame.set(i + 1, { ...info, lineNumber: i + 1 });
  }

  return cellBlame;
}
