import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { PrismaClient } from '@prisma/client';
import {
  createGetCompletionRateUseCase,
  createGetDisputeRateUseCase,
  createGetDriverTierDistributionUseCase,
  createGetGmvUseCase,
} from './application/index.js';
import { createPrismaAnalyticsReader } from './infrastructure/index.js';
import { createAnalyticsRoutes } from './interface/routes.js';

/** No blockchain-event subscription here, unlike every other module —
 * `analytics` has nothing to write, only read models built by other
 * modules' handlers to aggregate over on request. Nothing for
 * `src/workers/index.ts` to wire either, for the same reason. */
export function createAnalyticsModule(prisma: PrismaClient): FastifyPluginAsyncZod {
  const analyticsReader = createPrismaAnalyticsReader(prisma);

  const useCases = {
    getGmv: createGetGmvUseCase({ analyticsReader }),
    getCompletionRate: createGetCompletionRateUseCase({ analyticsReader }),
    getDisputeRate: createGetDisputeRateUseCase({ analyticsReader }),
    getDriverTierDistribution: createGetDriverTierDistributionUseCase({ analyticsReader }),
  };

  return createAnalyticsRoutes(useCases);
}
