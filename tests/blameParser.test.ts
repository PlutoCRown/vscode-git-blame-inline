import { describe, expect, test } from 'bun:test';
import { parseBlameOutput } from '../src/blameParser';
import { UNCOMMITTED_HASH } from '../src/types';

describe('parseBlameOutput', () => {
  test('parses committed blame metadata including rename paths', () => {
    const hash = 'a'.repeat(40);
    const previousHash = 'b'.repeat(40);
    const result = parseBlameOutput([
      `${hash} 3 7 1`,
      'author Alice Example',
      'author-mail <alice@example.com>',
      'author-time 1700000000',
      'summary Rename the file',
      `previous ${previousHash} src/old name.ts`,
      'filename src/new name.ts',
      '\tconst answer = 42;',
      ''
    ].join('\n'));

    expect(result.get(7)).toEqual({
      hash,
      author: 'Alice Example',
      authorEmail: 'alice@example.com',
      timestamp: 1700000000,
      summary: 'Rename the file',
      lineNumber: 7,
      isUncommitted: false,
      pathAtCommit: 'src/new name.ts',
      previousPath: 'src/old name.ts'
    });
  });

  test('marks the zero hash as uncommitted', () => {
    const result = parseBlameOutput([
      `${UNCOMMITTED_HASH} 1 1 1`,
      'author Not Committed Yet',
      'author-mail <not.committed.yet>',
      'author-time 0',
      'summary Version of src/file.ts from src/file.ts',
      'filename src/file.ts',
      '\tchanged line',
      ''
    ].join('\n'));

    expect(result.get(1)?.isUncommitted).toBe(true);
  });

  test('accepts SHA-256 object ids', () => {
    const hash = 'c'.repeat(64);
    const result = parseBlameOutput([
      `${hash} 1 2 1`,
      'author SHA User',
      'author-mail <sha@example.com>',
      'author-time 1700000001',
      'summary SHA-256 repository',
      'filename file.txt',
      '\tline',
      ''
    ].join('\n'));

    expect(result.get(2)?.hash).toBe(hash);
  });
});
