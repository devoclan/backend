import { AppError, ForbiddenError, NotFoundError } from '../../../shared/errors/app-error.js';

export class NotificationNotFoundError extends NotFoundError {
  constructor() {
    super('Notification not found');
  }
}

export class ForbiddenNotificationAccessError extends ForbiddenError {
  constructor() {
    super('This notification does not belong to the current user');
  }
}

/**
 * Available for a future real `NotificationSender` (SES/SendGrid/Postmark/...,
 * see `infrastructure/logger-notification-sender.ts`) to throw when a send
 * genuinely fails. Distinct from `BlockchainError` (that's for Soroban
 * RPC/contract failures specifically) — this is an off-chain delivery-channel
 * failure. `sendNotification` catches whatever a sender throws and marks the
 * row `FAILED` rather than letting it propagate; this type just gives
 * implementations a shared shape to use when they do.
 */
export class NotificationDeliveryError extends AppError {
  readonly statusCode = 502;
  readonly code = 'NOTIFICATION_DELIVERY_ERROR';
}
