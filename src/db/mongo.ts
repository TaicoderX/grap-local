import mongoose from 'mongoose';

import type { AppEnv } from '../config/env.js';
import { getEnv } from '../config/env.js';
import { logger } from '../config/logger.js';

export const connectToMongo = async (env: AppEnv = getEnv()): Promise<typeof mongoose> => {
  if (mongoose.connection.readyState === mongoose.STATES.connected) {
    return mongoose;
  }

  mongoose.set('strictQuery', true);

  await mongoose.connect(env.MONGODB_URI, {
    dbName: env.DB_NAME
  });

  logger.info({ uri: env.MONGODB_URI, dbName: env.DB_NAME }, 'Connected to MongoDB');

  return mongoose;
};

export const disconnectFromMongo = async (): Promise<void> => {
  if (mongoose.connection.readyState === mongoose.STATES.disconnected) {
    return;
  }

  await mongoose.disconnect();
  logger.info('Disconnected from MongoDB');
};
