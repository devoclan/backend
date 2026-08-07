import { NotFoundError } from '../../../shared/errors/app-error.js';

export class AdminUserNotFoundError extends NotFoundError {
  constructor() {
    super('User not found');
  }
}
