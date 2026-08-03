import type { EvidenceRepository, EvidenceStorage } from '../domain/index.js';
import { EvidenceNotFoundError } from '../domain/index.js';

export interface DownloadEvidenceDeps {
  evidenceRepository: EvidenceRepository;
  evidenceStorage: EvidenceStorage;
}

export interface DownloadEvidenceInput {
  evidenceId: string;
}

export interface DownloadEvidenceResult {
  contentType: string;
  bytes: Buffer;
}

export function createDownloadEvidenceUseCase(deps: DownloadEvidenceDeps) {
  return async function downloadEvidence(
    input: DownloadEvidenceInput,
  ): Promise<DownloadEvidenceResult> {
    const evidence = await deps.evidenceRepository.findById(input.evidenceId);
    if (!evidence) {
      throw new EvidenceNotFoundError();
    }
    const bytes = await deps.evidenceStorage.read(evidence.storageUrl);
    return { contentType: evidence.contentType, bytes };
  };
}
