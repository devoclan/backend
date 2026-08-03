import { z } from 'zod';

/** Stellar (Soroban) public key: 'G' + 55 base32 characters. */
const stellarAddress = z.string().regex(/^G[A-Z2-7]{55}$/, 'Not a valid Stellar public key');
const driverTier = z.enum(['BRONZE', 'SILVER', 'GOLD']);

const driverProfileDto = z.object({
  id: z.string().uuid(),
  address: z.string(),
  reputationScore: z.number().int(),
  tier: driverTier,
  kycVerified: z.boolean(),
  deliveriesCompleted: z.number().int(),
  legacyDeliveriesCompleted: z.number().int(),
  registeredAt: z.string().datetime(),
});

export const driverAddressParamsSchema = z.object({ address: stellarAddress });
export const getDriverProfileResponseSchema = z.object({ data: driverProfileDto });

export const transactionResponseSchema = z.object({ data: z.object({ xdr: z.string() }) });

export const registerDriverBodySchema = z.object({
  driverAddress: stellarAddress,
});

export const updateDriverKycStatusBodySchema = z.object({
  adminAddress: stellarAddress,
  driverAddress: stellarAddress,
  kycVerified: z.boolean(),
});
