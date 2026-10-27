import fs from 'node:fs';
import { createRedisStore } from './redis.js';

// Upstash Redis when its credentials are set (Vercel's Storage tab sets the KV_* names,
// Upstash itself the UPSTASH_* names); otherwise SQLite on the local disk.
export async function openStore(config) {
  const env = process.env;
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return createRedisStore({ url, token });

  const { createSqliteStore } = await import('./sqlite.js');
  fs.mkdirSync(config.dataDir, { recursive: true });
  return createSqliteStore(config.dbFile);
}
