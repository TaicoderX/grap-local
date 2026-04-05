import { afterEach, describe, expect, it, vi } from 'vitest';

import { repositoryService } from '../src/modules/repo/repository.service.js';

describe('RepositoryService discovery', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('findRepositoryByName', () => {
    it('returns matching repos by name', async () => {
      const { RepositoryModel } = await import('../src/modules/repo/repository.model.js');
      const mockRepos = [
        {
          _id: { toString: () => 'repo-1' },
          name: 'my-frontend',
          rootPath: 'C:/projects/frontend',
          status: 'ready',
          lastIndexedAt: new Date('2026-01-01')
        },
        {
          _id: { toString: () => 'repo-2' },
          name: 'my-frontend-v2',
          rootPath: 'C:/projects/frontend-v2',
          status: 'pending',
          lastIndexedAt: undefined
        }
      ];

      vi.spyOn(RepositoryModel, 'find').mockReturnValue({
        sort: () => ({
          limit: () => ({
            exec: () => Promise.resolve(mockRepos)
          })
        })
      } as never);

      const results = await repositoryService.findRepositoryByName('frontend');

      expect(results).toHaveLength(2);
      expect(results[0]!.repoId).toBe('repo-1');
      expect(results[0]!.name).toBe('my-frontend');
      expect(results[0]!.status).toBe('ready');
      expect(results[1]!.repoId).toBe('repo-2');
    });

    it('returns empty array when no match', async () => {
      const { RepositoryModel } = await import('../src/modules/repo/repository.model.js');

      vi.spyOn(RepositoryModel, 'find').mockReturnValue({
        sort: () => ({
          limit: () => ({
            exec: () => Promise.resolve([])
          })
        })
      } as never);

      const results = await repositoryService.findRepositoryByName('nonexistent');

      expect(results).toHaveLength(0);
    });
  });

  describe('findRepositoryByPath', () => {
    it('returns matching repos by path fragment', async () => {
      const { RepositoryModel } = await import('../src/modules/repo/repository.model.js');
      const mockRepos = [
        {
          _id: { toString: () => 'repo-3' },
          name: 'backend',
          rootPath: 'C:/Users/dev/projects/backend',
          status: 'ready',
          lastIndexedAt: new Date()
        }
      ];

      vi.spyOn(RepositoryModel, 'find').mockReturnValue({
        sort: () => ({
          limit: () => ({
            exec: () => Promise.resolve(mockRepos)
          })
        })
      } as never);

      const results = await repositoryService.findRepositoryByPath('projects/backend');

      expect(results).toHaveLength(1);
      expect(results[0]!.name).toBe('backend');
      expect(results[0]!.rootPath).toContain('backend');
    });

    it('normalizes Windows backslashes in path queries', async () => {
      const { RepositoryModel } = await import('../src/modules/repo/repository.model.js');
      const findSpy = vi.spyOn(RepositoryModel, 'find').mockReturnValue({
        sort: () => ({
          limit: () => ({
            exec: () => Promise.resolve([])
          })
        })
      } as never);

      await repositoryService.findRepositoryByPath('C:\\Users\\dev\\projects');

      // The regex should use forward slashes (normalizePath converts \ to /)
      expect(findSpy).toHaveBeenCalled();
      const callArg = findSpy.mock.calls[0] as unknown as [{ rootPath: RegExp }];
      // normalizePath converts backslashes to forward slashes, then escapeRegex escapes the /
      expect(callArg[0].rootPath.source).toContain('Users');
      expect(callArg[0].rootPath.source).toContain('dev');
      expect(callArg[0].rootPath.source).toContain('projects');
    });
  });
});
