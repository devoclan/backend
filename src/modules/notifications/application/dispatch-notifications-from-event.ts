import type { BlockchainEventEnvelope } from '../../../shared/events/index.js';
import { logger } from '../../../shared/logger/index.js';
import type {
  NotificationJobScheduler,
  NotificationRepository,
  UserContactLookup,
} from '../domain/index.js';

const log = logger.child({ module: 'dispatch-notifications-from-event' });

export interface DispatchNotificationsFromEventDeps {
  notificationRepository: NotificationRepository;
  userContactLookup: UserContactLookup;
  jobScheduler: NotificationJobScheduler;
}

interface NotificationCandidate {
  address: string;
  type: string;
  payload: Record<string, unknown>;
}

/**
 * Reacts to the same in-process event bus every other module subscribes to
 * (`src/shared/events`), turning a handful of on-chain events into
 * `Notification` rows for whichever actor address the event names — never
 * every event across all five tracked contracts.
 *
 * **Scope is deliberately narrow**: only events whose *own* topic/payload
 * names an actor address directly are handled here. Several otherwise
 * interesting lifecycle events (`delivery_created`, `delivery_confirmed`,
 * `escrow_funded`, `escrow_released`, `dispute_resolved_*`, ...) carry only
 * a delivery/fleet id, not an address — reading who to notify would mean
 * either a supplementary contract read (duplicating `deliveries`/`escrow`'s
 * own job) or reaching into another module's read-model table (the one
 * cross-module-access rule this backend has held to everywhere else, see
 * `domain/ports.ts`'s `UserContactLookup` header for the one deliberate,
 * schema-sanctioned exception). Documented gap, not an oversight — the same
 * "document rather than guess" posture `disputes`/`reputation`/`escrow`
 * already apply to their own sparse-payload cases.
 *
 * A candidate address with no linked+verified local account is silently
 * skipped, not an error — not every on-chain actor necessarily has an
 * account on this backend.
 */
export function createDispatchNotificationsFromEventUseCase(
  deps: DispatchNotificationsFromEventDeps,
) {
  return async function dispatchNotificationsFromEvent(
    event: BlockchainEventEnvelope,
  ): Promise<void> {
    const candidate = resolveCandidate(event);
    if (!candidate) return;

    const contact = await deps.userContactLookup.findByWalletAddress(candidate.address);
    if (!contact) return;

    const notification = await deps.notificationRepository.create({
      userId: contact.userId,
      channel: 'EMAIL',
      type: candidate.type,
      payload: candidate.payload,
    });

    try {
      await deps.jobScheduler.enqueueDelivery(notification.id);
    } catch (error: unknown) {
      log.error(
        { err: error, notificationId: notification.id },
        'Failed to enqueue notification delivery job',
      );
    }
  };
}

function resolveCandidate(event: BlockchainEventEnvelope): NotificationCandidate | null {
  const payload = Array.isArray(event.payload) ? event.payload : [];

  switch (event.contractName) {
    case 'delivery': {
      if (event.topic[0] !== 'driver_assigned') return null;
      const chainDeliveryId = parseId(payload[0]);
      const driverAddress = parseAddress(payload[1]);
      if (chainDeliveryId === null || driverAddress === null) return null;
      return {
        address: driverAddress,
        type: 'delivery.driver_assigned',
        payload: { chainDeliveryId },
      };
    }

    case 'escrow': {
      if (event.topic[0] !== 'delivery_disputed') return null;
      const chainDeliveryId = parseId(event.topic[1]);
      const disputedBy = parseAddress(payload[0]);
      if (chainDeliveryId === null || disputedBy === null) return null;
      return {
        address: disputedBy,
        type: 'escrow.delivery_disputed',
        payload: { chainDeliveryId },
      };
    }

    case 'dispute-resolution': {
      if (event.topic[0] !== 'dispute_raised') return null;
      const chainDeliveryId = parseTupleWrappedId(event.topic[1]);
      const raisedBy = parseAddress(payload[0]);
      if (chainDeliveryId === null || raisedBy === null) return null;
      return {
        address: raisedBy,
        type: 'dispute.dispute_raised',
        payload: { chainDeliveryId },
      };
    }

    case 'identity-reputation': {
      const eventName = event.topic[0];
      if (
        eventName !== 'driver_registered' &&
        eventName !== 'kyc_status_updated' &&
        eventName !== 'reputation_increased' &&
        eventName !== 'reputation_decreased'
      ) {
        return null;
      }
      const driverAddress = parseAddress(payload[0]);
      if (driverAddress === null) return null;
      return {
        address: driverAddress,
        type: `reputation.${eventName}`,
        payload: {},
      };
    }

    case 'fleet': {
      const eventName = event.topic[0];
      const chainFleetId = parseId(payload[0]);
      if (chainFleetId === null) return null;

      if (eventName === 'fleet_registered') {
        const ownerAddress = parseAddress(payload[1]);
        if (ownerAddress === null) return null;
        return { address: ownerAddress, type: 'fleet.fleet_registered', payload: { chainFleetId } };
      }

      if (
        eventName === 'driver_invited' ||
        eventName === 'invite_accepted' ||
        eventName === 'driver_removed'
      ) {
        const driverAddress = parseAddress(payload[1]);
        if (driverAddress === null) return null;
        return { address: driverAddress, type: `fleet.${eventName}`, payload: { chainFleetId } };
      }

      return null;
    }

    default:
      return null;
  }
}

function parseId(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  try {
    return BigInt(value).toString();
  } catch {
    return null;
  }
}

/** `dispute_resolution_contract`'s tuple-wrapped `DeliveryId` arrives as the
 * JSON string `'["1"]'` in a topic segment — see `disputes`' own
 * `sync-dispute-from-event.ts` header comment for the full explanation. */
function parseTupleWrappedId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 1) return null;
  return parseId(parsed[0]);
}

function parseAddress(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
