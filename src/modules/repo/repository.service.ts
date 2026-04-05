import { stat } from 'node:fs/promises';
import path from 'node:path';

import { Types } from 'mongoose';

import { FileDocumentModel } from '../indexing/file-document.model.js';
import { IndexRunModel } from '../indexing/index-run.model.js';
import { RepositoryModel, type RepositoryDocument } from './repository.model.js';
import type { RegisterRepositoryInput } from './repository.schemas.js';
import { AppError } from '../../shared/utils/error.js';
import { normalizePath } from '../../shared/utils/path.js';

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Maximum repos returned from a discovery query. */
const MAX_DISCOVERY_RESULTS = 20;

export interface RepositoryDiscoveryResult {
  repoId: string;
  name: string;
  rootPath: string;
  status: string;
  lastIndexedAt?: Date | undefined;
}

const toDiscoveryResult = (repo: RepositoryDocument): RepositoryDiscoveryResult => ({
  repoId: repo._id.toString(),
  name: repo.name,
  rootPath: repo.rootPath,
  status: repo.status,
  lastIndexedAt: repo.lastIndexedAt
});

export class RepositoryService {
  public async registerRepository(input: RegisterRepositoryInput): Promise<RepositoryDocument> {
    const rootPath = path.resolve(input.rootPath);
    const rootPathStats = await stat(rootPath).catch(() => null);

    if (!rootPathStats?.isDirectory()) {
      throw new AppError(`Repository path does not exist or is not a directory: ${rootPath}`, 400, 'INVALID_REPOSITORY_PATH');
    }

    const repository = await RepositoryModel.findOneAndUpdate(
      { rootPath },
      {
        $set: {
          name: input.name.trim(),
          rootPath,
          languageHints: input.languageHints ?? ['typescript', 'javascript']
        },
        $setOnInsert: {
          status: 'pending'
        }
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true
      }
    );

    return repository;
  }

  public async listRepositories(): Promise<RepositoryDocument[]> {
    return RepositoryModel.find().sort({ name: 1 }).exec();
  }

  public async getRepositoryOrThrow(repoId: string): Promise<RepositoryDocument> {
    if (!Types.ObjectId.isValid(repoId)) {
      throw new AppError(`Invalid repository id: ${repoId}`, 400, 'INVALID_REPOSITORY_ID');
    }

    const repository = await RepositoryModel.findById(repoId).exec();

    if (!repository) {
      throw new AppError(`Repository not found: ${repoId}`, 404, 'REPOSITORY_NOT_FOUND');
    }

    return repository;
  }

  public async getRepositoryStatusSummary(repoId: string): Promise<{
    repository: RepositoryDocument;
    latestIndexRun: Awaited<ReturnType<typeof IndexRunModel.findOne>>;
    indexedFileCount: number;
  }> {
    const repository = await this.getRepositoryOrThrow(repoId);
    const [latestIndexRun, indexedFileCount] = await Promise.all([
      IndexRunModel.findOne({ repoId: repository._id }).sort({ startedAt: -1 }).exec(),
      FileDocumentModel.countDocuments({ repoId: repository._id }).exec()
    ]);

    return {
      repository,
      latestIndexRun,
      indexedFileCount
    };
  }

  /**
   * Find repositories whose name matches the query (case-insensitive substring).
   * Returns a bounded list of discovery results.
   */
  public async findRepositoryByName(query: string, limit?: number): Promise<RepositoryDiscoveryResult[]> {
    const matcher = new RegExp(escapeRegex(query.trim()), 'i');
    const repos = await RepositoryModel.find({ name: matcher })
      .sort({ name: 1 })
      .limit(Math.min(limit ?? MAX_DISCOVERY_RESULTS, MAX_DISCOVERY_RESULTS))
      .exec();

    return repos.map(toDiscoveryResult);
  }

  /**
   * Find repositories whose rootPath contains the given path fragment
   * (case-insensitive, forward-slash normalized).
   * Useful for agents that know a local directory but not the repoId.
   */
  public async findRepositoryByPath(queryPath: string, limit?: number): Promise<RepositoryDiscoveryResult[]> {
    const normalized = normalizePath(queryPath.trim());
    const matcher = new RegExp(escapeRegex(normalized), 'i');
    const repos = await RepositoryModel.find({ rootPath: matcher })
      .sort({ name: 1 })
      .limit(Math.min(limit ?? MAX_DISCOVERY_RESULTS, MAX_DISCOVERY_RESULTS))
      .exec();

    return repos.map(toDiscoveryResult);
  }
}

export const repositoryService = new RepositoryService();

