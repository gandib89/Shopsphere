import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/index.js";

const publicConnectionString = process.env.ASSISTANT_DATABASE_URL || process.env.DATABASE_URL;
const privateConnectionString = process.env.ASSISTANT_PRIVATE_DATABASE_URL || publicConnectionString;
const publicAdapter = new PrismaPg({ connectionString: publicConnectionString });
const privateAdapter = new PrismaPg({ connectionString: privateConnectionString });

// Intentionally separate from prismaClient.js: assistant projections must retain Decimal
// values. Public catalog and authenticated tools use separate restricted roles
// because PostgreSQL row policies cannot hide private columns from a shared role.
export const assistantPublicPrisma = new PrismaClient({ adapter: publicAdapter });
export const assistantPrisma = new PrismaClient({ adapter: privateAdapter });
