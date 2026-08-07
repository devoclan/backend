import { onBlockchainEvent } from '../../../shared/events/index.js';
import { logger } from '../../../shared/logger/index.js';
import type { createRecordActorActivityFromEventUseCase } from '../application/index.js';

const log = logger.child({ module: 'fraud-detection-event-subscription' });

/** Wires the module's event handler into the shared in-process bus — mirrors
 * every other module's own infrastructure/event-subscription.ts. */
export function subscribeFraudDetectionEventDispatch(
  recordActorActivityFromEvent: ReturnType<typeof createRecordActorActivityFromEventUseCase>,
): () => void {
  return onBlockchainEvent((event) => {
    recordActorActivityFromEvent(event).catch((error: unknown) => {
      log.error({ err: error, event }, 'Failed to record actor activity from blockchain event');
    });
  });
}
