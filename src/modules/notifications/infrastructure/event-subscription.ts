import { onBlockchainEvent } from '../../../shared/events/index.js';
import { logger } from '../../../shared/logger/index.js';
import type { createDispatchNotificationsFromEventUseCase } from '../application/index.js';

const log = logger.child({ module: 'notifications-event-subscription' });

/** Wires the module's event handler into the shared in-process bus — mirrors
 * every other module's own infrastructure/event-subscription.ts. */
export function subscribeNotificationsEventDispatch(
  dispatchNotificationsFromEvent: ReturnType<typeof createDispatchNotificationsFromEventUseCase>,
): () => void {
  return onBlockchainEvent((event) => {
    dispatchNotificationsFromEvent(event).catch((error: unknown) => {
      log.error({ err: error, event }, 'Failed to dispatch notifications from blockchain event');
    });
  });
}
