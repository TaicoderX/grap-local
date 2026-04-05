import { writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterAll, beforeAll, describe, expect, it, vi, afterEach } from 'vitest';

import { sourceService } from '../src/modules/source/source.service.js';
import { repositoryService } from '../src/modules/repo/repository.service.js';
import { symbolService } from '../src/modules/symbols/symbol.service.js';

describe('SourceService', () => {
  const tmpDir = path.join(os.tmpdir(), `grap-local-source-test-${Date.now()}`);
  const sampleFilePath = 'src/sample.ts';
  const sampleAbsPath = path.join(tmpDir, sampleFilePath);
  const sampleContent = Array.from({ length: 20 }, (_, i) => `// line ${i + 1}`).join('\n');

  beforeAll(async () => {
    await mkdir(path.join(tmpDir, 'src'), { recursive: true });
    await writeFile(sampleAbsPath, sampleContent, 'utf8');
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('readFileContent', () => {
    it('returns full file when no range specified', async () => {
      vi.spyOn(repositoryService, 'getRepositoryOrThrow').mockResolvedValue({
        _id: 'repo-1',
        rootPath: tmpDir
      } as never);

      const { FileDocumentModel } = await import('../src/modules/indexing/file-document.model.js');
      vi.spyOn(FileDocumentModel, 'findOne').mockReturnValue({
        exec: () =>
          Promise.resolve({
            _id: { toString: () => 'file-1' },
            repoId: 'repo-1',
            path: sampleFilePath
          })
      } as never);

      const result = await sourceService.readFileContent({
        repoId: 'repo-1',
        fileIdOrPath: sampleFilePath
      });

      expect(result.fileId).toBe('file-1');
      expect(result.path).toBe(sampleFilePath);
      expect(result.totalLines).toBe(20);
      expect(result.startLine).toBe(1);
      expect(result.endLine).toBe(20);
      expect(result.truncated).toBe(false);
      expect(result.content).toContain('// line 1');
      expect(result.content).toContain('// line 20');
    });

    it('returns a specific line range', async () => {
      vi.spyOn(repositoryService, 'getRepositoryOrThrow').mockResolvedValue({
        _id: 'repo-1',
        rootPath: tmpDir
      } as never);

      const { FileDocumentModel } = await import('../src/modules/indexing/file-document.model.js');
      vi.spyOn(FileDocumentModel, 'findOne').mockReturnValue({
        exec: () =>
          Promise.resolve({
            _id: { toString: () => 'file-1' },
            repoId: 'repo-1',
            path: sampleFilePath
          })
      } as never);

      const result = await sourceService.readFileContent({
        repoId: 'repo-1',
        fileIdOrPath: sampleFilePath,
        startLine: 5,
        endLine: 10
      });

      expect(result.startLine).toBe(5);
      expect(result.endLine).toBe(10);
      expect(result.content).toContain('// line 5');
      expect(result.content).toContain('// line 10');
      expect(result.content).not.toContain('// line 4');
      expect(result.content).not.toContain('// line 11');
      expect(result.truncated).toBe(false);
    });

    it('truncates when range exceeds maxLines', async () => {
      vi.spyOn(repositoryService, 'getRepositoryOrThrow').mockResolvedValue({
        _id: 'repo-1',
        rootPath: tmpDir
      } as never);

      const { FileDocumentModel } = await import('../src/modules/indexing/file-document.model.js');
      vi.spyOn(FileDocumentModel, 'findOne').mockReturnValue({
        exec: () =>
          Promise.resolve({
            _id: { toString: () => 'file-1' },
            repoId: 'repo-1',
            path: sampleFilePath
          })
      } as never);

      const result = await sourceService.readFileContent({
        repoId: 'repo-1',
        fileIdOrPath: sampleFilePath,
        startLine: 1,
        endLine: 20,
        maxLines: 5
      });

      expect(result.startLine).toBe(1);
      expect(result.endLine).toBe(5);
      expect(result.truncated).toBe(true);
      expect(result.truncationMessage).toContain('truncated');
    });

    it('throws on missing file', async () => {
      vi.spyOn(repositoryService, 'getRepositoryOrThrow').mockResolvedValue({
        _id: 'repo-1',
        rootPath: tmpDir
      } as never);

      const { FileDocumentModel } = await import('../src/modules/indexing/file-document.model.js');
      vi.spyOn(FileDocumentModel, 'findOne').mockReturnValue({
        exec: () => Promise.resolve(null)
      } as never);

      await expect(
        sourceService.readFileContent({
          repoId: 'repo-1',
          fileIdOrPath: 'nonexistent.ts'
        })
      ).rejects.toThrow('File not found');
    });

    it('throws on invalid line range (startLine > totalLines)', async () => {
      vi.spyOn(repositoryService, 'getRepositoryOrThrow').mockResolvedValue({
        _id: 'repo-1',
        rootPath: tmpDir
      } as never);

      const { FileDocumentModel } = await import('../src/modules/indexing/file-document.model.js');
      vi.spyOn(FileDocumentModel, 'findOne').mockReturnValue({
        exec: () =>
          Promise.resolve({
            _id: { toString: () => 'file-1' },
            repoId: 'repo-1',
            path: sampleFilePath
          })
      } as never);

      await expect(
        sourceService.readFileContent({
          repoId: 'repo-1',
          fileIdOrPath: sampleFilePath,
          startLine: 999
        })
      ).rejects.toThrow('exceeds total file lines');
    });
  });

  describe('readSymbolSource', () => {
    it('returns symbol source with context lines', async () => {
      vi.spyOn(symbolService, 'getSymbolOrThrow').mockResolvedValue({
        _id: { toString: () => 'sym-1' },
        name: 'myFunction',
        kind: 'function',
        fileId: { toString: () => 'file-1' },
        startLine: 5,
        endLine: 10
      } as never);

      vi.spyOn(symbolService, 'getFileOrThrow').mockResolvedValue({
        _id: { toString: () => 'file-1' },
        repoId: { toString: () => 'repo-1' },
        path: sampleFilePath
      } as never);

      vi.spyOn(repositoryService, 'getRepositoryOrThrow').mockResolvedValue({
        _id: 'repo-1',
        rootPath: tmpDir
      } as never);

      const result = await sourceService.readSymbolSource({
        symbolId: 'sym-1',
        contextLines: 2
      });

      expect(result.symbolName).toBe('myFunction');
      expect(result.symbolKind).toBe('function');
      expect(result.spanStartLine).toBe(5);
      expect(result.spanEndLine).toBe(10);
      expect(result.contextStartLine).toBe(3);
      expect(result.contextEndLine).toBe(12);
      expect(result.content).toContain('// line 3');
      expect(result.content).toContain('// line 12');
      expect(result.truncated).toBe(false);
    });

    it('clamps context lines at file boundaries', async () => {
      vi.spyOn(symbolService, 'getSymbolOrThrow').mockResolvedValue({
        _id: { toString: () => 'sym-1' },
        name: 'topSymbol',
        kind: 'function',
        fileId: { toString: () => 'file-1' },
        startLine: 1,
        endLine: 3
      } as never);

      vi.spyOn(symbolService, 'getFileOrThrow').mockResolvedValue({
        _id: { toString: () => 'file-1' },
        repoId: { toString: () => 'repo-1' },
        path: sampleFilePath
      } as never);

      vi.spyOn(repositoryService, 'getRepositoryOrThrow').mockResolvedValue({
        _id: 'repo-1',
        rootPath: tmpDir
      } as never);

      const result = await sourceService.readSymbolSource({
        symbolId: 'sym-1',
        contextLines: 10
      });

      expect(result.contextStartLine).toBe(1);
      expect(result.contextEndLine).toBeLessThanOrEqual(20);
      expect(result.truncated).toBe(false);
    });
  });
});
