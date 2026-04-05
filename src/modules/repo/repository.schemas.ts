import { z } from 'zod';

import { supportedLanguageHints } from '../../shared/types/domain.js';

export const registerRepositorySchema = z.object({
  name: z.string().trim().min(1),
  rootPath: z.string().trim().min(1),
  languageHints: z.array(z.enum(supportedLanguageHints)).optional()
});

export const repoIdParamSchema = z.object({
  repoId: z.string().trim().min(1)
});

export const fileIdParamSchema = z.object({
  fileId: z.string().trim().min(1)
});

export const symbolIdParamSchema = z.object({
  symbolId: z.string().trim().min(1)
});

export const searchSymbolQuerySchema = z.object({
  q: z.string().trim().min(1),
  limit: z.coerce.number().int().positive().max(100).default(20)
});

export const searchFilesQuerySchema = z.object({
  q: z.string().trim().min(1),
  limit: z.coerce.number().int().positive().max(50).default(20)
});

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(100),
  offset: z.coerce.number().int().nonnegative().max(10000).default(0)
});

export const impactQuerySchema = z.object({
  depth: z.coerce.number().int().positive().max(5).default(2)
});

export type RegisterRepositoryInput = z.infer<typeof registerRepositorySchema>;
