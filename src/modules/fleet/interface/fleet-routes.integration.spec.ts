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

describe.skipIf(!dbAvailable)('fleet routes (integration)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const prisma = new PrismaClient();
  const createdChainIds: bigint[] = [];

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    if (createdChainIds.length > 0) {
      await prisma.fleet.deleteMany({ where: { chainFleetId: { in: createdChainIds } } });
    }
    await prisma.$disconnect();
    await disconnectPrisma();
  });

  function nextChainId(): bigint {
    const id = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
    createdChainIds.push(id);
    return id;
  }

  async function seedFleet() {
    const chainFleetId = nextChainId();
    await prisma.fleet.create({
      data: {
        chainFleetId,
        ownerAddress: `GOWNER-${randomUUID()}`,
        treasuryAddress: `GTREASURY-${randomUUID()}`,
      },
    });
    return chainFleetId;
  }

  it('gets a single fleet by chain fleet id', async () => {
    const chainFleetId = await seedFleet();

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/fleets/${chainFleetId.toString()}`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<SuccessBody<{ chainFleetId: string; totalActiveDrivers: number }>>();
    expect(body.data.chainFleetId).toBe(chainFleetId.toString());
    expect(body.data.totalActiveDrivers).toBe(0);
  });

  it('returns 404 for an unknown fleet', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/fleets/999999999999999' });

    expect(response.statusCode).toBe(404);
    expect(response.json<ErrorBody>().error.code).toBe('NOT_FOUND');
  });

  it('rejects an unauthenticated transaction-build request', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions/build/register-fleet',
      payload: { ownerAddress: 'G'.padEnd(56, 'A'), treasuryAddress: 'G'.padEnd(56, 'B') },
    });

    expect(response.statusCode).toBe(401);
  });
});
