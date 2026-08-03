import { describe, expect, it } from 'vitest';
import { createDownloadEvidenceUseCase } from './download-evidence.js';
import {
  buildEvidence,
  createFakeEvidenceStorage,
  createInMemoryEvidenceRepository,
} from './__fixtures__/fakes.js';
import { EvidenceNotFoundError } from '../domain/index.js';

function setup() {
  const evidenceRepository = createInMemoryEvidenceRepository();
  const evidenceStorage = createFakeEvidenceStorage();
  const downloadEvidence = createDownloadEvidenceUseCase({ evidenceRepository, evidenceStorage });
  return { evidenceRepository, evidenceStorage, downloadEvidence };
}

describe('downloadEvidence', () => {
  it('throws EvidenceNotFoundError for an unknown id', async () => {
    const { downloadEvidence } = setup();

    await expect(downloadEvidence({ evidenceId: 'missing' })).rejects.toBeInstanceOf(
      EvidenceNotFoundError,
    );
  });

  it('returns the stored bytes and content type', async () => {
    const { evidenceRepository, evidenceStorage, downloadEvidence } = setup();
    const evidence = buildEvidence({ storageUrl: 'fake://d/1', contentType: 'image/png' });
    evidenceRepository.seed(evidence);
    const bytes = Buffer.from('file-bytes');
    evidenceStorage.seed('fake://d/1', bytes);

    const result = await downloadEvidence({ evidenceId: evidence.id });

    expect(result.bytes).toEqual(bytes);
    expect(result.contentType).toBe('image/png');
  });
});
