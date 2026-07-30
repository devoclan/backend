/**
 * Consistent success envelope used across every module's routes
 * (ARCHITECTURE.md §9). Errors are handled separately by
 * src/shared/errors/error-handler.ts and never go through this helper.
 */
export interface SuccessResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export function ok<T>(data: T, meta?: Record<string, unknown>): SuccessResponse<T> {
  return meta ? { data, meta } : { data };
}
