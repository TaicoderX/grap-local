import { createServer } from 'node:http';

import { getEnv } from './config/env.js';
import { logger } from './config/logger.js';
import { connectToMongo, disconnectFromMongo } from './db/mongo.js';
import { createApp } from './app.js';

const bootstrap = async (): Promise<void> => {
  const env = getEnv();
  await connectToMongo(env);

  const app = createApp();
  const server = createServer(app);

  server.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, 'grap-local REST server listening');
  });

  const shutdown = async () => {
    logger.info('Shutting down grap-local server');
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
    await disconnectFromMongo();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown();
  });

  process.on('SIGTERM', () => {
    void shutdown();
  });
};

void bootstrap().catch(async (error) => {
  logger.error({ error }, 'Failed to bootstrap grap-local');
  await disconnectFromMongo();
  process.exit(1);
});
