import { fileURLToPath } from "url";
import { dirname, join } from "path";
import dotenv from "dotenv";
import { PrismaClient } from "../generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";

// Loaded defensively here (not just in app.js) because this module is
// imported transitively before app.js's own dotenv.config() line runs.
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", "config", "config.env") });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

export const prisma = new PrismaClient({ adapter });
