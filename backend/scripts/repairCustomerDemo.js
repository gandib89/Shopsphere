import { prisma } from '../database/prismaClient.js';
import { repairRemainingDemoAccounts } from '../utils/repairRemainingDemoAccounts.js';

try {
  if (!process.argv.includes('--apply')) {
    throw new Error('Run with --apply to repair only the local seeded seller2/customer1/customer2 demo logins');
  }
  const result = await repairRemainingDemoAccounts(prisma, process.env);
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
