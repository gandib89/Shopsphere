import { prisma } from "../database/prismaClient.js";
import { assertLocalDemoEnv } from "../utils/demoEnvGuard.js";
import { replaceCustomerSellerData } from "../utils/seedDemoData.js";

try {
  if (!process.argv.includes("--apply")) {
    throw new Error("Run with --apply to replace all local customer, seller, and commerce demo data");
  }
  assertLocalDemoEnv(process.env);
  const result = await replaceCustomerSellerData(prisma);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
