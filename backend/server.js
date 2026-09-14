// dotenv is loaded by app.js with the correct absolute path

import app from "./app.js";
import { prisma } from "./database/prismaClient.js";
import { dbConnection } from "./database/dbConnection.js";

const PORT = process.env.PORT || 4000;

const validateProductionConfig = () => {
    if (process.env.NODE_ENV !== "production") return;
    const failures = [];
    if (!process.env.DATABASE_URL) failures.push("DATABASE_URL is required");
    if (!process.env.ASSISTANT_DATABASE_URL) failures.push("ASSISTANT_DATABASE_URL is required");
    if (!process.env.FRONTEND_URL) failures.push("FRONTEND_URL is required");
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
        failures.push("JWT_SECRET must contain at least 32 characters");
    }
    if (!process.env.ESEWA_SECRET_KEY) failures.push("ESEWA_SECRET_KEY is required");
    if (!process.env.ASSISTANT_API_TOKEN || process.env.ASSISTANT_API_TOKEN.length < 32) {
        failures.push("ASSISTANT_API_TOKEN must contain at least 32 characters");
    }
    if (!process.env.ASSISTANT_CURSOR_SECRET || process.env.ASSISTANT_CURSOR_SECRET.length < 32) {
        failures.push("ASSISTANT_CURSOR_SECRET must contain at least 32 characters");
    }
    if (process.env.SEED_DEMO_DATA === "true" && (!process.env.DEMO_PASSWORD || process.env.DEMO_PASSWORD.length < 12)) {
        failures.push("DEMO_PASSWORD must contain at least 12 characters when SEED_DEMO_DATA=true");
    }
    if (failures.length) throw new Error(`Invalid production configuration: ${failures.join("; ")}`);
};

try {
    validateProductionConfig();
} catch (error) {
    console.error(error.message);
    process.exit(1);
}

try {
    await dbConnection();
} catch (error) {
    console.error(`Database initialization failed: ${error.message}`);
    process.exit(1);
}

const server = app.listen(PORT, () => {
    console.log(`Server Running On Port ${PORT}`);
});

server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
        console.error(`\n❌ Port ${PORT} is already in use.`);
        console.error(`   Run this to fix it: lsof -ti:${PORT} | xargs kill -9`);
        process.exit(1);
    } else {
        throw err;
    }
});

// Graceful shutdown — releases port automatically on Ctrl+C or kill
const shutdown = (signal) => {
    console.log(`\n${signal} received. Shutting down gracefully...`);
    server.close(async () => {
        await prisma.$disconnect();
        console.log(`✅ Port ${PORT} released. Server stopped.`);
        process.exit(0);
    });
};

process.on("SIGINT", () => shutdown("SIGINT"));   // Ctrl+C
process.on("SIGTERM", () => shutdown("SIGTERM"));  // kill <pid>
