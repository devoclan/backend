import { logger } from '../../../shared/logger/index.js';
import { NotificationNotFoundError } from '../domain/index.js';
import type {
  NotificationRepository,
  NotificationSender,
  UserContactLookup,
} from '../domain/index.js';

const log = logger.child({ module: 'send-notification' });

export interface SendNotificationDeps {
  notificationRepository: NotificationRepository;
  userContactLookup: UserContactLookup;
  sender: NotificationSender;
}

export interface SendNotificationInput {
  notificationId: string;
}

/**
 * Run by the `notifications` BullMQ worker (`infrastructure/queue.ts`) for
 * every job `dispatchNotificationsFromEvent` enqueues. Re-resolves the
 * recipient's current email (see `UserContactLookup.findByUserId`'s header
 * comment) rather than trusting a value captured at dispatch time, then
 * delegates to whichever channel adapter `notifications/index.ts` wired up
 * (a real SMTP sender, or the unconfigured fallback that always throws —
 * see that file). A send failure marks the row `FAILED` and rethrows, so
 * BullMQ's own retry/backoff (`shared/queue/queues.ts` — 5 attempts,
 * exponential) still gets a chance to succeed on a later attempt; only the
 * last, permanently-failed attempt leaves the row `FAILED`.
 */
export function createSendNotificationUseCase(deps: SendNotificationDeps) {
  return async function sendNotification(input: SendNotificationInput): Promise<void> {
    const notification = await deps.notificationRepository.findById(input.notificationId);
    if (!notification) throw new NotificationNotFoundError();

    if (notification.status === 'SENT') return;

    const contact = await deps.userContactLookup.findByUserId(notification.userId);
    if (!contact) {
      await deps.notificationRepository.markFailed(notification.id);
      log.error(
        { notificationId: notification.id, userId: notification.userId },
        'No contact email found for notification recipient',
      );
      return;
    }

    try {
      await deps.sender.send({
        to: contact.email,
        type: notification.type,
        payload: notification.payload,
      });
    } catch (error: unknown) {
      await deps.notificationRepository.markFailed(notification.id);
      throw error;
    }

    await deps.notificationRepository.markSent(notification.id, new Date());
  };
}
