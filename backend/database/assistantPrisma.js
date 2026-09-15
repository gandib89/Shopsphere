import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/index.js";

const connectionString = process.env.ASSISTANT_DATABASE_URL || process.env.DATABASE_URL;
const adapter = new PrismaPg({ connectionString });

// Intentionally separate from prismaClient.js: assistant projections must retain Decimal
// values and production supplies a restricted database role through ASSISTANT_DATABASE_URL.
export const assistantPrisma = new PrismaClient({ adapter });
