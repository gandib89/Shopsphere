import { prisma } from '../database/prismaClient.js';
import { applyDemoOptionPricing } from '../utils/seedDemoData.js';
import { assertLocalDemoEnv } from '../utils/demoEnvGuard.js';

try {
  if (!process.argv.includes('--apply')) {
    throw new Error('Run with --apply to price the seeded demo product options');
  }
  assertLocalDemoEnv(process.env);
  const result = await applyDemoOptionPricing(prisma);
  console.log(`${result.length} option rows priced`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
