import type {
  AssignDriverTxInput,
  CancelDeliveryTxInput,
  ConfirmDeliveryTxInput,
  CreateDeliveryTxInput,
  DeliveryIdTxInput,
  DeliveryTransactionBuilder,
  MarkInTransitTxInput,
} from '../domain/index.js';

export interface BuildDeliveryTransactionsDeps {
  transactionBuilder: DeliveryTransactionBuilder;
}

/**
 * Five thin delegations to the `DeliveryTransactionBuilder` port, one per
 * client-facing `delivery_contract` call reviewed in
 * PHASE_1_DOMAIN_ANALYSIS.md §4 (`raise_dispute` excluded — see that port's
 * header comment).
 * Grouped in one file rather than split like auth's use cases because each
 * is pure delegation with no branching business logic of its own — input
 * validation happens at the interface layer (Zod), and the actual encoding
 * complexity lives in the infrastructure implementation, not here.
 */
export function createBuildDeliveryTransactionsUseCases(deps: BuildDeliveryTransactionsDeps) {
  return {
    buildCreateDeliveryTransaction: (input: CreateDeliveryTxInput): Promise<string> =>
      deps.transactionBuilder.buildCreateDelivery(input),

    buildAssignDriverTransaction: (input: AssignDriverTxInput): Promise<string> =>
      deps.transactionBuilder.buildAssignDriver(input),

    buildMarkInTransitTransaction: (input: MarkInTransitTxInput): Promise<string> =>
      deps.transactionBuilder.buildMarkInTransit(input),

    buildConfirmDeliveryTransaction: (input: ConfirmDeliveryTxInput): Promise<string> =>
      deps.transactionBuilder.buildConfirmDelivery(input),

    buildCancelDeliveryTransaction: (input: CancelDeliveryTxInput): Promise<string> =>
      deps.transactionBuilder.buildCancelDelivery(input),
  };
}

export type { DeliveryIdTxInput };
