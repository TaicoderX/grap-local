import pino from 'pino';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pinoHttp } from 'pino-http';

import type { AppEnv } from './env.js';

const validLogLevels = new Set<AppEnv['LOG_LEVEL']>([
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent'
]);

const resolveLogLevel = (rawLevel: string | undefined): AppEnv['LOG_LEVEL'] => {
  if (rawLevel && validLogLevels.has(rawLevel as AppEnv['LOG_LEVEL'])) {
    return rawLevel as AppEnv['LOG_LEVEL'];
  }

  return 'info';
};

export const createLogger = (env?: Pick<AppEnv, 'LOG_LEVEL'>) => {
  return pino(
    {
      name: 'grap-local',
      level: resolveLogLevel(env?.LOG_LEVEL ?? process.env.LOG_LEVEL),
      timestamp: pino.stdTimeFunctions.isoTime
    },
    pino.destination({ fd: 2, sync: false })
  );
};

export const logger = createLogger();

export const createHttpLogger = (loggerInstance = logger) => {
  return pinoHttp({
    logger: loggerInstance,
    customSuccessMessage(request: IncomingMessage, response: ServerResponse) {
      return `${request.method} ${request.url} completed with ${response.statusCode}`;
    },
    customErrorMessage(request: IncomingMessage, response: ServerResponse, error: Error) {
      return `${request.method} ${request.url} failed with ${response.statusCode}: ${error.message}`;
    }
  });
};
