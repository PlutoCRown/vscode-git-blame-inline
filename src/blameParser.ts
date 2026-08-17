import { BlameInfo, UNCOMMITTED_HASH } from './types';

/** Parse `git blame --line-porcelain` output into a 1-based line map. */
export function parseBlameOutput(output: string): Map<number, BlameInfo> {
  const lines = output.split('\n');
  const blameMap = new Map<number, BlameInfo>();

  let currentHash = '';
  let currentAuthor = '';
  let currentAuthorEmail = '';
  let currentTimestamp = 0;
  let currentSummary = '';
  let currentLineNumber = 0;
  let currentPathAtCommit = '';
  let currentPreviousPath = '';

  for (const line of lines) {
    if (/^[0-9a-f]{40,64}\s/.test(line)) {
      const parts = line.split(' ');
      currentHash = parts[0];
      currentLineNumber = Number.parseInt(parts[2], 10);
      currentPathAtCommit = '';
      currentPreviousPath = '';
    } else if (line.startsWith('author ')) {
      currentAuthor = line.substring(7);
    } else if (line.startsWith('author-mail ')) {
      currentAuthorEmail = line.substring(12).replace(/^<|>$/g, '');
    } else if (line.startsWith('author-time ')) {
      currentTimestamp = Number.parseInt(line.substring(12), 10);
    } else if (line.startsWith('summary ')) {
      currentSummary = line.substring(8);
    } else if (line.startsWith('filename ')) {
      currentPathAtCommit = line.substring(9);
    } else if (line.startsWith('previous ')) {
      const previousParts = line.substring(9).split(' ');
      if (previousParts.length >= 2) {
        currentPreviousPath = previousParts.slice(1).join(' ');
      }
    } else if (line.startsWith('\t') && currentHash && currentLineNumber > 0) {
      const isUncommitted = currentHash === UNCOMMITTED_HASH;
      blameMap.set(currentLineNumber, {
        hash: currentHash,
        author: currentAuthor,
        authorEmail: currentAuthorEmail,
        timestamp: currentTimestamp,
        summary: currentSummary,
        lineNumber: currentLineNumber,
        isUncommitted,
        pathAtCommit: currentPathAtCommit || undefined,
        previousPath: currentPreviousPath || undefined
      });
    }
  }

  return blameMap;
}
