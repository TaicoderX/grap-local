import type { Types } from 'mongoose';

import { logger } from '../../config/logger.js';
import type { FileAnalysis } from '../../shared/types/analysis.js';
import { AppError, serializeError, toErrorMessage } from '../../shared/utils/error.js';
import { EdgeDocumentModel } from '../graph/edge.model.js';
import { repositoryService } from '../repo/repository.service.js';
import { SymbolDocumentModel, type SymbolDocument } from '../symbols/symbol.model.js';
import { codeAnalyzer } from '../symbols/code-analyzer.js';
import { FileDocumentModel, type FileDocumentDocument } from './file-document.model.js';
import { IndexRunModel, type IndexRunDocument } from './index-run.model.js';
import { scanRepository, type ScannedSourceFile } from './scanner.js';

export interface IndexRepositoryResult {
  repositoryId: string;
  runId: string;
  scannedFiles: number;
  indexedFiles: number;
  skippedFiles: number;
  deletedFiles: number;
  errors: Array<{
    filePath?: string;
    message: string;
  }>;
  status: 'completed' | 'completed_with_errors' | 'failed';
}

export interface IndexedFileSnapshot {
  path: string;
  contentHash: string;
  indexedAt?: Date;
}

export interface ArtifactDeletionResult {
  deletedFileCount: number;
  deletedSymbolCount: number;
  deletedEdgeCount: number;
}

interface PersistedChangedFile {
  scannedFile: ScannedSourceFile;
  analysis: FileAnalysis;
  fileDocument: FileDocumentDocument;
  symbolIds: Types.ObjectId[];
  tempIdToSymbolId: Map<string, Types.ObjectId>;
  createdInRun: boolean;
}

const INDEX_RUN_LEASE_MS = 30 * 60 * 1000;

const groupByRelativePath = <T extends { relativePath: string }>(items: T[]): Map<string, T> => {
  return new Map(items.map((item) => [item.relativePath, item]));
};

const isDuplicateKeyError = (error: unknown): error is { code: number } => {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'number' &&
    (error as { code: number }).code === 11000
  );
};

const buildRunningRunRecoveryError = () => {
  return {
    message:
      'Recovered a stale running index run after the lease expired. The previous process may have crashed or been interrupted.'
  };
};

const buildSymbolParentUpdates = (
  analysis: FileAnalysis,
  tempIdToSymbolId: Map<string, Types.ObjectId>
) => {
  return analysis.symbols.flatMap((symbol) => {
    if (!symbol.parentTempId) {
      return [];
    }

    const childId = tempIdToSymbolId.get(symbol.tempId);
    const parentId = tempIdToSymbolId.get(symbol.parentTempId);

    if (!childId || !parentId) {
      return [];
    }

    return [
      {
        updateOne: {
          filter: { _id: childId },
          update: {
            $set: {
              parentSymbolId: parentId
            }
          }
        }
      }
    ];
  });
};

const groupSymbolsByFileId = (symbols: SymbolDocument[]): Map<string, SymbolDocument[]> => {
  const grouped = new Map<string, SymbolDocument[]>();

  for (const symbol of symbols) {
    const key = symbol.fileId.toString();
    const existing = grouped.get(key);

    if (existing) {
      existing.push(symbol);
      continue;
    }

    grouped.set(key, [symbol]);
  }

  return grouped;
};

export const planIncrementalIndex = (
  scannedFiles: ScannedSourceFile[],
  existingFiles: IndexedFileSnapshot[]
): {
  changedFiles: ScannedSourceFile[];
  skippedFiles: ScannedSourceFile[];
  deletedPaths: string[];
} => {
  const scannedByPath = groupByRelativePath(scannedFiles);
  const existingByPath = new Map(existingFiles.map((file) => [file.path, file]));
  const changedFiles: ScannedSourceFile[] = [];
  const skippedFiles: ScannedSourceFile[] = [];

  for (const scannedFile of scannedFiles) {
    const existingFile = existingByPath.get(scannedFile.relativePath);

    if (!existingFile || !existingFile.indexedAt || existingFile.contentHash !== scannedFile.contentHash) {
      changedFiles.push(scannedFile);
      continue;
    }

    skippedFiles.push(scannedFile);
  }

  return {
    changedFiles,
    skippedFiles,
    deletedPaths: existingFiles
      .filter((existingFile) => !scannedByPath.has(existingFile.path))
      .map((existingFile) => existingFile.path)
  };
};

