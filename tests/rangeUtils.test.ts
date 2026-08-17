import { describe, expect, test } from 'bun:test';
import { getBlameLineRange } from '../src/rangeUtils';

describe('getBlameLineRange', () => {
  test('disables ranged blame when threshold is zero', () => {
    expect(getBlameLineRange(10_000, 500, 0, 100)).toBeUndefined();
  });

  test('uses full blame at or below the threshold', () => {
    expect(getBlameLineRange(500, 250, 500, 100)).toBeUndefined();
  });

  test('clamps the range at the start and end of the document', () => {
    expect(getBlameLineRange(1_000, 0, 500, 100)).toEqual({ start: 1, end: 101 });
    expect(getBlameLineRange(1_000, 999, 500, 100)).toEqual({ start: 900, end: 1_000 });
  });

  test('normalizes negative padding from existing user settings', () => {
    expect(getBlameLineRange(1_000, 499, 500, -10)).toEqual({ start: 500, end: 500 });
  });
});
