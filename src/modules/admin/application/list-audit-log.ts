import type { AuditLogEntry, AuditLogRepository } from '../domain/index.js';

export interface ListAuditLogDeps {
  auditLogRepository: AuditLogRepository;
}

export interface ListAuditLogInput {
  limit?: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export function createListAuditLogUseCase(deps: ListAuditLogDeps) {
  return async function listAuditLog(input: ListAuditLogInput = {}): Promise<AuditLogEntry[]> {
    const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    return deps.auditLogRepository.list(limit);
  };
}
