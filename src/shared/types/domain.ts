export const repositoryStatuses = ['pending', 'indexing', 'ready', 'error'] as const;
export type RepositoryStatus = (typeof repositoryStatuses)[number];

export const indexRunStatuses = [
  'running',
  'completed',
  'completed_with_errors',
  'failed'
] as const;
export type IndexRunStatus = (typeof indexRunStatuses)[number];

export const symbolKinds = [
  'function',
  'class',
  'method',
  'interface',
  'typeAlias',
  'enum',
  'variable'
] as const;
export type SymbolKind = (typeof symbolKinds)[number];

export const edgeTypes = ['calls', 'extends', 'implements'] as const;
export type EdgeType = (typeof edgeTypes)[number];

export const supportedLanguageHints = ['typescript', 'javascript'] as const;
export type LanguageHint = (typeof supportedLanguageHints)[number];

export type JsonObject = Record<string, unknown>;
