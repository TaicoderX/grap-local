import { config as loadEnvFile } from 'dotenv';
import { z } from 'zod';

const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

export const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  DB_NAME: z.string().min(1, 'DB_NAME is required'),
  LOG_LEVEL: z.enum(logLevels).default('info')
});

export type AppEnv = z.infer<typeof envSchema>;

export const parseEnv = (rawEnv: NodeJS.ProcessEnv): AppEnv => envSchema.parse(rawEnv);

let cachedEnv: AppEnv | undefined;

export const getEnv = (): AppEnv => {
  if (cachedEnv) {
    return cachedEnv;
  }

  loadEnvFile();
  cachedEnv = parseEnv(process.env);
  return cachedEnv;
};
