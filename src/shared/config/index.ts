import { parseEnv, type Env } from './env.js';

let cachedConfig: Env | undefined;

/**
 * Lazily parsed, memoized application config. Lazy so that test suites can
 * set process.env before first access instead of racing module import order.
 */
export function getConfig(): Env {
  cachedConfig ??= parseEnv();
  return cachedConfig;
}

export type { Env } from './env.js';