export const selectDeletedFileDocuments = (
  existingFiles: FileDocumentDocument[],
  deletedPaths: string[]
): FileDocumentDocument[] => {
  const deletedPathSet = new Set(deletedPaths);
  return existingFiles.filter((file) => deletedPathSet.has(file.path));
};

export const deleteArtifactsForFiles = async (
  fileDocuments: FileDocumentDocument[]
): Promise<ArtifactDeletionResult> => {
  if (fileDocuments.length === 0) {
    return {
      deletedFileCount: 0,
      deletedSymbolCount: 0,
      deletedEdgeCount: 0
    };
  }

  const fileIds = fileDocuments.map((document) => document._id);
  const symbols = await SymbolDocumentModel.find({ fileId: { $in: fileIds } }, { _id: 1 }).exec();
  const symbolIds = symbols.map((symbol) => symbol._id);
  let deletedEdgeCount = 0;
  let deletedSymbolCount = 0;

  if (symbolIds.length > 0) {
    const [edgeDeletionResult, symbolDeletionResult] = await Promise.all([
      EdgeDocumentModel.deleteMany({
        $or: [{ fromSymbolId: { $in: symbolIds } }, { toSymbolId: { $in: symbolIds } }]
      }).exec(),
      SymbolDocumentModel.deleteMany({ _id: { $in: symbolIds } }).exec()
    ]);
    deletedEdgeCount = edgeDeletionResult.deletedCount ?? 0;
    deletedSymbolCount = symbolDeletionResult.deletedCount ?? symbolIds.length;
  }

  return {
    deletedFileCount: 0,
    deletedSymbolCount,
    deletedEdgeCount
  };
};

export const deleteFilesAndArtifacts = async (
  fileDocuments: FileDocumentDocument[]
): Promise<ArtifactDeletionResult> => {
  const artifactDeletionResult = await deleteArtifactsForFiles(fileDocuments);

  if (fileDocuments.length === 0) {
    return artifactDeletionResult;
  }

  const fileDeletionResult = await FileDocumentModel.deleteMany({
    _id: { $in: fileDocuments.map((file) => file._id) }
  }).exec();

  return {
    deletedFileCount: fileDeletionResult.deletedCount ?? fileDocuments.length,
    deletedSymbolCount: artifactDeletionResult.deletedSymbolCount,
    deletedEdgeCount: artifactDeletionResult.deletedEdgeCount
  };
};

export class IndexingService {
  private async recoverStaleRunningIndexRuns(repoId: Types.ObjectId): Promise<string[]> {
    const staleBefore = new Date(Date.now() - INDEX_RUN_LEASE_MS);
    const staleRuns = await IndexRunModel.find({
      repoId,
      status: 'running',
      startedAt: { $lte: staleBefore }
    }).exec();

    if (staleRuns.length === 0) {
      return [];
    }

    await IndexRunModel.updateMany(
      {
        _id: { $in: staleRuns.map((run) => run._id) }
      },
      {
        $set: {
          status: 'failed',
          finishedAt: new Date(),
          errors: [buildRunningRunRecoveryError()]
        }
      }
    ).exec();

    return staleRuns.map((run) => run._id.toString());
  }

