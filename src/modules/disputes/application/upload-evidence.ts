import { createHash } from 'node:crypto';
import type {
  DisputeRepository,
  Evidence,
  EvidenceRepository,
  EvidenceStorage,
} from '../domain/index.js';
import { DisputeNotFoundError, DisputeNotOpenError } from '../domain/index.js';

export interface UploadEvidenceDeps {
  disputeRepository: DisputeRepository;
  evidenceRepository: EvidenceRepository;
  evidenceStorage: EvidenceStorage;
}

export interface UploadEvidenceInput {
  chainDeliveryId: bigint;
  contentType: string;
  uploadedBy: string;
  bytes: Buffer;
}

export interface UploadEvidenceResult {
  evidence: Evidence;
}

/**
 * Stores an evidence file and computes its content hash — the hash this
 * returns is exactly what the client must then pass to
 * `buildAddEvidenceHashTransaction` so the on-chain `BytesN<32>` matches
 * what's stored here (PHASE_1_DOMAIN_ANALYSIS.md §5). This backend never
 * calls `add_evidence_hash` itself; only a sender/recipient wallet
 * signature can, per that function's on-chain `require_auth`.
 *
 * Mirrors `add_evidence_hash`'s on-chain guard: evidence can only be added
 * while the dispute is `OPEN`.
 */
export function createUploadEvidenceUseCase(deps: UploadEvidenceDeps) {
  return async function uploadEvidence(input: UploadEvidenceInput): Promise<UploadEvidenceResult> {
    const dispute = await deps.disputeRepository.findByChainDeliveryId(input.chainDeliveryId);
    if (!dispute) {
      throw new DisputeNotFoundError();
    }
    if (dispute.status !== 'OPEN') {
      throw new DisputeNotOpenError();
    }

    const hash = createHash('sha256').update(input.bytes).digest('hex');
    const { storageUrl } = await deps.evidenceStorage.save({
      disputeId: dispute.id,
      contentType: input.contentType,
      bytes: input.bytes,
    });

    const evidence = await deps.evidenceRepository.create({
      disputeId: dispute.id,
      hash,
      storageUrl,
      contentType: input.contentType,
      uploadedBy: input.uploadedBy,
    });

    return { evidence };
  };
}
