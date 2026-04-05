import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import ignore from 'ignore';

import type { Ignore } from 'ignore';
import { hashContent } from '../../shared/utils/hash.js';
import { isSupportedSourceFile, normalizePath, toRepoRelativePath } from '../../shared/utils/path.js';

const ignoredDirectoryNames = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.git',
  '.next',
  'vendor',
  'out',
  '.turbo'
]);

export interface ScannedSourceFile {
  absolutePath: string;
  relativePath: string;
  extension: string;
  contentHash: string;
  lastModifiedAt: Date;
  textPreview: string;
}

export interface ScanRepositoryResult {
  files: ScannedSourceFile[];
  scannedFiles: number;
}

const shouldIgnoreDirectoryName = (directoryName: string): boolean => {
  const lowered = directoryName.toLowerCase();

  return ignoredDirectoryNames.has(lowered) || lowered.includes('generated');
};

const loadIgnoreMatcher = async (rootPath: string): Promise<Ignore> => {
  const matcher = ignore();
  const gitIgnorePath = path.join(rootPath, '.gitignore');
  const gitIgnoreContents = await readFile(gitIgnorePath, 'utf8').catch(() => null);

  if (gitIgnoreContents) {
    matcher.add(gitIgnoreContents);
  }

  return matcher;
};

const shouldIgnorePath = (matcher: Ignore, relativePath: string, isDirectory: boolean): boolean => {
  const normalizedPath = normalizePath(relativePath);
  const candidate = isDirectory ? `${normalizedPath}/` : normalizedPath;

  return matcher.ignores(candidate);
};

export const scanRepository = async (rootPath: string): Promise<ScanRepositoryResult> => {
  const matcher = await loadIgnoreMatcher(rootPath);
  const files: ScannedSourceFile[] = [];

  const visitDirectory = async (currentAbsolutePath: string, currentRelativePath = ''): Promise<void> => {
    const entries = await readdir(currentAbsolutePath, {
      withFileTypes: true
    });

    for (const entry of entries) {
      const absolutePath = path.join(currentAbsolutePath, entry.name);
      const relativePath = currentRelativePath ? path.join(currentRelativePath, entry.name) : entry.name;

      if (entry.isDirectory()) {
        if (shouldIgnoreDirectoryName(entry.name) || shouldIgnorePath(matcher, relativePath, true)) {
          continue;
        }

        await visitDirectory(absolutePath, relativePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (shouldIgnorePath(matcher, relativePath, false) || !isSupportedSourceFile(absolutePath)) {
        continue;
      }

      const fileBuffer = await readFile(absolutePath);
      const fileStats = await stat(absolutePath);

      files.push({
        absolutePath,
        relativePath: toRepoRelativePath(rootPath, absolutePath),
        extension: path.extname(entry.name).toLowerCase(),
        contentHash: hashContent(fileBuffer),
        lastModifiedAt: fileStats.mtime,
        textPreview: fileBuffer.toString('utf8').slice(0, 400)
      });
    }
  };

  await visitDirectory(rootPath);

  return {
    files: files.sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
    scannedFiles: files.length
  };
};
