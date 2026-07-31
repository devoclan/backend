import { onBlockchainEvent } from '../../../shared/events/index.js';
import { logger } from '../../../shared/logger/index.js';
import type { createSyncEscrowFromEventUseCase } from '../application/index.js';

const log = logger.child({ module: 'escrow-event-subscription' });

/**
 * Wires the module's event handler into the shared in-process bus — mirrors
 * deliveries/infrastructure/event-subscription.ts, same rationale for
 * catching/logging rejections here instead of letting them become unhandled
 * promise rejections.
 */
export function subscribeEscrowEventSync(
  syncEscrowFromEvent: ReturnType<typeof createSyncEscrowFromEventUseCase>,
): () => void {
  return onBlockchainEvent((event) => {
    syncEscrowFromEvent(event).catch((error: unknown) => {
      log.error({ err: error, event }, 'Failed to sync escrow from blockchain event');
    });
  });
}
