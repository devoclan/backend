import type { Escrow as PrismaEscrow, PrismaClient } from '@prisma/client';
import type { Escrow, EscrowRepository } from '../domain/index.js';

function toDomain(record: PrismaEscrow): Escrow {
  return {
    id: record.id,
    chainDeliveryId: record.chainDeliveryId,
    senderAddress: record.senderAddress,
    recipientAddress: record.recipientAddress,
    driverAddress: record.driverAddress,
    token: record.token,
    // Prisma's Decimal (decimal.js) switches to exponential notation past 21
    // digits by default — `.toString()` on an i128::MAX-sized value (39
    // digits) yields "1.7...e+38", which BigInt() can't parse. `.toFixed()`
    // always returns a plain fixed-point string regardless of magnitude.
    amount: BigInt(record.amount.toFixed()),
    platformFee: record.platformFee === null ? null : BigInt(record.platformFee.toFixed()),
    status: record.status,
    disputedBy: record.disputedBy,
    disputedAt: record.disputedAt,
    releasedAt: record.releasedAt,
    refundedAt: record.refundedAt,
    createdAtChain: record.createdAtChain,
  };
}

export function createPrismaEscrowRepository(prisma: PrismaClient): EscrowRepository {
  return {
    async findByChainDeliveryId(chainDeliveryId) {
      const record = await prisma.escrow.findUnique({ where: { chainDeliveryId } });
      return record ? toDomain(record) : null;
    },

    async create(record) {
      const created = await prisma.escrow.create({
        data: {
          chainDeliveryId: record.chainDeliveryId,
          senderAddress: record.senderAddress,
          recipientAddress: record.recipientAddress,
          driverAddress: record.driverAddress,
          token: record.token,
          amount: record.amount.toString(),
          status: record.status,
          disputedBy: record.disputedBy,
          disputedAt: record.disputedAt,
          createdAtChain: record.createdAtChain,
        },
      });
      return toDomain(created);
    },

    async updateStatus(chainDeliveryId, patch) {
      await prisma.escrow.update({
        where: { chainDeliveryId },
        data: {
          status: patch.status,
          ...(patch.platformFee !== undefined && { platformFee: patch.platformFee.toString() }),
          ...(patch.disputedBy !== undefined && { disputedBy: patch.disputedBy }),
          ...(patch.disputedAt !== undefined && { disputedAt: patch.disputedAt }),
          ...(patch.releasedAt !== undefined && { releasedAt: patch.releasedAt }),
          ...(patch.refundedAt !== undefined && { refundedAt: patch.refundedAt }),
        },
      });
    },
  };
}
