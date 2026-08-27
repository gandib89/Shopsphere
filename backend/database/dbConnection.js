import { prisma } from "./prismaClient.js";
import { ensureDefaultAdmin } from "../utils/seedAdmin.js";
import { ensureDemoData } from "../utils/seedDemoData.js";

export const initializeDatabase = async ({
  client = prisma,
  demoEnabled = process.env.SEED_DEMO_DATA === "true",
  seedDefaultAdmin = ensureDefaultAdmin,
  seedDemo = ensureDemoData,
} = {}) => {
  await client.$connect();
  console.log("Connected to database successfully!");
  await seedDefaultAdmin();

  if (demoEnabled) {
    const seeded = await seedDemo(client);
    console.log(
      `✅ Demo data ensured: ${seeded.usersCreated} users and ${seeded.productsCreated} products created; ` +
      `${seeded.usersExisting} users and ${seeded.productsExisting} products already existed`,
    );
  }
};

export const dbConnection = () => initializeDatabase();
