import { describe, expect, test } from 'bun:test';
import {
  buildNotebookCellSourceLineMaps,
  buildNotebookCellSourceMaps
} from '../src/notebookSourceMap';

function lineOf(raw: string, marker: string): number {
  const offset = raw.indexOf(marker);
  if (offset < 0) {
    throw new Error(`Marker not found: ${marker}`);
  }
  return raw.slice(0, offset).split('\n').length;
}

describe('buildNotebookCellSourceLineMaps', () => {
  test('uses the source inside the same cell even when another source is closer to its id', () => {
    const raw = `{
  "cells": [
    {
      "cell_type": "markdown",
      "metadata": {},
      "source": [
        "# first cell"
      ]
    },
    {
      "cell_type": "code",
      "execution_count": 1,
      "id": "code-cell",
      "metadata": {},
      "outputs": [
        {
          "data": {
            "text/plain": [
              "output 1",
              "output 2",
              "output 3",
              "output 4",
              "output 5",
              "output 6",
              "output 7",
              "output 8"
            ]
          },
          "output_type": "display_data"
        }
      ],
      "source": [
        "alpha\\n",
        "beta"
      ]
    }
  ],
  "metadata": {},
  "nbformat": 4,
  "nbformat_minor": 5
}`;

    const maps = buildNotebookCellSourceLineMaps(raw);

    expect(maps.has('')).toBe(false);
    expect(maps.get('code-cell')).toEqual([
      lineOf(raw, '"alpha\\n"'),
      lineOf(raw, '"beta"')
    ]);
  });

  test('skips cells without ids', () => {
    const raw = `{
  "cells": [
    {
      "cell_type": "markdown",
      "metadata": {},
      "source": ["no id"]
    },
    {
      "cell_type": "code",
      "id": "with-id",
      "metadata": {},
      "source": ["kept"]
    }
  ]
}`;

    const maps = buildNotebookCellSourceLineMaps(raw);

    expect([...maps.keys()]).toEqual(['with-id']);
    expect(maps.get('with-id')).toEqual([lineOf(raw, '"kept"')]);
  });

  test('supports legacy metadata ids and compact single-string sources', () => {
    const raw =
      '{"cells":[{"cell_type":"code","metadata":{"id":"legacy"},"source":"first\\nsecond"}]}';

    const maps = buildNotebookCellSourceLineMaps(raw);

    expect(maps.get('legacy')).toEqual([1, 1]);
  });

  test('returns saved source text together with its physical file lines', () => {
    const raw = `{
  "cells": [
    {
      "cell_type": "code",
      "id": "cell-id",
      "metadata": {},
      "source": [
        "alpha\\n",
        "beta"
      ]
    }
  ]
}`;

    const sourceMap = buildNotebookCellSourceMaps(raw).get('cell-id');

    expect(sourceMap).toEqual({
      source: 'alpha\nbeta',
      fileLines: [lineOf(raw, '"alpha\\n"'), lineOf(raw, '"beta"')]
    });
  });

  test('returns an empty map for invalid JSON', () => {
    expect(buildNotebookCellSourceLineMaps('{not-json')).toEqual(new Map());
  });
});
