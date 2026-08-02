import type {
  Fleet as PrismaFleet,
  FleetDriver as PrismaFleetDriver,
  PrismaClient,
} from '@prisma/client';
import type { Fleet, FleetDriver, FleetRepository, FleetWithDrivers } from '../domain/index.js';

function toDriver(record: PrismaFleetDriver): FleetDriver {
  return {
    id: record.id,
    driverAddress: record.driverAddress,
    status: record.status,
    invitedAt: record.invitedAt,
    acceptedAt: record.acceptedAt,
    removedAt: record.removedAt,
  };
}

function toFleet(record: PrismaFleet): Fleet {
  return {
    id: record.id,
    chainFleetId: record.chainFleetId,
    ownerAddress: record.ownerAddress,
    treasuryAddress: record.treasuryAddress,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function toFleetWithDrivers(
  record: PrismaFleet & { drivers: PrismaFleetDriver[] },
): FleetWithDrivers {
  const drivers = record.drivers.map(toDriver);
  return {
    ...toFleet(record),
    drivers,
    totalActiveDrivers: drivers.filter((d) => d.status === 'ACTIVE' && d.removedAt === null).length,
  };
}

/**
 * `FleetDriver.fleetId` is the local `Fleet.id`, not the on-chain
 * `chainFleetId` every port method receives — driver-scoped methods resolve
 * the local fleet row first, same rationale as `FleetRepository`'s own
 * header comment in domain/ports.ts.
 */
export function createPrismaFleetRepository(prisma: PrismaClient): FleetRepository {
  return {
    async findByChainFleetId(chainFleetId) {
      const record = await prisma.fleet.findUnique({
        where: { chainFleetId },
        include: { drivers: true },
      });
      return record ? toFleetWithDrivers(record) : null;
    },

    async create(record) {
      const created = await prisma.fleet.create({
        data: {
          chainFleetId: record.chainFleetId,
          ownerAddress: record.ownerAddress,
          treasuryAddress: record.treasuryAddress,
        },
      });
      return toFleet(created);
    },

    async updateTreasury(chainFleetId, treasuryAddress) {
      await prisma.fleet.update({ where: { chainFleetId }, data: { treasuryAddress } });
    },

    async inviteDriver(chainFleetId, driverAddress, invitedAt) {
      const fleet = await prisma.fleet.findUnique({ where: { chainFleetId } });
      if (!fleet) return;

      // `upsert`, not `create`: a driver removed from the fleet earlier keeps
      // its row (soft delete) under the same (fleetId, driverAddress) unique
      // key, so a later re-invite must reset that row rather than violate
      // the constraint trying to insert a duplicate.
      await prisma.fleetDriver.upsert({
        where: { fleetId_driverAddress: { fleetId: fleet.id, driverAddress } },
        create: { fleetId: fleet.id, driverAddress, status: 'PENDING', invitedAt },
        update: { status: 'PENDING', invitedAt, acceptedAt: null, removedAt: null },
      });
    },

    async acceptInvite(chainFleetId, driverAddress, acceptedAt) {
      const fleet = await prisma.fleet.findUnique({ where: { chainFleetId } });
      if (!fleet) return;

      await prisma.fleetDriver.update({
        where: { fleetId_driverAddress: { fleetId: fleet.id, driverAddress } },
        data: { status: 'ACTIVE', acceptedAt },
      });
    },

    async removeDriver(chainFleetId, driverAddress, removedAt) {
      const fleet = await prisma.fleet.findUnique({ where: { chainFleetId } });
      if (!fleet) return;

      await prisma.fleetDriver.update({
        where: { fleetId_driverAddress: { fleetId: fleet.id, driverAddress } },
        data: { removedAt },
      });
    },
  };
}
