import { readConfig } from "./config.js";
import { createMcpHttpServer } from "./httpServer.js";
import { createBackendClient } from "./backendClient.js";
import { createKeycloakMcpAuth } from "./keycloakAuth.js";

const config = readConfig();
if (config.enabled && (!config.backendToken || config.backendToken.length < 32)) {
  throw new Error("ASSISTANT_API_TOKEN must contain at least 32 characters when MCP is enabled");
}
const backendClient = createBackendClient({
  origin: config.backendOrigin,
  token: config.backendToken || "disabled",
  timeoutMs: config.backendTimeoutMs,
});
const oauth = config.enabled
  ? createKeycloakMcpAuth({
      issuer: config.oauthIssuer,
      jwksUri: config.oauthJwksUri,
      tokenEndpoint: config.oauthTokenEndpoint,
      introspectionEndpoint: config.oauthIntrospectionEndpoint,
      audience: config.oauthAudience,
      clientId: config.oauthClientId,
      clientSecret: config.oauthClientSecret,
      assistantAudience: config.assistantAudience,
      trustedClients: config.trustedClients,
    })
  : null;
const server = createMcpHttpServer({
  ...config,
  backendClient,
  tokenVerifier: oauth?.verify,
  protectedResourceMetadata: oauth?.protectedResourceMetadata,
});

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
