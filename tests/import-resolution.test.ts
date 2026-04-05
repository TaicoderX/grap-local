import { describe, expect, it } from 'vitest';

import { loadImportResolutionConfig, resolveImportPath } from '../src/modules/graph/import-resolution.js';
import { scanRepository } from '../src/modules/indexing/scanner.js';
import { sampleRepoFixtureRoot } from './test-helpers.js';

describe('resolveImportPath', () => {
  it('resolves common relative and alias import patterns', async () => {
    const scanResult = await scanRepository(sampleRepoFixtureRoot);
    const filePaths = scanResult.files.map((file) => file.relativePath);
    const config = await loadImportResolutionConfig(sampleRepoFixtureRoot);

    expect(
      resolveImportPath({
        sourceFilePath: 'src/js-specifier.ts',
        importPath: './utils.js',
        filePaths,
        config
      })
    ).toBe('src/utils.ts');

    expect(
      resolveImportPath({
        sourceFilePath: 'src/directory-consumer.ts',
        importPath: './nested',
        filePaths,
        config
      })
    ).toBe('src/nested/index.ts');

    expect(
      resolveImportPath({
        sourceFilePath: 'src/alias-consumer.ts',
        importPath: '@/utils',
        filePaths,
        config
      })
    ).toBe('src/utils.ts');

    expect(
      resolveImportPath({
        sourceFilePath: 'src/index.ts',
        importPath: 'react',
        filePaths,
        config
      })
    ).toBeUndefined();
  });
});
