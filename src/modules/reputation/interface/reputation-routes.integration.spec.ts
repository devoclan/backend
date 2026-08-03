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

describe.skipIf(!dbAvailable)('reputation routes (integration)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const prisma = new PrismaClient();
  const createdAddresses: string[] = [];

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    if (createdAddresses.length > 0) {
      await prisma.driverProfile.deleteMany({ where: { address: { in: createdAddresses } } });
    }
    await prisma.$disconnect();
    await disconnectPrisma();
  });

  async function seedDriverProfile() {
    const address = `GDRIVER-${randomUUID()}`;
    createdAddresses.push(address);
    await prisma.driverProfile.create({
      data: {
        address,
        reputationScore: 62,
        tier: 'SILVER',
        kycVerified: true,
        deliveriesCompleted: 4,
        legacyDeliveriesCompleted: 2,
        registeredAt: new Date(),
      },
    });
    return address;
  }

  it('gets a single driver profile by address', async () => {
    const address = await seedDriverProfile();

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/drivers/${address}/reputation`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<SuccessBody<{ tier: string; reputationScore: number }>>();
    expect(body.data.tier).toBe('SILVER');
    expect(body.data.reputationScore).toBe(62);
  });

  it('returns 404 for an unregistered driver address', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/drivers/${'G'.padEnd(56, 'Z')}/reputation`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json<ErrorBody>().error.code).toBe('NOT_FOUND');
  });

  it('rejects an unauthenticated transaction-build request', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions/build/register-driver',
      payload: { driverAddress: 'G'.padEnd(56, 'A') },
    });

    expect(response.statusCode).toBe(401);
  });
});
