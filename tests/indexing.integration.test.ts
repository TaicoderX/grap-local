import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { connectToMongo, disconnectFromMongo } from '../src/db/mongo.js';
import { EdgeDocumentModel } from '../src/modules/graph/edge.model.js';
import { FileDocumentModel } from '../src/modules/indexing/file-document.model.js';
import { indexingService } from '../src/modules/indexing/indexing.service.js';
import { IndexRunModel } from '../src/modules/indexing/index-run.model.js';
import * as scannerModule from '../src/modules/indexing/scanner.js';
import { RepositoryModel } from '../src/modules/repo/repository.model.js';
import { repositoryService } from '../src/modules/repo/repository.service.js';
import { SymbolDocumentModel } from '../src/modules/symbols/symbol.model.js';
import { cleanupTempRepo, createTempRepoCopy } from './test-helpers.js';

const syncAllIndexes = async (): Promise<void> => {
  await Promise.all([
    RepositoryModel.syncIndexes(),
    FileDocumentModel.syncIndexes(),
    SymbolDocumentModel.syncIndexes(),
    EdgeDocumentModel.syncIndexes(),
    IndexRunModel.syncIndexes()
  ]);
};

const createDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    resolve,
    reject
  };
};

describe('indexingService integration', () => {
  let mongoServer: MongoMemoryServer;
  const tempRepos: string[] = [];

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectToMongo({
      PORT: 0,
      MONGODB_URI: mongoServer.getUri(),
      DB_NAME: 'grap_local_test',
      LOG_LEVEL: 'silent'
    });
  });

  beforeEach(async () => {
    await syncAllIndexes();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await mongoose.connection.db?.dropDatabase();
    await Promise.all(tempRepos.splice(0).map((repoPath) => cleanupTempRepo(repoPath)));
  });

  afterAll(async () => {
    await disconnectFromMongo();
    await mongoServer.stop();
  });

  it('skips unchanged files, preserves valid incoming edges, reindexes changed files, and cleans deleted files', async () => {
    const repoPath = await createTempRepoCopy();
    tempRepos.push(repoPath);

    const repository = await repositoryService.registerRepository({
      name: 'sample-repo',
      rootPath: repoPath
    });

    const firstRun = await indexingService.indexRepository(repository._id.toString());
    expect(firstRun.indexedFiles).toBe(7);
    expect(firstRun.skippedFiles).toBe(0);
    expect(firstRun.deletedFiles).toBe(0);

    const originalHelper = await SymbolDocumentModel.findOne({
      repoId: repository._id,
      fqName: 'src/utils.ts::helper'
    }).exec();
    const runSymbol = await SymbolDocumentModel.findOne({
      repoId: repository._id,
      fqName: 'src/index.ts::run'
    }).exec();
    expect(originalHelper).not.toBeNull();
    expect(runSymbol).not.toBeNull();
    expect(
      await EdgeDocumentModel.countDocuments({
        fromSymbolId: runSymbol?._id,
        toSymbolId: originalHelper?._id,
        type: 'calls'
      }).exec()
    ).toBe(1);

    const secondRun = await indexingService.indexRepository(repository._id.toString());
    expect(secondRun.indexedFiles).toBe(0);
    expect(secondRun.skippedFiles).toBe(7);
    expect(secondRun.deletedFiles).toBe(0);

    const utilsFilePath = path.join(repoPath, 'src', 'utils.ts');
    const originalUtils = await readFile(utilsFilePath, 'utf8');
    await writeFile(
      utilsFilePath,
      originalUtils.replace(
        'export function helper(name: string): string {\n  return name.toUpperCase();\n}',
        "export function helper(name: string, suffix = '!'): string {\n  return name.toUpperCase() + suffix;\n}"
      )
    );

    const thirdRun = await indexingService.indexRepository(repository._id.toString());
    expect(thirdRun.indexedFiles).toBe(1);
    expect(thirdRun.skippedFiles).toBe(6);

    const updatedHelper = await SymbolDocumentModel.findOne({
      repoId: repository._id,
      fqName: 'src/utils.ts::helper'
    }).exec();
    expect(updatedHelper?.signature).toContain("suffix = '!'");
    expect(updatedHelper?._id.toString()).toBe(originalHelper?._id.toString());
    expect(
      await EdgeDocumentModel.countDocuments({
        fromSymbolId: runSymbol?._id,
        toSymbolId: updatedHelper?._id,
        type: 'calls'
      }).exec()
    ).toBe(1);

    const deletedFile = await FileDocumentModel.findOne({
      repoId: repository._id,
      path: 'src/edge-cases.ts'
    }).exec();
    expect(deletedFile).not.toBeNull();

    const deletedFileSymbols = await SymbolDocumentModel.find({ fileId: deletedFile?._id }, { _id: 1 }).exec();
    expect(deletedFileSymbols.length).toBeGreaterThan(0);
    expect(
      await EdgeDocumentModel.countDocuments({
        $or: [
          { fromSymbolId: { $in: deletedFileSymbols.map((symbol) => symbol._id) } },
          { toSymbolId: { $in: deletedFileSymbols.map((symbol) => symbol._id) } }
        ]
      }).exec()
    ).toBeGreaterThan(0);

    await rm(path.join(repoPath, 'src', 'edge-cases.ts'));

    const fourthRun = await indexingService.indexRepository(repository._id.toString());
    expect(fourthRun.deletedFiles).toBe(1);
    expect(fourthRun.scannedFiles).toBe(6);
    expect(await FileDocumentModel.findOne({ repoId: repository._id, path: 'src/edge-cases.ts' }).exec()).toBeNull();
    expect(await SymbolDocumentModel.countDocuments({ fileId: deletedFile?._id }).exec()).toBe(0);
    expect(
      await EdgeDocumentModel.countDocuments({
        $or: [
          { fromSymbolId: { $in: deletedFileSymbols.map((symbol) => symbol._id) } },
          { toSymbolId: { $in: deletedFileSymbols.map((symbol) => symbol._id) } }
        ]
      }).exec()
    ).toBe(0);
  });

  it('retries a changed file after a failed refresh instead of falsely skipping it', async () => {
    const repoPath = await createTempRepoCopy();
    tempRepos.push(repoPath);

    const repository = await repositoryService.registerRepository({
      name: 'retry-after-failure',
      rootPath: repoPath
    });

    await indexingService.indexRepository(repository._id.toString());

    const indexFilePath = path.join(repoPath, 'src', 'index.ts');
    const originalIndex = await readFile(indexFilePath, 'utf8');
    await writeFile(
      indexFilePath,
      originalIndex.replace(
        'return helper(makeMessage(name)) + greeter.greet(name);',
        'return helper(makeMessage(name).trim()) + greeter.greet(name);'
      )
    );

    const fileBeforeFailure = await FileDocumentModel.findOne({
      repoId: repository._id,
      path: 'src/index.ts'
    }).exec();
    const previousHash = fileBeforeFailure?.contentHash;
    const insertManySpy = vi
      .spyOn(EdgeDocumentModel, 'insertMany')
      .mockRejectedValueOnce(new Error('forced edge failure'));

    await expect(indexingService.indexRepository(repository._id.toString())).rejects.toThrow('forced edge failure');

    const repositoryAfterFailure = await RepositoryModel.findById(repository._id).exec();
    const fileAfterFailure = await FileDocumentModel.findOne({
      repoId: repository._id,
      path: 'src/index.ts'
    }).exec();
    const latestFailedRun = await IndexRunModel.findOne({ repoId: repository._id }).sort({ startedAt: -1 }).exec();
    expect(repositoryAfterFailure?.status).toBe('error');
    expect(fileAfterFailure?.contentHash).toBe(previousHash);
    expect(latestFailedRun?.status).toBe('failed');

    insertManySpy.mockRestore();

    const retryRun = await indexingService.indexRepository(repository._id.toString());
    expect(retryRun.indexedFiles).toBe(1);
    expect(retryRun.skippedFiles).toBe(6);

    const repairedFile = await FileDocumentModel.findOne({
      repoId: repository._id,
      path: 'src/index.ts'
    }).exec();
    expect(repairedFile?.contentHash).not.toBe(previousHash);
  });

  it('rejects a concurrent index run for the same repository', async () => {
    const repoPath = await createTempRepoCopy();
    tempRepos.push(repoPath);

    const repository = await repositoryService.registerRepository({
      name: 'concurrent-guard',
      rootPath: repoPath
    });

    const analysisGate = createDeferred<void>();
    let notifyScanStarted = () => undefined;
    const scanStarted = new Promise<void>((resolve) => {
      notifyScanStarted = resolve;
    });
    const originalScanRepository = scannerModule.scanRepository;

    vi.spyOn(scannerModule, 'scanRepository').mockImplementation(async (repoRoot) => {
      notifyScanStarted();
      await analysisGate.promise;
      return originalScanRepository(repoRoot);
    });

    const firstRunPromise = indexingService.indexRepository(repository._id.toString());
    await scanStarted;

    await expect(indexingService.indexRepository(repository._id.toString())).rejects.toMatchObject({
      statusCode: 409,
      code: 'REPOSITORY_INDEX_IN_PROGRESS'
    });

    analysisGate.resolve();
    const firstRun = await firstRunPromise;

    expect(firstRun.indexedFiles).toBe(7);
    expect(await IndexRunModel.countDocuments({ repoId: repository._id, status: 'running' }).exec()).toBe(0);
  });

  it('recovers a stale running index run before starting a new one', async () => {
    const repoPath = await createTempRepoCopy();
    tempRepos.push(repoPath);

    const repository = await repositoryService.registerRepository({
      name: 'stale-run-recovery',
      rootPath: repoPath
    });
    repository.status = 'indexing';
    await repository.save();

    const staleRun = await IndexRunModel.create({
      repoId: repository._id,
      startedAt: new Date(Date.now() - 31 * 60 * 1000),
      scannedFiles: 0,
      indexedFiles: 0,
      skippedFiles: 0,
      errors: [],
      status: 'running'
    });

    const result = await indexingService.indexRepository(repository._id.toString());
    const recoveredRun = await IndexRunModel.findById(staleRun._id).exec();

    expect(result.indexedFiles).toBe(7);
    expect(recoveredRun?.status).toBe('failed');
    expect(recoveredRun?.errors[0]?.message).toContain('Recovered a stale running index run');
    expect(await IndexRunModel.countDocuments({ repoId: repository._id, status: 'running' }).exec()).toBe(0);
  });
});
