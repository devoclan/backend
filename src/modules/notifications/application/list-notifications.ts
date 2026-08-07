import type { Notification, NotificationRepository, NotificationStatus } from '../domain/index.js';

export interface ListNotificationsDeps {
  notificationRepository: NotificationRepository;
}

export interface ListNotificationsInput {
  userId: string;
  status?: NotificationStatus;
  limit?: number;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** Always scoped to the requesting user (`interface/routes.ts` passes
 * `request.user.id`, never a caller-supplied id) — there is no notion of
 * an admin reading another user's notifications in this v1 slice. */
export function createListNotificationsUseCase(deps: ListNotificationsDeps) {
  return async function listNotifications(input: ListNotificationsInput): Promise<Notification[]> {
    const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    return deps.notificationRepository.listByUserId(input.userId, {
      limit,
      ...(input.status && { status: input.status }),
    });
  };
}
