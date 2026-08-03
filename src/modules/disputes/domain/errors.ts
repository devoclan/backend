import { ConflictError, NotFoundError } from '../../../shared/errors/app-error.js';

export class DisputeNotFoundError extends NotFoundError {
  constructor() {
    super('Dispute not found');
  }
}

export class EvidenceNotFoundError extends NotFoundError {
  constructor() {
    super('Evidence not found');
  }
}

/** Mirrors `add_evidence_hash`'s on-chain guard (`dispute.status != Open` ->
 * `InvalidState`, PHASE_1_DOMAIN_ANALYSIS.md §5) — evidence can only be
 * attached while a dispute is still open, on-chain and here alike. */
export class DisputeNotOpenError extends ConflictError {
  constructor() {
    super('Evidence can only be added to an open dispute');
  }
}
