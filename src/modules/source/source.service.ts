import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { FileDocumentModel, type FileDocumentDocument } from '../indexing/file-document.model.js';
import { repositoryService } from '../repo/repository.service.js';
import type { SymbolDocument } from '../symbols/symbol.model.js';
import { AppError } from '../../shared/utils/error.js';
import { symbolService } from '../symbols/symbol.service.js';

/** Hard ceiling on lines returned in a single response. */
const MAX_RESPONSE_LINES = 500;
/** Default lines returned when no range is specified. */
const DEFAULT_MAX_LINES = 200;
/** Default context lines around a symbol span. */
const DEFAULT_CONTEXT_LINES = 5;
/** Maximum context lines around a symbol span. */
const MAX_CONTEXT_LINES = 50;

export interface ReadFileContentInput {
  /** Repository identifier. */
  repoId: string;
  /** Either a fileId (MongoDB ObjectId) or a repo-relative path. */
  fileIdOrPath: string;
  /** 1-indexed start line (inclusive). */
  startLine?: number | undefined;
  /** 1-indexed end line (inclusive). */
  endLine?: number | undefined;
  /** Maximum number of lines to return. Capped at MAX_RESPONSE_LINES. */
  maxLines?: number | undefined;
}

export interface ReadFileContentResult {
  fileId: string;
  path: string;
  totalLines: number;
  startLine: number;
  endLine: number;
  content: string;
  truncated: boolean;
  truncationMessage?: string | undefined;
}

export interface ReadSymbolSourceInput {
  symbolId: string;
  /** Extra lines before/after the symbol span. Capped at MAX_CONTEXT_LINES. */
  contextLines?: number | undefined;
}

export interface ReadSymbolSourceResult {
  symbolId: string;
  symbolName: string;
  symbolKind: string;
  filePath: string;
  fileId: string;
  totalFileLines: number;
  spanStartLine: number;
  spanEndLine: number;
  contextStartLine: number;
  contextEndLine: number;
  content: string;
  truncated: boolean;
  truncationMessage?: string | undefined;
}

const clampMaxLines = (requestedMax: number | undefined): number => {
  const capped = Math.min(requestedMax ?? DEFAULT_MAX_LINES, MAX_RESPONSE_LINES);
  return Math.max(capped, 1);
};

const resolveFileDocument = async (
  repoId: string,
  fileIdOrPath: string
): Promise<{ repository: Awaited<ReturnType<typeof repositoryService.getRepositoryOrThrow>>; file: FileDocumentDocument }> => {
  const repository = await repositoryService.getRepositoryOrThrow(repoId);

  // Try by ObjectId first
  let file: FileDocumentDocument | null = null;

  if (/^[0-9a-fA-F]{24}$/.test(fileIdOrPath)) {
    file = await FileDocumentModel.findOne({ _id: fileIdOrPath, repoId: repository._id }).exec();
  }

  // Fallback to path match
  if (!file) {
    file = await FileDocumentModel.findOne({ repoId: repository._id, path: fileIdOrPath }).exec();
  }

  if (!file) {
    throw new AppError(
      `File not found in repo ${repoId}: ${fileIdOrPath}`,
      404,
      'FILE_NOT_FOUND'
    );
  }

  return { repository, file };
};

const readFileLines = async (absolutePath: string): Promise<string[]> => {
  const content = await readFile(absolutePath, 'utf8').catch(() => {
    throw new AppError(`Unable to read file from disk: ${absolutePath}`, 404, 'FILE_READ_ERROR');
  });
  return content.split('\n');
};

export class SourceService {
  public async readFileContent(input: ReadFileContentInput): Promise<ReadFileContentResult> {
    const { repository, file } = await resolveFileDocument(input.repoId, input.fileIdOrPath);

    const absolutePath = path.join(repository.rootPath, file.path);
    const lines = await readFileLines(absolutePath);
    const totalLines = lines.length;
    const maxLines = clampMaxLines(input.maxLines);

    const startLine = Math.max(input.startLine ?? 1, 1);
    let endLine = Math.min(input.endLine ?? totalLines, totalLines);

    if (startLine > totalLines) {
      throw new AppError(
        `startLine ${startLine} exceeds total file lines (${totalLines})`,
        400,
        'INVALID_LINE_RANGE'
      );
    }

    if (endLine < startLine) {
      throw new AppError(
        `endLine ${endLine} is before startLine ${startLine}`,
        400,
        'INVALID_LINE_RANGE'
      );
    }

    // Apply maxLines cap
    let truncated = false;
    let truncationMessage: string | undefined;

    if (endLine - startLine + 1 > maxLines) {
      endLine = startLine + maxLines - 1;
      truncated = true;
      truncationMessage = `Output truncated to ${maxLines} lines. Total range had ${(input.endLine ?? totalLines) - startLine + 1} lines. Request a narrower range or adjust maxLines (cap: ${MAX_RESPONSE_LINES}).`;
    }

    const slice = lines.slice(startLine - 1, endLine);
    const content = slice.join('\n');

    return {
      fileId: file._id.toString(),
      path: file.path,
      totalLines,
      startLine,
      endLine,
      content,
      truncated,
      truncationMessage
    };
  }

  public async readSymbolSource(input: ReadSymbolSourceInput): Promise<ReadSymbolSourceResult> {
    const symbol: SymbolDocument = await symbolService.getSymbolOrThrow(input.symbolId);
    const file: FileDocumentDocument = await symbolService.getFileOrThrow(symbol.fileId.toString());
    const repository = await repositoryService.getRepositoryOrThrow(file.repoId.toString());

    const absolutePath = path.join(repository.rootPath, file.path);
    const lines = await readFileLines(absolutePath);
    const totalFileLines = lines.length;
    const contextLines = Math.min(Math.max(input.contextLines ?? DEFAULT_CONTEXT_LINES, 0), MAX_CONTEXT_LINES);

    const spanStartLine = symbol.startLine;
    const spanEndLine = symbol.endLine;
    const contextStartLine = Math.max(spanStartLine - contextLines, 1);
    let contextEndLine = Math.min(spanEndLine + contextLines, totalFileLines);

    let truncated = false;
    let truncationMessage: string | undefined;

    const rangeSize = contextEndLine - contextStartLine + 1;

    if (rangeSize > MAX_RESPONSE_LINES) {
      contextEndLine = contextStartLine + MAX_RESPONSE_LINES - 1;
      truncated = true;
      truncationMessage = `Symbol span plus context exceeded ${MAX_RESPONSE_LINES} lines. Output truncated. Symbol spans lines ${spanStartLine}-${spanEndLine}.`;
    }

    const slice = lines.slice(contextStartLine - 1, contextEndLine);
    const content = slice.join('\n');

    return {
      symbolId: symbol._id.toString(),
      symbolName: symbol.name,
      symbolKind: symbol.kind,
      filePath: file.path,
      fileId: file._id.toString(),
      totalFileLines,
      spanStartLine,
      spanEndLine,
      contextStartLine,
      contextEndLine,
      content,
      truncated,
      truncationMessage
    };
  }
}

export const sourceService = new SourceService();
