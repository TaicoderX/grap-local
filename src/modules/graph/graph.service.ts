import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { Types } from 'mongoose';

import { FileDocumentModel } from '../indexing/file-document.model.js';
import { repositoryService } from '../repo/repository.service.js';
import { SymbolDocumentModel } from '../symbols/symbol.model.js';
import { symbolService } from '../symbols/symbol.service.js';
import { EdgeDocumentModel } from './edge.model.js';
import { AppError } from '../../shared/utils/error.js';
import { loadImportResolutionConfig, resolveImportPath } from './import-resolution.js';

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export class GraphService {
  private assertObjectId(identifier: string, type: string): void {
    if (!Types.ObjectId.isValid(identifier)) {
      throw new AppError(`Invalid ${type} id: ${identifier}`, 400, `INVALID_${type.toUpperCase()}_ID`);
    }
  }

  public async getFileImportDependencies(fileId: string): Promise<{
    file: Awaited<ReturnType<typeof symbolService.getFileOrThrow>>;
    imports: Array<{
      importPath: string;
      resolvedFileId?: string;
      resolvedPath?: string;
    }>;
  }> {
    const file = await symbolService.getFileOrThrow(fileId);
    const repository = await repositoryService.getRepositoryOrThrow(file.repoId.toString());
    const [repositoryFiles, importResolutionConfig] = await Promise.all([
      FileDocumentModel.find({ repoId: file.repoId }, { _id: 1, path: 1 }).exec(),
      loadImportResolutionConfig(repository.rootPath)
    ]);
    const filePaths = repositoryFiles.map((repositoryFile) => repositoryFile.path);
    const fileByPath = new Map(repositoryFiles.map((repositoryFile) => [repositoryFile.path, repositoryFile]));
    const imports = file.importPaths.map((importPath) => {
      const resolvedPath = resolveImportPath({
        sourceFilePath: file.path,
        importPath,
        filePaths,
        config: importResolutionConfig
      });
      const resolvedFile = resolvedPath ? fileByPath.get(resolvedPath) : undefined;

      if (!resolvedFile) {
        return { importPath };
      }

      return {
        importPath,
        resolvedFileId: resolvedFile._id.toString(),
        resolvedPath: resolvedFile.path
      };
    });

    return {
      file,
      imports
    };
  }

  public async getFileContext(fileId: string): Promise<{
    file: Awaited<ReturnType<typeof symbolService.getFileOrThrow>>;
    imports: Awaited<ReturnType<GraphService['getFileImportDependencies']>>['imports'];
  }> {
    const fileImports = await this.getFileImportDependencies(fileId);

    return {
      file: fileImports.file,
      imports: fileImports.imports
    };
  }

  public async getCallersAndCallees(symbolId: string): Promise<{
    callers: Awaited<ReturnType<typeof SymbolDocumentModel.find>>;
    callees: Awaited<ReturnType<typeof SymbolDocumentModel.find>>;
  }> {
    this.assertObjectId(symbolId, 'symbol');

    const [incomingEdges, outgoingEdges] = await Promise.all([
      EdgeDocumentModel.find({ toSymbolId: symbolId }).exec(),
      EdgeDocumentModel.find({ fromSymbolId: symbolId }).exec()
    ]);

    const [callers, callees] = await Promise.all([
      SymbolDocumentModel.find({ _id: { $in: incomingEdges.map((edge) => edge.fromSymbolId) } }).exec(),
      SymbolDocumentModel.find({ _id: { $in: outgoingEdges.map((edge) => edge.toSymbolId) } }).exec()
    ]);

    return {
      callers,
      callees
    };
  }

  public async getSymbolContext(symbolId: string): Promise<{
    symbol: Awaited<ReturnType<typeof symbolService.getSymbolOrThrow>>;
    file: Awaited<ReturnType<typeof symbolService.getFileOrThrow>>;
    parent?: Awaited<ReturnType<typeof SymbolDocumentModel.findById>>;
    children: Awaited<ReturnType<typeof SymbolDocumentModel.find>>;
    siblingSymbols: Awaited<ReturnType<typeof SymbolDocumentModel.find>>;
    callers: Awaited<ReturnType<typeof SymbolDocumentModel.find>>;
    callees: Awaited<ReturnType<typeof SymbolDocumentModel.find>>;
    fileImports: Awaited<ReturnType<GraphService['getFileImportDependencies']>>['imports'];
    neighborhoodSummary: {
      filePath: string;
      siblingCount: number;
      childCount: number;
      directCallerCount: number;
      directCalleeCount: number;
      importCount: number;
    };
  }> {
    const { symbol, file } = await symbolService.getSymbolDefinition(symbolId);
    const [children, siblingSymbols, callersAndCallees, fileImports, parent] = await Promise.all([
      SymbolDocumentModel.find({ parentSymbolId: symbol._id }).sort({ startLine: 1 }).exec(),
      SymbolDocumentModel.find({
        fileId: symbol.fileId,
        _id: { $ne: symbol._id }
      })
        .sort({ startLine: 1 })
        .exec(),
      this.getCallersAndCallees(symbolId),
      this.getFileImportDependencies(file._id.toString()),
      symbol.parentSymbolId ? SymbolDocumentModel.findById(symbol.parentSymbolId).exec() : Promise.resolve(null)
    ]);

    return {
      symbol,
      file,
      parent: parent ?? undefined,
      children,
      siblingSymbols,
      callers: callersAndCallees.callers,
      callees: callersAndCallees.callees,
      fileImports: fileImports.imports,
      neighborhoodSummary: {
        filePath: file.path,
        siblingCount: siblingSymbols.length,
        childCount: children.length,
        directCallerCount: callersAndCallees.callers.length,
        directCalleeCount: callersAndCallees.callees.length,
        importCount: fileImports.imports.length
      }
    };
  }

  public async getSymbolImpact(symbolId: string, depth = 2): Promise<{
    rootSymbol: Awaited<ReturnType<typeof symbolService.getSymbolOrThrow>>;
    depth: number;
    relatedSymbols: Awaited<ReturnType<typeof SymbolDocumentModel.find>>;
    relatedFiles: Awaited<ReturnType<typeof FileDocumentModel.find>>;
    edges: Awaited<ReturnType<typeof EdgeDocumentModel.find>>;
  }> {
    const rootSymbol = await symbolService.getSymbolOrThrow(symbolId);
    let frontier = [rootSymbol._id];
    const visited = new Set([rootSymbol._id.toString()]);
    const edgeIds = new Set<string>();
    const collectedEdges: Awaited<ReturnType<typeof EdgeDocumentModel.find>> = [];

    for (let currentDepth = 0; currentDepth < depth; currentDepth += 1) {
      const edges = await EdgeDocumentModel.find({
        repoId: rootSymbol.repoId,
        $or: [{ fromSymbolId: { $in: frontier } }, { toSymbolId: { $in: frontier } }]
      }).exec();

      const nextFrontier: Types.ObjectId[] = [];

      for (const edge of edges) {
        if (!edgeIds.has(edge._id.toString())) {
          edgeIds.add(edge._id.toString());
          collectedEdges.push(edge);
        }

        const candidateIds = [edge.fromSymbolId, edge.toSymbolId];

        for (const candidateId of candidateIds) {
          const candidateIdString = candidateId.toString();

          if (visited.has(candidateIdString)) {
            continue;
          }

          visited.add(candidateIdString);
          nextFrontier.push(candidateId);
        }
      }

      if (nextFrontier.length === 0) {
        break;
      }

      frontier = nextFrontier;
    }

    const relatedSymbols = await SymbolDocumentModel.find({ _id: { $in: [...visited] } })
      .sort({ name: 1 })
      .exec();
    const relatedFiles = await FileDocumentModel.find({
      _id: { $in: [...new Set(relatedSymbols.map((symbol) => symbol.fileId.toString()))] }
    })
      .sort({ path: 1 })
      .exec();

    return {
      rootSymbol,
      depth,
      relatedSymbols,
      relatedFiles,
      edges: collectedEdges
    };
  }

  public async searchFiles(repoId: string, query: string, limit = 20): Promise<
    Array<{
      fileId: string;
      path: string;
      extension: string;
      matchedBy: string[];
      preview?: string;
    }>
  > {
    const repository = await repositoryService.getRepositoryOrThrow(repoId);
    const matcher = new RegExp(escapeRegex(query), 'i');
    const results = new Map<
      string,
      {
        fileId: string;
        path: string;
        extension: string;
        matchedBy: Set<string>;
        preview?: string;
      }
    >();

    const upsertResult = (fileId: string, filePath: string, extension: string, reason: string, preview?: string) => {
      const existingResult = results.get(fileId);

      if (existingResult) {
        existingResult.matchedBy.add(reason);

        if (!existingResult.preview && preview) {
          existingResult.preview = preview;
        }

        return;
      }

      const entry: {
        fileId: string;
        path: string;
        extension: string;
        matchedBy: Set<string>;
        preview?: string;
      } = {
        fileId,
        path: filePath,
        extension,
        matchedBy: new Set([reason])
      };

      if (preview) {
        entry.preview = preview;
      }

      results.set(fileId, entry);
    };

    const pathMatches = await FileDocumentModel.find({
      repoId: repository._id,
      $or: [{ path: matcher }, { importPaths: matcher }]
    })
      .limit(limit)
      .exec();

    for (const file of pathMatches) {
      upsertResult(file._id.toString(), file.path, file.extension, 'path', file.textPreview);
    }

    if (results.size < limit) {
      const symbolMatches = await SymbolDocumentModel.find({
        repoId: repository._id,
        name: matcher
      })
        .limit(limit * 3)
        .exec();
      const fileIds = [...new Set(symbolMatches.map((symbol) => symbol.fileId.toString()))];
      const files = await FileDocumentModel.find({ _id: { $in: fileIds } }).exec();
      const fileById = new Map(files.map((file) => [file._id.toString(), file]));

      for (const symbol of symbolMatches) {
        const file = fileById.get(symbol.fileId.toString());

        if (!file) {
          continue;
        }

        upsertResult(
          file._id.toString(),
          file.path,
          file.extension,
          `symbol:${symbol.name}`,
          file.textPreview
        );

        if (results.size >= limit) {
          break;
        }
      }
    }

    if (results.size < limit) {
      const candidateFiles = await FileDocumentModel.find({ repoId: repository._id })
        .sort({ path: 1 })
        .limit(200)
        .exec();

      for (const file of candidateFiles) {
        if (results.size >= limit) {
          break;
        }

        let preview = file.textPreview;
        let matched = preview?.toLowerCase().includes(query.toLowerCase()) ?? false;

        if (!matched) {
          const absolutePath = path.join(repository.rootPath, file.path);
          const contents = await readFile(absolutePath, 'utf8').catch(() => null);

          if (contents?.toLowerCase().includes(query.toLowerCase())) {
            matched = true;
            const previewIndex = contents.toLowerCase().indexOf(query.toLowerCase());
            preview = contents.slice(Math.max(0, previewIndex - 80), previewIndex + query.length + 80);
          }
        }

        if (matched) {
          upsertResult(file._id.toString(), file.path, file.extension, 'content', preview);
        }
      }
    }

    return [...results.values()].slice(0, limit).map((result) => {
      const output = {
        fileId: result.fileId,
        path: result.path,
        extension: result.extension,
        matchedBy: [...result.matchedBy]
      };

      if (result.preview) {
        return {
          ...output,
          preview: result.preview
        };
      }

      return output;
    });
  }
}

export const graphService = new GraphService();
