import { describe, expect, it } from 'vitest';

import { planIncrementalIndex } from '../src/modules/indexing/indexing.service.js';
import { hashContent } from '../src/shared/utils/hash.js';

describe('hashContent', () => {
  it('returns stable hashes for the same input', () => {
    const left = hashContent('hello world');
    const right = hashContent('hello world');

    expect(left).toBe(right);
    expect(hashContent('different')).not.toBe(left);
  });
});

describe('planIncrementalIndex', () => {
  it('separates changed, skipped, and deleted files', () => {
    const unchangedHash = hashContent('same');
    const changedHash = hashContent('new content');

    const result = planIncrementalIndex(
      [
        {
          absolutePath: '/repo/src/keep.ts',
          relativePath: 'src/keep.ts',
          extension: '.ts',
          contentHash: unchangedHash,
          lastModifiedAt: new Date('2024-01-01'),
          textPreview: 'same'
        },
        {
          absolutePath: '/repo/src/change.ts',
          relativePath: 'src/change.ts',
          extension: '.ts',
          contentHash: changedHash,
          lastModifiedAt: new Date('2024-01-01'),
          textPreview: 'new content'
        }
      ],
      [
        { path: 'src/keep.ts', contentHash: unchangedHash, indexedAt: new Date('2024-01-01') },
        { path: 'src/change.ts', contentHash: hashContent('old content'), indexedAt: new Date('2024-01-01') },
        { path: 'src/deleted.ts', contentHash: hashContent('gone'), indexedAt: new Date('2024-01-01') }
      ]
    );

    expect(result.changedFiles.map((file) => file.relativePath)).toEqual(['src/change.ts']);
    expect(result.skippedFiles.map((file) => file.relativePath)).toEqual(['src/keep.ts']);
    expect(result.deletedPaths).toEqual(['src/deleted.ts']);
  });

  it('skips a file when only the modification time changed', () => {
    const stableHash = hashContent('stable');

    const result = planIncrementalIndex(
      [
        {
          absolutePath: '/repo/src/stable.ts',
          relativePath: 'src/stable.ts',
          extension: '.ts',
          contentHash: stableHash,
          lastModifiedAt: new Date('2025-01-02'),
          textPreview: 'stable'
        }
      ],
      [{ path: 'src/stable.ts', contentHash: stableHash, indexedAt: new Date('2025-01-01') }]
    );

    expect(result.changedFiles).toEqual([]);
    expect(result.skippedFiles.map((file) => file.relativePath)).toEqual(['src/stable.ts']);
    expect(result.deletedPaths).toEqual([]);
  });

  it('reindexes a file when the previous refresh did not complete', () => {
    const stableHash = hashContent('stable');

    const result = planIncrementalIndex(
      [
        {
          absolutePath: '/repo/src/stable.ts',
          relativePath: 'src/stable.ts',
          extension: '.ts',
          contentHash: stableHash,
          lastModifiedAt: new Date('2025-01-02'),
          textPreview: 'stable'
        }
      ],
      [{ path: 'src/stable.ts', contentHash: stableHash }]
    );

    expect(result.changedFiles.map((file) => file.relativePath)).toEqual(['src/stable.ts']);
    expect(result.skippedFiles).toEqual([]);
    expect(result.deletedPaths).toEqual([]);
  });
});
