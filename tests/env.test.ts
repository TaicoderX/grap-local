import { describe, expect, it } from 'vitest';

import { parseEnv } from '../src/config/env.js';

describe('parseEnv', () => {
  it('parses required values and defaults', () => {
    const env = parseEnv({
      MONGODB_URI: 'mongodb://127.0.0.1:27017',
      DB_NAME: 'grap_local'
    });

    expect(env.PORT).toBe(4000);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.DB_NAME).toBe('grap_local');
  });

  it('throws when mongodb settings are missing', () => {
    expect(() => parseEnv({ PORT: '4000' })).toThrow();
  });
});
