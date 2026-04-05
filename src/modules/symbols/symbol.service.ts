import { Types } from 'mongoose';

import { FileDocumentModel, type FileDocumentDocument } from '../indexing/file-document.model.js';
import { repositoryService } from '../repo/repository.service.js';
import { SymbolDocumentModel, type SymbolDocument } from './symbol.model.js';
import { AppError } from '../../shared/utils/error.js';

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export class SymbolService {
  public async findSymbolsByName(repoId: string, query: string, limit = 20): Promise<SymbolDocument[]> {
    const repository = await repositoryService.getRepositoryOrThrow(repoId);
    const matcher = new RegExp(escapeRegex(query), 'i');

    return SymbolDocumentModel.find({
      repoId: repository._id,
      $or: [{ name: matcher }, { fqName: matcher }]
    })
      .sort({ exported: -1, name: 1 })
      .limit(limit)
      .exec();
  }

  public async getSymbolOrThrow(symbolId: string): Promise<SymbolDocument> {
    if (!Types.ObjectId.isValid(symbolId)) {
      throw new AppError(`Invalid symbol id: ${symbolId}`, 400, 'INVALID_SYMBOL_ID');
    }

    const symbol = await SymbolDocumentModel.findById(symbolId).exec();

    if (!symbol) {
      throw new AppError(`Symbol not found: ${symbolId}`, 404, 'SYMBOL_NOT_FOUND');
    }

    return symbol;
  }

  public async getFileOrThrow(fileId: string): Promise<FileDocumentDocument> {
    if (!Types.ObjectId.isValid(fileId)) {
      throw new AppError(`Invalid file id: ${fileId}`, 400, 'INVALID_FILE_ID');
    }

    const file = await FileDocumentModel.findById(fileId).exec();

    if (!file) {
      throw new AppError(`File not found: ${fileId}`, 404, 'FILE_NOT_FOUND');
    }

    return file;
  }

  public async getSymbolDefinition(symbolId: string): Promise<{
    symbol: SymbolDocument;
    file: FileDocumentDocument;
  }> {
    const symbol = await this.getSymbolOrThrow(symbolId);
    const file = await this.getFileOrThrow(symbol.fileId.toString());

    return {
      symbol,
      file
    };
  }

  public async getFileSymbolsPage(
    fileId: string,
    pagination: {
      limit: number;
      offset: number;
    }
  ): Promise<{
    file: FileDocumentDocument;
    symbols: SymbolDocument[];
    page: {
      total: number;
      limit: number;
      offset: number;
    };
  }> {
    const file = await this.getFileOrThrow(fileId);
    const [symbols, total] = await Promise.all([
      SymbolDocumentModel.find({ fileId: file._id })
        .sort({ startLine: 1, name: 1 })
        .skip(pagination.offset)
        .limit(pagination.limit)
        .exec(),
      SymbolDocumentModel.countDocuments({ fileId: file._id }).exec()
    ]);

    return {
      file,
      symbols,
      page: {
        total,
        limit: pagination.limit,
        offset: pagination.offset
      }
    };
  }
}

export const symbolService = new SymbolService();
