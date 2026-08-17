export type VisibleNotebookCell = {
  cellUri: string;
  notebookUri: string;
};

/**
 * Select notebook cells that may display blame.
 *
 * A regular NotebookEditor exposes its selected cell through the notebook API.
 * Notebook diff editors are not included in visibleNotebookEditors, so their
 * visible cells must instead be matched against the active notebook diff tabs.
 */
export function collectNotebookCellBlameUris(
  selectedCellUris: Iterable<string>,
  visibleCells: Iterable<VisibleNotebookCell>,
  visibleDiffNotebookUris: ReadonlySet<string>
): Set<string> {
  const result = new Set(selectedCellUris);

  for (const cell of visibleCells) {
    if (visibleDiffNotebookUris.has(cell.notebookUri)) {
      result.add(cell.cellUri);
    }
  }

  return result;
}
