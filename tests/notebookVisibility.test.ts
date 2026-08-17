import { describe, expect, test } from 'bun:test';
import { collectNotebookCellBlameUris } from '../src/notebookVisibility';

describe('collectNotebookCellBlameUris', () => {
  const visibleCells = [
    { cellUri: 'cell:regular-selected', notebookUri: 'file:regular.ipynb' },
    { cellUri: 'cell:regular-inactive', notebookUri: 'file:regular.ipynb' },
    { cellUri: 'cell:diff-original', notebookUri: 'git:history.ipynb' },
    { cellUri: 'cell:diff-modified', notebookUri: 'file:history.ipynb' }
  ];

  test('keeps only the selected cell in a regular notebook', () => {
    expect(
      collectNotebookCellBlameUris(
        ['cell:regular-selected'],
        visibleCells,
        new Set()
      )
    ).toEqual(new Set(['cell:regular-selected']));
  });

  test('includes visible cells from both sides of a notebook diff', () => {
    expect(
      collectNotebookCellBlameUris(
        ['cell:regular-selected'],
        visibleCells,
        new Set(['git:history.ipynb', 'file:history.ipynb'])
      )
    ).toEqual(
      new Set([
        'cell:regular-selected',
        'cell:diff-original',
        'cell:diff-modified'
      ])
    );
  });

  test('does not include cells from an inactive notebook diff tab', () => {
    expect(
      collectNotebookCellBlameUris(
        [],
        visibleCells,
        new Set(['git:another.ipynb', 'file:another.ipynb'])
      )
    ).toEqual(new Set());
  });
});
