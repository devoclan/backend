import { onBlockchainEvent } from '../../../shared/events/index.js';
import { logger } from '../../../shared/logger/index.js';
import type { createSyncFleetFromEventUseCase } from '../application/index.js';

const log = logger.child({ module: 'fleet-event-subscription' });

/**
 * Wires the module's event handler into the shared in-process bus — mirrors
 * escrow/infrastructure/event-subscription.ts, same rationale for
 * catching/logging rejections here instead of letting them become unhandled
 * promise rejections.
 */
export function subscribeFleetEventSync(
  syncFleetFromEvent: ReturnType<typeof createSyncFleetFromEventUseCase>,
): () => void {
  return onBlockchainEvent((event) => {
    syncFleetFromEvent(event).catch((error: unknown) => {
      log.error({ err: error, event }, 'Failed to sync fleet from blockchain event');
    });
  });
}
