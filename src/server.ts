import closeWithGrace from 'close-with-grace';
import { buildApp } from './app.js';
import { getConfig } from './shared/config/index.js';
import { logger } from './shared/logger/index.js';
import { disconnectPrisma } from './shared/database/index.js';
import { disconnectRedis } from './shared/cache/index.js';
import { disconnectQueueConnection, closeAllQueues } from './shared/queue/index.js';

async function main(): Promise<void> {
  const config = getConfig();
  const app = await buildApp();

  closeWithGrace({ delay: 10_000 }, async ({ err }: { err?: Error }) => {
    if (err) {
      logger.error({ err }, 'Shutting down due to unhandled error');
    } else {
      logger.info('Shutting down gracefully');
    }
    await app.close();
    await closeAllQueues();
    await Promise.all([disconnectPrisma(), disconnectRedis(), disconnectQueueConnection()]);
  });

  await app.listen({ host: config.HOST, port: config.PORT });
}

main().catch((error: unknown) => {
  logger.error({ err: error }, 'Failed to start server');
  process.exit(1);
});
