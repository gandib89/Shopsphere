import { prisma } from '../database/prismaClient.js';
import { repairSellerDemoAccount } from '../utils/repairSellerDemoAccount.js';

try {
  if (!process.argv.includes('--apply')) {
    throw new Error('Run with --apply to repair only the local seeded seller demo login');
  }
  const result = await repairSellerDemoAccount(prisma, process.env);
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
