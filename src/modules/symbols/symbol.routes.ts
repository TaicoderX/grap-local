import { Router } from 'express';

import { asyncHandler } from '../../shared/utils/async-handler.js';
import { graphService } from '../graph/graph.service.js';
import {
  fileIdParamSchema,
  impactQuerySchema,
  paginationQuerySchema,
  symbolIdParamSchema
} from '../repo/repository.schemas.js';
import { symbolService } from './symbol.service.js';

export const symbolRouter = Router();
export const fileRouter = Router();

symbolRouter.get(
  '/:symbolId',
  asyncHandler(async (request, response) => {
    const { symbolId } = symbolIdParamSchema.parse(request.params);
    const result = await symbolService.getSymbolDefinition(symbolId);

    response.json(result);
  })
);

symbolRouter.get(
  '/:symbolId/context',
  asyncHandler(async (request, response) => {
    const { symbolId } = symbolIdParamSchema.parse(request.params);
    const context = await graphService.getSymbolContext(symbolId);

    response.json(context);
  })
);

symbolRouter.get(
  '/:symbolId/impact',
  asyncHandler(async (request, response) => {
    const { symbolId } = symbolIdParamSchema.parse(request.params);
    const query = impactQuerySchema.parse(request.query);
    const impact = await graphService.getSymbolImpact(symbolId, query.depth);

    response.json(impact);
  })
);

fileRouter.get(
  '/:fileId',
  asyncHandler(async (request, response) => {
    const { fileId } = fileIdParamSchema.parse(request.params);
    const result = await graphService.getFileContext(fileId);
    response.json(result);
  })
);

fileRouter.get(
  '/:fileId/symbols',
  asyncHandler(async (request, response) => {
    const { fileId } = fileIdParamSchema.parse(request.params);
    const pagination = paginationQuerySchema.parse(request.query);
    const result = await symbolService.getFileSymbolsPage(fileId, pagination);

    response.json({
      symbols: result.symbols,
      page: result.page
    });
  })
);
