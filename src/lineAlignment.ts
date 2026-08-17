const EXACT_LCS_CELL_LIMIT = 1_000_000;

/**
 * Map current editor lines to physical lines in the saved ipynb source.
 * Changed and inserted lines remain undefined, while unchanged lines keep blame
 * even when edits before them shift their editor line numbers.
 */
export function alignCurrentLinesToSavedFileLines(
  savedText: string,
  currentText: string,
  savedFileLines: number[]
): Array<number | undefined> {
  const savedLines = splitLines(savedText);
  while (
    savedLines.length > savedFileLines.length &&
    savedLines[savedLines.length - 1] === ''
  ) {
    savedLines.pop();
  }
  if (savedFileLines.length === 0) {
    savedLines.length = 0;
  } else if (savedLines.length > savedFileLines.length) {
    savedLines.length = savedFileLines.length;
  }

  const currentLines = splitLines(currentText);
  const savedIndexes = alignLines(savedLines, currentLines);
  return savedIndexes.map(index =>
    index === undefined ? undefined : savedFileLines[index]
  );
}

/** Return current-line index -> saved-line index for textually unchanged lines. */
export function alignLines(
  savedLines: readonly string[],
  currentLines: readonly string[]
): Array<number | undefined> {
  const result = Array<number | undefined>(currentLines.length).fill(undefined);
  alignRange(
    savedLines,
    currentLines,
    0,
    savedLines.length,
    0,
    currentLines.length,
    result
  );
  return result;
}

function alignRange(
  saved: readonly string[],
  current: readonly string[],
  savedStart: number,
  savedEnd: number,
  currentStart: number,
  currentEnd: number,
  result: Array<number | undefined>
): void {
  while (
    savedStart < savedEnd &&
    currentStart < currentEnd &&
    saved[savedStart] === current[currentStart]
  ) {
    result[currentStart] = savedStart;
    savedStart++;
    currentStart++;
  }

  while (
    savedStart < savedEnd &&
    currentStart < currentEnd &&
    saved[savedEnd - 1] === current[currentEnd - 1]
  ) {
    savedEnd--;
    currentEnd--;
    result[currentEnd] = savedEnd;
  }

  const savedLength = savedEnd - savedStart;
  const currentLength = currentEnd - currentStart;
  if (savedLength === 0 || currentLength === 0) {
    return;
  }

  if (savedLength * currentLength <= EXACT_LCS_CELL_LIMIT) {
    alignRangeWithLcs(
      saved,
      current,
      savedStart,
      savedEnd,
      currentStart,
      currentEnd,
      result
    );
    return;
  }

  // Large cells use patience-diff anchors, then recursively align the gaps.
  // Ambiguous unmatched lines stay hidden rather than receiving incorrect blame.
  const anchors = findPatienceAnchors(
    saved,
    current,
    savedStart,
    savedEnd,
    currentStart,
    currentEnd
  );
  if (anchors.length === 0) {
    return;
  }

  let previousSaved = savedStart;
  let previousCurrent = currentStart;
  for (const [savedIndex, currentIndex] of anchors) {
    alignRange(
      saved,
      current,
      previousSaved,
      savedIndex,
      previousCurrent,
      currentIndex,
      result
    );
    result[currentIndex] = savedIndex;
    previousSaved = savedIndex + 1;
    previousCurrent = currentIndex + 1;
  }
  alignRange(
    saved,
    current,
    previousSaved,
    savedEnd,
    previousCurrent,
    currentEnd,
    result
  );
}

function alignRangeWithLcs(
  saved: readonly string[],
  current: readonly string[],
  savedStart: number,
  savedEnd: number,
  currentStart: number,
  currentEnd: number,
  result: Array<number | undefined>
): void {
  const savedLength = savedEnd - savedStart;
  const currentLength = currentEnd - currentStart;
  const width = currentLength + 1;
  const lcs = new Uint32Array((savedLength + 1) * width);

  for (let savedOffset = savedLength - 1; savedOffset >= 0; savedOffset--) {
    for (let currentOffset = currentLength - 1; currentOffset >= 0; currentOffset--) {
      const index = savedOffset * width + currentOffset;
      if (
        saved[savedStart + savedOffset] ===
        current[currentStart + currentOffset]
      ) {
        lcs[index] = lcs[(savedOffset + 1) * width + currentOffset + 1] + 1;
      } else {
        lcs[index] = Math.max(
          lcs[(savedOffset + 1) * width + currentOffset],
          lcs[savedOffset * width + currentOffset + 1]
        );
      }
    }
  }

  let savedOffset = 0;
  let currentOffset = 0;
  while (savedOffset < savedLength && currentOffset < currentLength) {
    if (
      saved[savedStart + savedOffset] ===
      current[currentStart + currentOffset]
    ) {
      result[currentStart + currentOffset] = savedStart + savedOffset;
      savedOffset++;
      currentOffset++;
    } else if (
      lcs[(savedOffset + 1) * width + currentOffset] >=
      lcs[savedOffset * width + currentOffset + 1]
    ) {
      savedOffset++;
    } else {
      currentOffset++;
    }
  }
}

function findPatienceAnchors(
  saved: readonly string[],
  current: readonly string[],
  savedStart: number,
  savedEnd: number,
  currentStart: number,
  currentEnd: number
): Array<[number, number]> {
  const savedOccurrences = countOccurrences(saved, savedStart, savedEnd);
  const currentOccurrences = countOccurrences(current, currentStart, currentEnd);
  const uniqueSavedIndexes = new Map<string, number>();

  for (let index = savedStart; index < savedEnd; index++) {
    const line = saved[index];
    if (savedOccurrences.get(line) === 1 && currentOccurrences.get(line) === 1) {
      uniqueSavedIndexes.set(line, index);
    }
  }

  const candidates: Array<[number, number]> = [];
  for (let index = currentStart; index < currentEnd; index++) {
    const savedIndex = uniqueSavedIndexes.get(current[index]);
    if (savedIndex !== undefined) {
      candidates.push([savedIndex, index]);
    }
  }

  return longestIncreasingSavedIndexes(candidates);
}

function countOccurrences(
  lines: readonly string[],
  start: number,
  end: number
): Map<string, number> {
  const counts = new Map<string, number>();
  for (let index = start; index < end; index++) {
    counts.set(lines[index], (counts.get(lines[index]) ?? 0) + 1);
  }
  return counts;
}

function longestIncreasingSavedIndexes(
  candidates: Array<[number, number]>
): Array<[number, number]> {
  if (candidates.length < 2) {
    return candidates;
  }

  const tails: number[] = [];
  const previous = Array<number>(candidates.length).fill(-1);

  for (let index = 0; index < candidates.length; index++) {
    const savedIndex = candidates[index][0];
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (candidates[tails[middle]][0] < savedIndex) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    if (low > 0) {
      previous[index] = tails[low - 1];
    }
    tails[low] = index;
  }

  const result: Array<[number, number]> = [];
  let index = tails[tails.length - 1];
  while (index >= 0) {
    result.push(candidates[index]);
    index = previous[index];
  }
  return result.reverse();
}

function splitLines(text: string): string[] {
  return text.split(/\r\n|\n|\r/);
}
