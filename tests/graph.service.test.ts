import { Types } from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as importResolutionModule from '../src/modules/graph/import-resolution.js';
import { graphService } from '../src/modules/graph/graph.service.js';
import { FileDocumentModel } from '../src/modules/indexing/file-document.model.js';
import { repositoryService } from '../src/modules/repo/repository.service.js';
import { symbolService } from '../src/modules/symbols/symbol.service.js';

describe('graphService.getFileImportDependencies', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves indexed relative or aliased imports and leaves package imports unresolved', async () => {
    const repoId = new Types.ObjectId();
    const fileId = new Types.ObjectId();
    const utilsFileId = new Types.ObjectId();

    vi.spyOn(symbolService, 'getFileOrThrow').mockResolvedValue({
      _id: fileId,
      repoId,
      path: 'src/alias-consumer.ts',
      importPaths: ['@/utils', 'react']
    } as never);
    vi.spyOn(repositoryService, 'getRepositoryOrThrow').mockResolvedValue({
      _id: repoId,
      rootPath: '/repo'
    } as never);
    vi.spyOn(FileDocumentModel, 'find').mockReturnValue({
      exec: vi.fn().mockResolvedValue([
        { _id: fileId, path: 'src/alias-consumer.ts' },
        { _id: utilsFileId, path: 'src/utils.ts' }
      ])
    } as never);
    vi.spyOn(importResolutionModule, 'loadImportResolutionConfig').mockResolvedValue({
      baseUrl: 'src',
      paths: {
        '@/*': ['*']
      }
    });

    const result = await graphService.getFileImportDependencies(fileId.toString());

    expect(result.file.path).toBe('src/alias-consumer.ts');
    expect(result.imports).toEqual([
      {
        importPath: '@/utils',
        resolvedFileId: utilsFileId.toString(),
        resolvedPath: 'src/utils.ts'
      },
      {
        importPath: 'react'
      }
    ]);
  });
});
