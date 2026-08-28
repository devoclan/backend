import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { PrismaClient } from '@prisma/client';
import { getConfig } from '../../shared/config/index.js';
import { getSorobanClient } from '../../blockchain/index.js';
import { BlockchainError } from '../../shared/errors/index.js';
import {
  createBuildDisputeTransactionsUseCases,
  createDownloadEvidenceUseCase,
  createGetDisputeUseCase,
  createSyncDisputeFromEventUseCase,
  createUploadEvidenceUseCase,
} from './application/index.js';
import {
  createLocalEvidenceStorage,
  createPrismaDisputeRepository,
  createPrismaEvidenceRepository,
  createPrismaWalletOwnershipRepository,
  createSorobanDisputeContractClient,
  subscribeDisputeEventSync,
} from './infrastructure/index.js';
import { createDisputeRoutes } from './interface/routes.js';
import type { DisputeContractReader, DisputeTransactionBuilder } from './domain/index.js';

/** Same "fail loudly, not at boot" fallback as escrow/fleet/deliveries'
 * createUnconfiguredContractClient — used when DISPUTE_RESOLUTION_CONTRACT_ID
 * is left blank (.env.example default). */
function createUnconfiguredContractClient(): DisputeContractReader & DisputeTransactionBuilder {
  const fail = (): never => {
    throw new BlockchainError(
      'DISPUTE_RESOLUTION_CONTRACT_ID is not configured — this environment has no dispute_resolution_contract deployment to call.',
    );
  };
  return {
    getDispute: fail,
    buildRaiseDispute: fail,
    buildAddEvidenceHash: fail,
    buildResolveDisputeRefundSender: fail,
    buildResolveDisputePayDriver: fail,
    buildResolveDisputeSplitFunds: fail,
  };
}

export function createDisputesModule(prisma: PrismaClient): FastifyPluginAsyncZod {
  const config = getConfig();
  const disputeRepository = createPrismaDisputeRepository(prisma);
  const evidenceRepository = createPrismaEvidenceRepository(prisma);
  const evidenceStorage = createLocalEvidenceStorage(config.EVIDENCE_STORAGE_DIR);
  const walletOwnershipRepository = createPrismaWalletOwnershipRepository(prisma);
  const contractClient = config.DISPUTE_RESOLUTION_CONTRACT_ID
    ? createSorobanDisputeContractClient(getSorobanClient(), config.DISPUTE_RESOLUTION_CONTRACT_ID)
    : createUnconfiguredContractClient();

  const syncDisputeFromEvent = createSyncDisputeFromEventUseCase({ disputeRepository });
  subscribeDisputeEventSync(syncDisputeFromEvent);

  const useCases = {
    getDispute: createGetDisputeUseCase({
      disputeRepository,
      evidenceRepository,
      contractReader: contractClient,
    }),
    uploadEvidence: createUploadEvidenceUseCase({
      disputeRepository,
      evidenceRepository,
      evidenceStorage,
      walletOwnershipRepository,
    }),
    downloadEvidence: createDownloadEvidenceUseCase({
      evidenceRepository,
      evidenceStorage,
      disputeRepository,
      walletOwnershipRepository,
    }),
    buildTransactions: createBuildDisputeTransactionsUseCases({
      transactionBuilder: contractClient,
    }),
  };

  return createDisputeRoutes(useCases, {
    evidenceMaxBytes: config.EVIDENCE_MAX_BYTES,
  });
}
