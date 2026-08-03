import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../app.js';
import { disconnectPrisma } from '../../../shared/database/index.js';
import { isDatabaseAvailable } from '../../../shared/testing/database.js';

const dbAvailable = await isDatabaseAvailable();

interface SuccessBody<T> {
  data: T;
}
interface ErrorBody {
  error: { code: string; message: string };
}

describe.skipIf(!dbAvailable)('dispute routes (integration)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const prisma = new PrismaClient();
  const createdChainIds: bigint[] = [];

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    if (createdChainIds.length > 0) {
      await prisma.dispute.deleteMany({ where: { chainDeliveryId: { in: createdChainIds } } });
      await prisma.delivery.deleteMany({ where: { chainDeliveryId: { in: createdChainIds } } });
    }
    await prisma.$disconnect();
    await disconnectPrisma();
  });

  function nextChainId(): bigint {
    const id = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
    createdChainIds.push(id);
    return id;
  }

  // Dispute.chainDeliveryId is a foreign key into Delivery.chainDeliveryId,
  // so every seeded dispute needs its parent delivery row created first.
  async function seedDispute() {
    const chainDeliveryId = nextChainId();
    await prisma.delivery.create({
      data: {
        chainDeliveryId,
        senderAddress: `GSENDER-${randomUUID()}`,
        recipientAddress: `GRECIPIENT-${randomUUID()}`,
        status: 'DISPUTED',
        origin: 'Lagos',
        destination: 'Accra',
        cargoCategory: 'GENERAL',
        weightGrams: 500,
        fragile: false,
        createdAtChain: new Date(),
      },
    });
    await prisma.dispute.create({
      data: {
        chainDeliveryId,
        status: 'OPEN',
        raisedBy: `GRAISER-${randomUUID()}`,
        raisedAt: new Date(),
      },
    });
    return chainDeliveryId;
  }

  it('gets a single dispute by chain delivery id, with an empty evidence list', async () => {
    const chainDeliveryId = await seedDispute();

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/disputes/${chainDeliveryId.toString()}`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<SuccessBody<{ status: string; evidence: unknown[] }>>();
    expect(body.data.status).toBe('OPEN');
    expect(body.data.evidence).toEqual([]);
  });

  it('returns 404 for an unknown dispute', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/disputes/999999999999999' });

    expect(response.statusCode).toBe(404);
    expect(response.json<ErrorBody>().error.code).toBe('NOT_FOUND');
  });

  it('rejects an unauthenticated evidence upload', async () => {
    const chainDeliveryId = await seedDispute();

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/disputes/${chainDeliveryId.toString()}/evidence`,
      payload: {
        uploadedBy: 'G'.padEnd(56, 'A'),
        contentType: 'image/png',
        base64Content: Buffer.from('fake').toString('base64'),
      },
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects an unauthenticated transaction-build request', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions/build/raise-dispute',
      payload: { callerAddress: 'G'.padEnd(56, 'A'), chainDeliveryId: '1' },
    });

    expect(response.statusCode).toBe(401);
  });
});
