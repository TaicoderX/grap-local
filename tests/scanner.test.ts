import { describe, expect, it } from 'vitest';

import { scanRepository } from '../src/modules/indexing/scanner.js';
import { sampleRepoFixtureRoot } from './test-helpers.js';

describe('scanRepository', () => {
  it('indexes only supported source files and respects ignore rules', async () => {
    const result = await scanRepository(sampleRepoFixtureRoot);

    expect(result.files.map((file) => file.relativePath)).toEqual([
      'src/alias-consumer.ts',
      'src/directory-consumer.ts',
      'src/edge-cases.ts',
      'src/index.ts',
      'src/js-specifier.ts',
      'src/nested/index.ts',
      'src/utils.ts'
    ]);
  });
});
