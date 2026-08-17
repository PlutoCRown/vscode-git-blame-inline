import { describe, expect, test } from 'bun:test';
import {
  alignCurrentLinesToSavedFileLines,
  alignLines
} from '../src/lineAlignment';

describe('alignLines', () => {
  test('keeps unchanged lines and hides a modified line', () => {
    expect(
      alignLines(
        ['first', 'before', 'last'],
        ['first', 'after', 'last']
      )
    ).toEqual([0, undefined, 2]);
  });

  test('keeps blame aligned after inserted and deleted lines', () => {
    expect(
      alignLines(
        ['first', 'second', 'third'],
        ['inserted', 'first', 'third']
      )
    ).toEqual([undefined, 0, 2]);
  });

  test('handles repeated unchanged lines without blaming the changed line', () => {
    expect(
      alignLines(
        ['repeat', 'old', 'repeat', 'end'],
        ['repeat', 'new', 'repeat', 'end']
      )
    ).toEqual([0, undefined, 2, 3]);
  });
});

describe('alignCurrentLinesToSavedFileLines', () => {
  test('maps shifted current lines back to physical ipynb lines', () => {
    expect(
      alignCurrentLinesToSavedFileLines(
        'alpha\nbeta\ngamma',
        'alpha\ninserted\nbeta\ngamma',
        [20, 21, 22]
      )
    ).toEqual([20, undefined, 21, 22]);
  });

  test('does not assign blame to a trailing empty editor line', () => {
    expect(
      alignCurrentLinesToSavedFileLines('alpha\n', 'alpha\n', [20])
    ).toEqual([20, undefined]);
  });

  test('hides every current line when the saved cell has no source lines', () => {
    expect(
      alignCurrentLinesToSavedFileLines('', 'new line', [])
    ).toEqual([undefined]);
  });
});