  private async createIndexRunOrThrow(repoId: Types.ObjectId): Promise<IndexRunDocument> {
    try {
      return await IndexRunModel.create({
        repoId,
        startedAt: new Date(),
        scannedFiles: 0,
        indexedFiles: 0,
        skippedFiles: 0,
        errors: [],
        status: 'running'
      });
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }

      const activeRun = await IndexRunModel.findOne({
        repoId,
        status: 'running'
      })
        .sort({ startedAt: -1 })
        .exec();

      throw new AppError(
        `Repository is already being indexed: ${repoId.toString()}`,
        409,
        'REPOSITORY_INDEX_IN_PROGRESS',
        activeRun
          ? {
              runId: activeRun._id.toString(),
              startedAt: activeRun.startedAt.toISOString()
            }
          : undefined
      );
    }
  }

  private async getOrCreatePendingFileDocument(
    repositoryId: Types.ObjectId,
    scannedFile: ScannedSourceFile,
    existingFile?: FileDocumentDocument
  ): Promise<{
    fileDocument: FileDocumentDocument;
    createdInRun: boolean;
  }> {
    if (existingFile) {
      return {
        fileDocument: existingFile,
        createdInRun: false
      };
    }

    const fileDocument = await FileDocumentModel.create({
      repoId: repositoryId,
      path: scannedFile.relativePath,
      extension: scannedFile.extension,
      contentHash: scannedFile.contentHash,
      lastModifiedAt: scannedFile.lastModifiedAt,
      importPaths: [],
      symbolIds: [],
      textPreview: scannedFile.textPreview
    });

    return {
      fileDocument,
      createdInRun: true
    };
  }

  private async persistChangedFile(
    repositoryId: Types.ObjectId,
    scannedFile: ScannedSourceFile,
    analysis: FileAnalysis,
    existingFile?: FileDocumentDocument,
    existingSymbols: SymbolDocument[] = []
  ): Promise<PersistedChangedFile> {
    const { fileDocument, createdInRun } = await this.getOrCreatePendingFileDocument(
      repositoryId,
      scannedFile,
      existingFile
    );
    const symbolIds: Types.ObjectId[] = [];
    const tempIdToSymbolId = new Map<string, Types.ObjectId>();
    const nextFqNames = new Set(analysis.symbols.map((symbol) => symbol.fqName));

    for (const symbol of analysis.symbols) {
      const persistedSymbol = await SymbolDocumentModel.findOneAndUpdate(
        {
          repoId: repositoryId,
          fqName: symbol.fqName
        },
        {
          $set: {
            repoId: repositoryId,
            fileId: fileDocument._id,
            name: symbol.name,
            kind: symbol.kind,
            fqName: symbol.fqName,
            exported: symbol.exported,
            startLine: symbol.startLine,
            endLine: symbol.endLine,
            signature: symbol.signature,
            metadata: symbol.metadata
          },
          $unset: {
            parentSymbolId: 1
          }
        },
        {
          new: true,
          upsert: true,
          setDefaultsOnInsert: true
        }
      ).exec();

      symbolIds.push(persistedSymbol._id);
      tempIdToSymbolId.set(symbol.tempId, persistedSymbol._id);
    }

    const parentUpdates = buildSymbolParentUpdates(analysis, tempIdToSymbolId);

    if (parentUpdates.length > 0) {
      await SymbolDocumentModel.bulkWrite(parentUpdates);
    }

    const staleSymbols = existingSymbols.filter((symbol) => !nextFqNames.has(symbol.fqName));
    const staleSymbolIds = staleSymbols.map((symbol) => symbol._id);

    if (staleSymbolIds.length > 0) {
      await Promise.all([
        EdgeDocumentModel.deleteMany({
          $or: [{ fromSymbolId: { $in: staleSymbolIds } }, { toSymbolId: { $in: staleSymbolIds } }]
        }).exec(),
        SymbolDocumentModel.deleteMany({
          _id: { $in: staleSymbolIds }
        }).exec()
      ]);
    }

    return {
      scannedFile,
      analysis,
      fileDocument,
      symbolIds,
      tempIdToSymbolId,
      createdInRun
    };
  }

  public async indexRepository(repoId: string): Promise<IndexRepositoryResult> {
    const repository = await repositoryService.getRepositoryOrThrow(repoId);
    const recoveredRunIds = await this.recoverStaleRunningIndexRuns(repository._id);

    if (recoveredRunIds.length > 0) {
      logger.warn(
        {
          component: 'indexing',
          repoId: repository._id.toString(),
          recoveredRunIds
        },
        'Recovered stale running index runs before starting a new one'
      );
    }

    const indexRun = await this.createIndexRunOrThrow(repository._id);
    const indexLogger = logger.child({
      component: 'indexing',
      repoId: repository._id.toString(),
      runId: indexRun._id.toString()
    });
    const createdFileDocuments: FileDocumentDocument[] = [];

    repository.status = 'indexing';
    await repository.save();
    indexLogger.info({ rootPath: repository.rootPath }, 'Starting repository indexing');

    try {
      const scanResult = await scanRepository(repository.rootPath);
      const existingFiles = await FileDocumentModel.find({ repoId: repository._id }).exec();
      const indexPlan = planIncrementalIndex(scanResult.files, existingFiles);
      const changedFiles = indexPlan.changedFiles;
      const analysisResult =
        changedFiles.length > 0
          ? codeAnalyzer.analyzeRepository({
              repoRoot: repository.rootPath,
              allFiles: scanResult.files.map((file) => file.absolutePath),
              targetFiles: changedFiles.map((file) => file.absolutePath)
            })
          : { analyses: [], errors: [] };
      const errors = [...analysisResult.errors];
      const analysesByPath = new Map(analysisResult.analyses.map((analysis) => [analysis.relativePath, analysis]));
      const existingFilesByPath = new Map(existingFiles.map((file) => [file.path, file]));
      const existingSymbols = await SymbolDocumentModel.find({
        fileId: { $in: existingFiles.map((file) => file._id) }
      }).exec();
      const existingSymbolsByFileId = groupSymbolsByFileId(existingSymbols);
      const deletedFiles = selectDeletedFileDocuments(existingFiles, indexPlan.deletedPaths);
      const persistedChangedFiles: PersistedChangedFile[] = [];

      if (deletedFiles.length > 0) {
        await deleteFilesAndArtifacts(deletedFiles);
      }

      for (const changedFile of changedFiles) {
        const analysis = analysesByPath.get(changedFile.relativePath);

        if (!analysis) {
          errors.push({
            filePath: changedFile.relativePath,
            message: 'No analysis was produced for this changed file'
          });
          continue;
        }

        const persistedChangedFile = await this.persistChangedFile(
          repository._id,
          changedFile,
          analysis,
          existingFilesByPath.get(changedFile.relativePath),
          existingSymbolsByFileId.get(existingFilesByPath.get(changedFile.relativePath)?._id.toString() ?? '') ?? []
        );

        if (persistedChangedFile.createdInRun) {
          createdFileDocuments.push(persistedChangedFile.fileDocument);
        }

        persistedChangedFiles.push(persistedChangedFile);
      }

      const changedSourceSymbolIds = persistedChangedFiles.flatMap((file) => file.symbolIds);

      if (changedSourceSymbolIds.length > 0) {
        await EdgeDocumentModel.deleteMany({
          fromSymbolId: { $in: changedSourceSymbolIds }
        }).exec();
      }

      if (persistedChangedFiles.length > 0) {
        const currentSymbols = await SymbolDocumentModel.find(
          { repoId: repository._id },
          { _id: 1, fqName: 1 }
        ).exec();
        const symbolIdByFqName = new Map(currentSymbols.map((symbol) => [symbol.fqName, symbol._id]));
        const edgePayload: Array<{
          repoId: Types.ObjectId;
          fromSymbolId: Types.ObjectId;
          toSymbolId: Types.ObjectId;
          type: 'calls' | 'extends' | 'implements';
          metadata: Record<string, unknown>;
        }> = [];
        const seenEdges = new Set<string>();

        for (const persistedChangedFile of persistedChangedFiles) {
          for (const edge of persistedChangedFile.analysis.edges) {
            const fromSymbolId = persistedChangedFile.tempIdToSymbolId.get(edge.fromTempId);
            const toSymbolId = symbolIdByFqName.get(edge.toFqName);

            if (!fromSymbolId || !toSymbolId) {
              continue;
            }

            const dedupeKey = `${fromSymbolId.toString()}:${toSymbolId.toString()}:${edge.type}`;

            if (seenEdges.has(dedupeKey)) {
              continue;
            }

            seenEdges.add(dedupeKey);
            edgePayload.push({
              repoId: repository._id,
              fromSymbolId,
              toSymbolId,
              type: edge.type,
              metadata: edge.metadata
            });
          }
        }

        if (edgePayload.length > 0) {
          await EdgeDocumentModel.insertMany(edgePayload, { ordered: false });
        }
      }

      const indexedAt = new Date();

      for (const persistedChangedFile of persistedChangedFiles) {
        await FileDocumentModel.findByIdAndUpdate(persistedChangedFile.fileDocument._id, {
          $set: {
            extension: persistedChangedFile.scannedFile.extension,
            contentHash: persistedChangedFile.scannedFile.contentHash,
            lastModifiedAt: persistedChangedFile.scannedFile.lastModifiedAt,
            indexedAt,
            importPaths: persistedChangedFile.analysis.imports,
            symbolIds: persistedChangedFile.symbolIds,
            textPreview: persistedChangedFile.scannedFile.textPreview
          }
        }).exec();
      }

      repository.status = 'ready';
      repository.lastIndexedAt = indexedAt;
      await repository.save();

      const resultStatus = errors.length > 0 ? 'completed_with_errors' : 'completed';
      indexRun.finishedAt = new Date();
      indexRun.scannedFiles = scanResult.scannedFiles;
      indexRun.indexedFiles = persistedChangedFiles.length;
      indexRun.skippedFiles = indexPlan.skippedFiles.length;
      indexRun.set('errors', errors);
      indexRun.status = resultStatus;
      await indexRun.save();

      indexLogger[resultStatus === 'completed' ? 'info' : 'warn'](
        {
          scannedFiles: scanResult.scannedFiles,
          indexedFiles: persistedChangedFiles.length,
          skippedFiles: indexPlan.skippedFiles.length,
          deletedFiles: deletedFiles.length,
          errorCount: errors.length
        },
        'Repository indexing finished'
      );

      return {
        repositoryId: repository._id.toString(),
        runId: indexRun._id.toString(),
        scannedFiles: scanResult.scannedFiles,
        indexedFiles: persistedChangedFiles.length,
        skippedFiles: indexPlan.skippedFiles.length,
        deletedFiles: deletedFiles.length,
        errors,
        status: resultStatus
      };
    } catch (error) {
      if (createdFileDocuments.length > 0) {
        await deleteFilesAndArtifacts(createdFileDocuments).catch((cleanupError) => {
          indexLogger.warn(
            {
              error: serializeError(cleanupError),
              fileIds: createdFileDocuments.map((fileDocument) => fileDocument._id.toString())
            },
            'Failed to clean up newly created file documents after indexing failure'
          );
        });
      }

      repository.status = 'error';
      await repository.save();

      indexRun.finishedAt = new Date();
      indexRun.status = 'failed';
      indexRun.set('errors', [
        {
          message: toErrorMessage(error)
        }
      ]);
      await indexRun.save();

      indexLogger.error({ error: serializeError(error) }, 'Repository indexing failed');
      throw error;
    }
  }

  public async listRepositoryFiles(
    repoId: string,
    pagination: {
      limit: number;
      offset: number;
    } = {
      limit: 100,
      offset: 0
    }
  ): Promise<{
    files: FileDocumentDocument[];
    page: {
      total: number;
      limit: number;
      offset: number;
    };
  }> {
    const repository = await repositoryService.getRepositoryOrThrow(repoId);
    const [files, total] = await Promise.all([
      FileDocumentModel.find({ repoId: repository._id })
        .sort({ path: 1 })
        .skip(pagination.offset)
        .limit(pagination.limit)
        .exec(),
      FileDocumentModel.countDocuments({ repoId: repository._id }).exec()
    ]);

    return {
      files,
      page: {
        total,
        limit: pagination.limit,
        offset: pagination.offset
      }
    };
  }
}

export const indexingService = new IndexingService();
