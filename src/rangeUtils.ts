export type BlameLineRange = { start: number; end: number };

/**
 * Build a 1-based blame range for a zero-based cursor line.
 * A threshold of zero disables ranged blame, matching the public setting contract.
 */
export function getBlameLineRange(
  lineCount: number,
  cursorLine: number,
  threshold: number,
  padding: number
): BlameLineRange | undefined {
  if (threshold <= 0 || lineCount <= threshold) {
    return undefined;
  }

  const safeLineCount = Math.max(1, lineCount);
  const safeCursorLine = Math.min(Math.max(0, cursorLine), safeLineCount - 1);
  const safePadding = Math.max(0, padding);

  return {
    start: Math.max(1, safeCursorLine + 1 - safePadding),
    end: Math.min(safeLineCount, safeCursorLine + 1 + safePadding)
  };
}
