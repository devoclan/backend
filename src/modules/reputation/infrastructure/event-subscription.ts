import { onBlockchainEvent } from '../../../shared/events/index.js';
import { logger } from '../../../shared/logger/index.js';
import type { createSyncReputationFromEventUseCase } from '../application/index.js';

const log = logger.child({ module: 'reputation-event-subscription' });

/** Wires the module's event handler into the shared in-process bus — mirrors
 * every other module's own infrastructure/event-subscription.ts. */
export function subscribeReputationEventSync(
  syncReputationFromEvent: ReturnType<typeof createSyncReputationFromEventUseCase>,
): () => void {
  return onBlockchainEvent((event) => {
    syncReputationFromEvent(event).catch((error: unknown) => {
      log.error({ err: error, event }, 'Failed to sync reputation from blockchain event');
    });
  });
}
