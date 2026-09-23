import { readConfig } from "./config.js";
import { createMcpHttpServer } from "./httpServer.js";
import { createBackendClient } from "./backendClient.js";
import { createCloudRunIdentityTokenProvider } from "./cloudRunIdentity.js";
import { createKeycloakMcpAuth } from "./keycloakAuth.js";
import {
  connectAssistantRedis,
  createDistributedControls,
  createPrincipalSessionStore,
} from "./redisControls.js";

const config = readConfig();
if (config.enabled && (!config.backendToken || config.backendToken.length < 32)) {
  throw new Error("ASSISTANT_API_TOKEN must contain at least 32 characters when MCP is enabled");
}
const oauth = config.enabled
  ? createKeycloakMcpAuth({
      issuer: config.oauthIssuer,
      jwksUri: config.oauthJwksUri,
      tokenEndpoint: config.oauthTokenEndpoint,
      introspectionEndpoint: config.oauthIntrospectionEndpoint,
      audience: config.oauthAudience,
      resourceUrl: config.resourceUrl,
      clientId: config.oauthClientId,
      clientSecret: config.oauthClientSecret,
      assistantAudience: config.assistantAudience,
      trustedClients: config.trustedClients,
    })
  : null;
const backendClient = createBackendClient({
  origin: config.backendOrigin,
  token: config.backendToken || "disabled",
  exchangeToken: oauth?.exchange,
  cloudRunIdToken: config.cloudRunBackendAuth
    ? createCloudRunIdentityTokenProvider(config.backendOrigin)
    : undefined,
  timeoutMs: config.backendTimeoutMs,
});
const redis = config.enabled ? await connectAssistantRedis(config.redisUrl) : null;
const server = createMcpHttpServer({
  ...config,
  backendClient,
  distributedControls: redis ? createDistributedControls({
    redis,
    limit: config.requestsPerMinute,
    concurrency: config.maxConcurrency,
  }) : undefined,
  sessionStore: redis ? createPrincipalSessionStore({ redis }) : undefined,
  tokenVerifier: oauth?.verify,
  authContextResolver: oauth ? (context) => backendClient.resolveAuthorization(context) : undefined,
  protectedResourceMetadata: oauth?.protectedResourceMetadata,
});

server.listen(config.port, config.host, () => {
  console.log(`ShopSphere MCP listening on http://${config.host}:${config.port}/mcp`);
});

const shutdown = (signal) => {
  console.log(`${signal} received. Shutting down ShopSphere MCP.`);
  server.close(async (error) => {
    if (redis?.isOpen) await redis.close();
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
