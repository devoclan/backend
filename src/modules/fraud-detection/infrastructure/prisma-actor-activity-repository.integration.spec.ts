import { PrismaClient } from '@prisma/client';
import { Keypair } from '@stellar/stellar-sdk';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaActorActivityRepository } from './prisma-actor-activity-repository.js';
import { isDatabaseAvailable } from '../../../shared/testing/database.js';

const dbAvailable = await isDatabaseAvailable();

describe.skipIf(!dbAvailable)('Prisma actor activity repository (integration)', () => {
  const prisma = new PrismaClient();
  const activityRepository = createPrismaActorActivityRepository(prisma);
  const createdAddresses: string[] = [];

  afterAll(async () => {
    if (createdAddresses.length > 0) {
      await prisma.actorActivity.deleteMany({ where: { address: { in: createdAddresses } } });
    }
    await prisma.$disconnect();
  });

  function nextAddress(): string {
    const address = Keypair.random().publicKey();
    createdAddresses.push(address);
    return address;
  }

  it('records activity and counts it back within the window, excluding activity outside it', async () => {
    const address = nextAddress();
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

    await activityRepository.record({ address, category: 'DELIVERY_CREATED', occurredAt: now });
    await activityRepository.record({
      address,
      category: 'DELIVERY_CREATED',
      occurredAt: twoHoursAgo,
    });
    // Different category — must not be counted.
    await activityRepository.record({ address, category: 'DISPUTE_RAISED', occurredAt: now });

    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const count = await activityRepository.countSince(address, 'DELIVERY_CREATED', oneHourAgo);

    expect(count).toBe(1);
  });

  it('scopes counts to the given address only', async () => {
    const address = nextAddress();
    const other = nextAddress();
    const now = new Date();

    await activityRepository.record({ address, category: 'ESCROW_RELEASED', occurredAt: now });
    await activityRepository.record({
      address: other,
      category: 'ESCROW_RELEASED',
      occurredAt: now,
    });

    const count = await activityRepository.countSince(
      address,
      'ESCROW_RELEASED',
      new Date(now.getTime() - 1000),
    );

    expect(count).toBe(1);
  });
});
