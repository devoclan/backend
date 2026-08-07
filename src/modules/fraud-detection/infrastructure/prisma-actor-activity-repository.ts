import type { PrismaClient } from '@prisma/client';
import type { ActorActivityRepository } from '../domain/index.js';

export function createPrismaActorActivityRepository(prisma: PrismaClient): ActorActivityRepository {
  return {
    async record(input) {
      await prisma.actorActivity.create({
        data: { address: input.address, category: input.category, occurredAt: input.occurredAt },
      });
    },

    async countSince(address, category, since) {
      return prisma.actorActivity.count({
        where: { address, category, occurredAt: { gte: since } },
      });
    },
  };
}
