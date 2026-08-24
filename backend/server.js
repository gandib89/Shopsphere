// dotenv is loaded by app.js with the correct absolute path

import app from "./app.js";
import { prisma } from "./database/prismaClient.js";

const PORT = process.env.PORT || 4000;

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
