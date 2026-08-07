/**
 * Safe, non-production default environment values for the test process.
 * Loaded once via vitest's `setupFiles` (see vitest.config.ts) — before this
 * runs, importing anything that calls `getConfig()` (src/shared/config)
 * would throw, since real deployments intentionally have no built-in
 * defaults for secrets/connection strings (fail fast, don't guess).
 *
 * Uses `??=` so a developer's real `.env`/shell exports are never
 * overridden — this only fills gaps for CI/sandbox runs that don't source
 * a real `.env`.
 */
process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??=
  'postgresql://fanilab:fanilab@localhost:5432/fanilab_backend_test?schema=public';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.JWT_ACCESS_SECRET ??= 'test-only-access-secret-not-for-production-use-0000';
process.env.JWT_REFRESH_SECRET ??= 'test-only-refresh-secret-not-for-production-use-0000';
// The rate limiter (src/shared/http/plugins/security.ts) is Redis-backed —
// deliberately shared across API instances, which also means every
// `*.integration.spec.ts` file's own `buildApp()` in one `pnpm test` run
// shares the same counter against real Redis, not a fresh one per file.
// The schema default (100/60s, src/shared/config/env.ts) is sized for a
// single real client, not dozens of test files each making several
// requests; left alone, the suite starts intermittently 429-ing its own
// later requests as more integration tests accumulate, unrelated to
// whatever that request was actually testing.
process.env.RATE_LIMIT_MAX ??= '100000';
