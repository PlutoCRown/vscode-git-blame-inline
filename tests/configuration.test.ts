import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');

function readJson(relativePath: string): Record<string, any> {
  return JSON.parse(readFileSync(join(root, relativePath), 'utf8'));
}

describe('extension configuration', () => {
  test('exposes an independently configurable notebook blame option', () => {
    const packageJson = readJson('package.json');
    const setting =
      packageJson.contributes.configuration.properties[
        'gitBlameInline.notebookEnabled'
      ];

    expect(setting).toEqual({
      type: 'boolean',
      default: true,
      description: '%config.notebookEnabled%'
    });
  });

  test('localizes the notebook blame option', () => {
    const english = readJson('package.nls.json');
    const chinese = readJson('package.nls.zh-cn.json');

    expect(english['config.notebookEnabled']).toContain('Jupyter');
    expect(chinese['config.notebookEnabled']).toContain('Jupyter');
  });
});
