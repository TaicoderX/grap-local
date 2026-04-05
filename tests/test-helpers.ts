import { cp, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const sampleRepoFixtureRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'sample-repo'
);

export const createTempRepoCopy = async (): Promise<string> => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'grap-local-'));
  const repoPath = path.join(tempRoot, 'sample-repo');

  await cp(sampleRepoFixtureRoot, repoPath, {
    recursive: true
  });

  return repoPath;
};

export const cleanupTempRepo = async (repoPath: string): Promise<void> => {
  await rm(path.dirname(repoPath), {
    recursive: true,
    force: true
  });
};
