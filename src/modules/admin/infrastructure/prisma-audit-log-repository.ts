import type { AuditLog as PrismaAuditLog, Prisma, PrismaClient } from '@prisma/client';
import type { AuditLogEntry, AuditLogRepository } from '../domain/index.js';

function toDomain(record: PrismaAuditLog): AuditLogEntry {
  return {
    id: record.id,
    actorId: record.actorId,
    actorLabel: record.actorLabel,
    action: record.action,
    entityType: record.entityType,
    entityId: record.entityId,
    metadata: (record.metadata as Record<string, unknown> | null) ?? null,
    createdAt: record.createdAt,
  };
}

export function createPrismaAuditLogRepository(prisma: PrismaClient): AuditLogRepository {
  return {
    async record(input) {
      await prisma.auditLog.create({
        data: {
          actorId: input.actorId,
          actorLabel: input.actorLabel,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          ...(input.metadata !== undefined && {
            metadata: input.metadata as Prisma.InputJsonValue,
          }),
        },
      });
    },

    async list(limit) {
      const records = await prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
      return records.map(toDomain);
    },
  };
}
