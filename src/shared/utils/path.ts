import path from 'node:path';

export const supportedSourceExtensions = ['.ts', '.tsx', '.js', '.jsx'] as const;

export const normalizePath = (inputPath: string): string => {
  return inputPath.split(path.sep).join('/');
};

export const toAbsolutePath = (inputPath: string): string => {
  return path.resolve(inputPath);
};

export const toRepoRelativePath = (rootPath: string, absolutePath: string): string => {
  return normalizePath(path.relative(rootPath, absolutePath));
};

export const isSupportedSourceFile = (filePath: string): boolean => {
  const extension = path.extname(filePath).toLowerCase();

  if (!supportedSourceExtensions.includes(extension as (typeof supportedSourceExtensions)[number])) {
    return false;
  }

  return !filePath.endsWith('.d.ts');
};

export const toPosixPath = (inputPath: string): string => {
  return inputPath.replace(/\\/g, '/');
};
