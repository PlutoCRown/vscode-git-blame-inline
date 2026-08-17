import { describe, expect, test } from 'bun:test';
import {
  buildCommandUri,
  escapeMarkdownLinkTarget,
  escapeMarkdownText
} from '../src/markdownUtils';

describe('markdownUtils', () => {
  test('escapes repository-controlled Markdown text', () => {
    expect(escapeMarkdownText('[run](command:evil) *bold*')).toBe(
      '\\[run\\]\\(command:evil\\) \\*bold\\*'
    );
  });

  test('encodes spaces and parentheses in link targets', () => {
    expect(escapeMarkdownLinkTarget('https://example.com/team/a repo(test)')).toBe(
      'https://example.com/team/a%20repo%28test%29'
    );
  });

  test('encodes command arguments without global state', () => {
    const uri = buildCommandUri('git-blame-lite.showCommitDiff', [
      'abc123',
      'src/new name.ts',
      'src/old name.ts'
    ]);
    const query = uri.substring(uri.indexOf('?') + 1);

    expect(JSON.parse(decodeURIComponent(query))).toEqual([
      'abc123',
      'src/new name.ts',
      'src/old name.ts'
    ]);
  });
});
