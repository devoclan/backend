import { describe, expect, it } from 'vitest';
import { createBuildDisputeTransactionsUseCases } from './build-dispute-transactions.js';
import { createFakeDisputeTransactionBuilder } from './__fixtures__/fakes.js';

describe('createBuildDisputeTransactionsUseCases', () => {
  it('delegates every call to the DisputeTransactionBuilder port', async () => {
    const useCases = createBuildDisputeTransactionsUseCases({
      transactionBuilder: createFakeDisputeTransactionBuilder(),
    });

    await expect(
      useCases.buildRaiseDisputeTransaction({ callerAddress: 'GSENDER', chainDeliveryId: 1n }),
    ).resolves.toBe('unsigned-xdr:raise-dispute');

    await expect(
      useCases.buildAddEvidenceHashTransaction({
        callerAddress: 'GSENDER',
        chainDeliveryId: 1n,
        evidenceHash: 'aa'.repeat(32),
      }),
    ).resolves.toBe('unsigned-xdr:add-evidence-hash');

    await expect(
      useCases.buildResolveDisputeRefundSenderTransaction({
        callerAddress: 'GADMIN',
        chainDeliveryId: 1n,
      }),
    ).resolves.toBe('unsigned-xdr:resolve-dispute-refund-sender');

    await expect(
      useCases.buildResolveDisputePayDriverTransaction({
        callerAddress: 'GADMIN',
        chainDeliveryId: 1n,
      }),
    ).resolves.toBe('unsigned-xdr:resolve-dispute-pay-driver');

    await expect(
      useCases.buildResolveDisputeSplitFundsTransaction({
        callerAddress: 'GADMIN',
        chainDeliveryId: 1n,
        senderShareBps: 5000,
      }),
    ).resolves.toBe('unsigned-xdr:resolve-dispute-split-funds');
  });
});
