import { Router } from 'express';

import { asyncHandler } from '../../shared/utils/async-handler.js';
import { sourceService } from './source.service.js';
import {
  repoIdParamSchema,
  symbolIdParamSchema
} from '../repo/repository.schemas.js';
import { z } from 'zod';

export const sourceRouter = Router();

const readFileContentQuerySchema = z.object({
  fileIdOrPath: z.string().trim().min(1),
  startLine: z.coerce.number().int().positive().optional(),
  endLine: z.coerce.number().int().positive().optional(),
  maxLines: z.coerce.number().int().positive().max(500).optional()
});

const readSymbolSourceQuerySchema = z.object({
  contextLines: z.coerce.number().int().nonnegative().max(50).optional()
});

/**
 * GET /repos/:repoId/source?fileIdOrPath=&startLine=&endLine=&maxLines=
 *
 * Read bounded file content from an indexed repository.
 */
sourceRouter.get(
  '/repos/:repoId/source',
  asyncHandler(async (request, response) => {
    const { repoId } = repoIdParamSchema.parse(request.params);
    const query = readFileContentQuerySchema.parse(request.query);

    const result = await sourceService.readFileContent({
      repoId,
      fileIdOrPath: query.fileIdOrPath,
      startLine: query.startLine,
      endLine: query.endLine,
      maxLines: query.maxLines
    });

    response.json(result);
  })
);

/**
 * GET /symbols/:symbolId/source?contextLines=
 *
 * Read the source code for a specific symbol with optional context window.
 */
sourceRouter.get(
  '/symbols/:symbolId/source',
  asyncHandler(async (request, response) => {
    const { symbolId } = symbolIdParamSchema.parse(request.params);
    const query = readSymbolSourceQuerySchema.parse(request.query);

    const result = await sourceService.readSymbolSource({
      symbolId,
      contextLines: query.contextLines
    });

    response.json(result);
  })
);
