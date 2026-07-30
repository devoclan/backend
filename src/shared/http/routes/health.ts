import type { FastifyInstance } from 'fastify';
import { getPrismaClient } from '../../database/index.js';
import { getRedisClient } from '../../cache/index.js';

interface HealthStatus {
  status: 'ok' | 'degraded';
  database: 'ok' | 'error';
  redis: 'ok' | 'error';
}

/**
 * Liveness/readiness probe. Deliberately cheap (single SELECT 1 / PING) —
 * deeper checks like indexer lag live under /health/indexer once the
 * indexer module exists (ARCHITECTURE.md §6), not here.
 */
export default async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_request, reply) => {
    const [database, redis] = await Promise.all([
      getPrismaClient().$queryRaw`SELECT 1`.then(() => 'ok' as const).catch(() => 'error' as const),
      getRedisClient()
        .ping()
        .then(() => 'ok' as const)
        .catch(() => 'error' as const),
    ]);

    const body: HealthStatus = {
      status: database === 'ok' && redis === 'ok' ? 'ok' : 'degraded',
      database,
      redis,
    };

    void reply.status(body.status === 'ok' ? 200 : 503).send(body);
  });
}
