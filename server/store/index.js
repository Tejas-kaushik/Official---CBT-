import fs from 'node:fs';
import { createRedisStore } from './redis.js';

// Upstash Redis when its credentials are set; otherwise SQLite on the local disk.
// Vercel's Storage tab names them <PREFIX>_REST_API_URL / _TOKEN with a prefix the user picks
// (KV by default), Upstash itself UPSTASH_REDIS_REST_URL / _TOKEN.
function redisCredentials(env) {
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) return [env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN];
  const prefixes = Object.keys(env).filter(k => k.endsWith('_REST_API_URL')).map(k => k.slice(0, -'_REST_API_URL'.length));
  const prefix = ['KV', ...prefixes].find(p => env[`${p}_REST_API_URL`] && env[`${p}_REST_API_TOKEN`]);
  return prefix ? [env[`${prefix}_REST_API_URL`], env[`${prefix}_REST_API_TOKEN`]] : [];
}

export async function openStore(config) {
  const [url, token] = redisCredentials(process.env);
  if (url && token) return createRedisStore({ url, token });

  const { createSqliteStore } = await import('./sqlite.js');
  fs.mkdirSync(config.dataDir, { recursive: true });
  return createSqliteStore(config.dbFile);
}
