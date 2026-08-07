import type { FastifyInstance } from 'fastify';
import { getPrismaClient } from '../../database/index.js';
import { getRedisClient } from '../../cache/index.js';
import { getQueueHealth, type QueueCounts } from '../../queue/index.js';

interface HealthStatus {
  status: 'ok' | 'degraded';
  database: 'ok' | 'error';
  redis: 'ok' | 'error';
}

interface QueueHealthStatus {
  status: 'ok' | 'degraded';
  queues: QueueCounts[];
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

  /**
   * `degraded` whenever any monitored queue has ever produced a job that
   * exhausted all of its retries (`failed > 0`, per the 5-attempt
   * exponential-backoff default in `shared/queue/queues.ts`) — unlike
   * `/health/indexer`'s numeric lag threshold, there's no natural "how
   * many failures is acceptable" number to tune here, so any failure at
   * all is the signal.
   */
  app.get('/health/queue', async (_request, reply) => {
    const queues = await getQueueHealth();
    const body: QueueHealthStatus = {
      status: queues.every((queue) => queue.failed === 0) ? 'ok' : 'degraded',
      queues,
    };

    void reply.status(body.status === 'ok' ? 200 : 503).send(body);
  });
}
