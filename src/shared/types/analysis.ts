import type { EdgeType, JsonObject, SymbolKind } from './domain.js';

export interface ExtractedSymbol {
  tempId: string;
  name: string;
  kind: SymbolKind;
  fqName: string;
  exported: boolean;
  startLine: number;
  endLine: number;
  signature: string;
  parentTempId?: string;
  metadata: JsonObject;
}

export interface ExtractedEdge {
  fromTempId: string;
  toFqName: string;
  type: EdgeType;
  metadata: JsonObject;
}

export interface FileAnalysis {
  absolutePath: string;
  relativePath: string;
  imports: string[];
  symbols: ExtractedSymbol[];
  edges: ExtractedEdge[];
}

export interface AnalyzerError {
  filePath: string;
  message: string;
}

export interface RepositoryAnalysisResult {
  analyses: FileAnalysis[];
  errors: AnalyzerError[];
}
