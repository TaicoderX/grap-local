import express from 'express';
import { ZodError } from 'zod';

import { createHttpLogger, logger } from './config/logger.js';
import { healthRouter } from './modules/health/health.routes.js';
import { repositoryRouter } from './modules/repo/repository.routes.js';
import { fileRouter, symbolRouter } from './modules/symbols/symbol.routes.js';
import { sourceRouter } from './modules/source/source.routes.js';
import { AppError, isAppError, serializeError } from './shared/utils/error.js';

export const createApp = () => {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.use(createHttpLogger());

  app.use('/health', healthRouter);
  app.use('/repos', repositoryRouter);
  app.use('/symbols', symbolRouter);
  app.use('/files', fileRouter);
  app.use(sourceRouter);

  app.use((request, _response, next) => {
    next(new AppError(`Route not found: ${request.method} ${request.originalUrl}`, 404, 'ROUTE_NOT_FOUND'));
  });

  app.use((error: unknown, request: express.Request, response: express.Response) => {
    if (error instanceof ZodError) {
      logger.warn(
        {
          method: request.method,
          path: request.originalUrl,
          error: {
            code: 'VALIDATION_ERROR',
            issues: error.issues
          }
        },
        'Request validation failed'
      );
      response.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: error.issues
        }
      });
      return;
    }

    if (isAppError(error)) {
      logger.warn(
        {
          method: request.method,
          path: request.originalUrl,
          error: serializeError(error)
        },
        'Handled application error'
      );
      response.status(error.statusCode).json({
        error: {
          code: error.code,
          message: error.message,
          details: error.details
        }
      });
      return;
    }

    logger.error(
      {
        method: request.method,
        path: request.originalUrl,
        error: serializeError(error)
      },
      'Unhandled application error'
    );
    response.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred'
      }
    });
  });

  return app;
};
