import { readConfig } from "./config.js";
import { createMcpHttpServer } from "./httpServer.js";

const config = readConfig();
const server = createMcpHttpServer(config);

server.listen(config.port, config.host, () => {
  console.log(`ShopSphere MCP listening on http://${config.host}:${config.port}/mcp`);
});

const shutdown = (signal) => {
  console.log(`${signal} received. Shutting down ShopSphere MCP.`);
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
