import { PrismaClient } from '@prisma/client';

/**
 * Seed entrypoint for local development. No fixture data is defined yet —
 * modules add their own seed steps here as they're implemented in Phase 5,
 * rather than this being pre-populated with data no module can act on yet.
 */
async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    console.warn('[seed] No seed data defined yet — add module seed steps as they land.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('[seed] Failed:', error);
  process.exitCode = 1;
});
