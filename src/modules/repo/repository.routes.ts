import { Router } from 'express';

import { asyncHandler } from '../../shared/utils/async-handler.js';
import {
  paginationQuerySchema,
  registerRepositorySchema,
  repoIdParamSchema,
  searchFilesQuerySchema,
  searchSymbolQuerySchema
} from './repository.schemas.js';
import { repositoryService } from './repository.service.js';
import { indexingService } from '../indexing/indexing.service.js';
import { symbolService } from '../symbols/symbol.service.js';
import { graphService } from '../graph/graph.service.js';
import { z } from 'zod';

const discoveryQuerySchema = z.object({
  q: z.string().trim().min(1),
  limit: z.coerce.number().int().positive().max(20).default(10)
});

export const repositoryRouter = Router();

repositoryRouter.post(
  '/register',
  asyncHandler(async (request, response) => {
    const input = registerRepositorySchema.parse(request.body);
    const repository = await repositoryService.registerRepository(input);

    response.status(201).json({ repository });
  })
);

repositoryRouter.get(
  '/',
  asyncHandler(async (_request, response) => {
    const repositories = await repositoryService.listRepositories();
    response.json({ repositories });
  })
);

repositoryRouter.post(
  '/:repoId/index',
  asyncHandler(async (request, response) => {
    const { repoId } = repoIdParamSchema.parse(request.params);
    const result = await indexingService.indexRepository(repoId);

    response.json({ result });
  })
);

repositoryRouter.get(
  '/:repoId/files',
  asyncHandler(async (request, response) => {
    const { repoId } = repoIdParamSchema.parse(request.params);
    const pagination = paginationQuerySchema.parse(request.query);
    const result = await indexingService.listRepositoryFiles(repoId, pagination);

    response.json(result);
  })
);

repositoryRouter.get(
  '/:repoId/files/search',
  asyncHandler(async (request, response) => {
    const { repoId } = repoIdParamSchema.parse(request.params);
    const query = searchFilesQuerySchema.parse(request.query);
    const files = await graphService.searchFiles(repoId, query.q, query.limit);

    response.json({ files });
  })
);

repositoryRouter.get(
  '/:repoId/status',
  asyncHandler(async (request, response) => {
    const { repoId } = repoIdParamSchema.parse(request.params);
    const result = await repositoryService.getRepositoryStatusSummary(repoId);

    response.json(result);
  })
);

repositoryRouter.get(
  '/:repoId/symbols/search',
  asyncHandler(async (request, response) => {
    const { repoId } = repoIdParamSchema.parse(request.params);
    const query = searchSymbolQuerySchema.parse(request.query);
    const symbols = await symbolService.findSymbolsByName(repoId, query.q, query.limit);

    response.json({ symbols });
  })
);

repositoryRouter.get(
  '/find-by-name',
  asyncHandler(async (request, response) => {
    const query = discoveryQuerySchema.parse(request.query);
    const repos = await repositoryService.findRepositoryByName(query.q, query.limit);

    response.json({ repos });
  })
);

repositoryRouter.get(
  '/find-by-path',
  asyncHandler(async (request, response) => {
    const query = discoveryQuerySchema.parse(request.query);
    const repos = await repositoryService.findRepositoryByPath(query.q, query.limit);

    response.json({ repos });
  })
);
