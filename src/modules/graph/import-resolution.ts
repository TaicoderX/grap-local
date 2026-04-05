import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { ts } from 'ts-morph';

import { supportedSourceExtensions } from '../../shared/utils/path.js';
const directoryIndexExtensions = ['.ts', '.tsx', '.js', '.jsx'] as const;

export interface ImportResolutionConfig {
  baseUrl?: string;
  paths: Record<string, string[]>;
}

const toPosixRelative = (inputPath: string): string => inputPath.replace(/\\/g, '/');

const dedupe = (values: string[]): string[] => [...new Set(values)];

const matchPathPattern = (pattern: string, importPath: string): string[] => {
  const wildcardIndex = pattern.indexOf('*');

  if (wildcardIndex < 0) {
    return pattern === importPath ? [''] : [];
  }

  const prefix = pattern.slice(0, wildcardIndex);
  const suffix = pattern.slice(wildcardIndex + 1);

  if (!importPath.startsWith(prefix) || !importPath.endsWith(suffix)) {
    return [];
  }

  return [importPath.slice(prefix.length, importPath.length - suffix.length)];
};

const substitutePathPattern = (pattern: string, wildcardValue: string): string => {
  return pattern.includes('*') ? pattern.replace('*', wildcardValue) : pattern;
};

const buildCandidateVariants = (basePath: string): string[] => {
  const normalizedBasePath = path.posix.normalize(basePath);
  const extension = path.posix.extname(normalizedBasePath).toLowerCase();
  const withoutExtension =
    extension.length > 0 ? normalizedBasePath.slice(0, normalizedBasePath.length - extension.length) : normalizedBasePath;
  const candidatePaths: string[] = [];
  const pushCandidate = (candidatePath: string) => {
    candidatePaths.push(path.posix.normalize(candidatePath));
  };

  if (extension.length > 0) {
    pushCandidate(normalizedBasePath);
  }

  if (extension === '.js') {
    pushCandidate(`${withoutExtension}.ts`);
    pushCandidate(`${withoutExtension}.tsx`);
    pushCandidate(`${withoutExtension}.jsx`);
  } else if (extension === '.jsx') {
    pushCandidate(`${withoutExtension}.tsx`);
    pushCandidate(`${withoutExtension}.js`);
    pushCandidate(`${withoutExtension}.ts`);
  } else if (extension === '.mjs') {
    pushCandidate(`${withoutExtension}.mts`);
    pushCandidate(`${withoutExtension}.ts`);
    pushCandidate(`${withoutExtension}.js`);
  } else if (extension === '.cjs') {
    pushCandidate(`${withoutExtension}.cts`);
    pushCandidate(`${withoutExtension}.ts`);
    pushCandidate(`${withoutExtension}.js`);
  } else if (extension === '.mts') {
    pushCandidate(`${withoutExtension}.ts`);
    pushCandidate(`${withoutExtension}.mjs`);
  } else if (extension === '.cts') {
    pushCandidate(`${withoutExtension}.ts`);
    pushCandidate(`${withoutExtension}.cjs`);
  } else if (extension.length === 0) {
    for (const candidateExtension of supportedSourceExtensions) {
      pushCandidate(`${normalizedBasePath}${candidateExtension}`);
    }
  }

  const directoryBase = extension.length > 0 ? withoutExtension : normalizedBasePath;
  pushCandidate(directoryBase);

  for (const candidateExtension of directoryIndexExtensions) {
    pushCandidate(path.posix.join(directoryBase, `index${candidateExtension}`));
  }

  return dedupe(candidatePaths);
};

const resolveRelativeBasePath = (sourceFilePath: string, importPath: string): string => {
  return path.posix.normalize(path.posix.join(path.posix.dirname(sourceFilePath), importPath));
};

const resolveAliasBasePaths = (
  importPath: string,
  config: ImportResolutionConfig
): string[] => {
  const basePaths: string[] = [];

  for (const [pattern, targets] of Object.entries(config.paths)) {
    const wildcardValues = matchPathPattern(pattern, importPath);

    if (wildcardValues.length === 0) {
      continue;
    }

    for (const wildcardValue of wildcardValues) {
      for (const target of targets) {
        const substitutedTarget = substitutePathPattern(target, wildcardValue);
        const resolvedTarget = config.baseUrl
          ? path.posix.join(config.baseUrl, substitutedTarget)
          : substitutedTarget;

        basePaths.push(path.posix.normalize(resolvedTarget));
      }
    }
  }

  if (basePaths.length === 0 && config.baseUrl) {
    basePaths.push(path.posix.normalize(path.posix.join(config.baseUrl, importPath)));
  }

  return dedupe(basePaths);
};

export const resolveImportPath = (input: {
  sourceFilePath: string;
  importPath: string;
  filePaths: Iterable<string>;
  config?: ImportResolutionConfig;
}): string | undefined => {
  const availablePaths = new Set([...input.filePaths].map((filePath) => path.posix.normalize(filePath)));
  const basePaths = input.importPath.startsWith('.')
    ? [resolveRelativeBasePath(input.sourceFilePath, input.importPath)]
    : resolveAliasBasePaths(input.importPath, input.config ?? { paths: {} });

  for (const basePath of basePaths) {
    for (const candidatePath of buildCandidateVariants(basePath)) {
      if (availablePaths.has(candidatePath)) {
        return candidatePath;
      }
    }
  }

  return undefined;
};

export const loadImportResolutionConfig = async (repoRoot: string): Promise<ImportResolutionConfig> => {
  const configCandidates = ['tsconfig.json', 'jsconfig.json'];

  for (const configFileName of configCandidates) {
    const configFilePath = path.join(repoRoot, configFileName);
    const rawConfig = await readFile(configFilePath, 'utf8').catch(() => null);

    if (!rawConfig) {
      continue;
    }

    const parsedConfig = ts.parseConfigFileTextToJson(configFilePath, rawConfig);

    if (parsedConfig.error || !parsedConfig.config) {
      continue;
    }

    const parsedRootConfig = parsedConfig.config as
      | {
          compilerOptions?: {
            baseUrl?: string;
            paths?: Record<string, string[]>;
          };
        }
      | undefined;
    const compilerOptions = (parsedRootConfig?.compilerOptions ?? {}) as {
      baseUrl?: string;
      paths?: Record<string, string[]>;
    };
    const baseUrl = compilerOptions.baseUrl
      ? toPosixRelative(path.relative(repoRoot, path.resolve(repoRoot, compilerOptions.baseUrl)))
      : undefined;
    const config: ImportResolutionConfig = {
      paths: compilerOptions.paths ?? {}
    };

    if (baseUrl && baseUrl !== '') {
      config.baseUrl = path.posix.normalize(baseUrl);
    }

    return config;
  }

  return {
    paths: {}
  };
};
