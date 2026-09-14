import { McpServer } from "@modelcontextprotocol/server";
import crypto from "node:crypto";

import {
  REGISTRY_VERSION,
  describeCapabilities,
  isToolEnabled,
  toolRegistry,
} from "./toolRegistry.js";

export const createShopSphereMcpServer = ({
  flags = {},
  maxRequestBytes,
  maxResponseBytes,
  backendClient,
  audit = () => {},
}) => {
  const server = new McpServer({
    name: "shopsphere-mcp",
    version: "1.0.0",
  });

  // Per-tool handlers keyed by registry name. Other issue agents add their own
  // entry here; unknown registry names are skipped so tools register idempotently.
  const handlers = {
    get_capabilities: () =>
      describeCapabilities({ flags, maxRequestBytes, maxResponseBytes }),
    get_store_policy: (args, requestId) => backendClient.call("get_store_policy", args, requestId),
    search_products: (args, requestId) => backendClient.call("search_products", args, requestId),
    compare_products: (args, requestId) => backendClient.call("compare_products", args, requestId),
    get_product: (args, requestId) => backendClient.call("get_product", args, requestId),
    get_product_reviews: (args, requestId) => backendClient.call("get_product_reviews", args, requestId),
    get_recommendations: (args, requestId) => backendClient.call("get_recommendations", args, requestId),
  };

  for (const tool of toolRegistry.filter((definition) => isToolEnabled(definition, flags))) {
    const handle = handlers[tool.name];
    if (!handle) continue;

    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        annotations: { readOnlyHint: true },
      },
      async (args, extra) => {
        const startedAt = Date.now();
        const requestId = extra?.requestInfo?.headers?.get("x-request-id");
        try {
          const output = await handle(args, requestId);
          const serialized = JSON.stringify(output);
          audit({
            requestId,
            tool: tool.name,
            registryVersion: REGISTRY_VERSION,
            operation: tool.backendOperation.operationId,
            outcome: "success",
            durationMs: Date.now() - startedAt,
            responseBytes: Buffer.byteLength(serialized),
            responseDigest: crypto.createHash("sha256").update(serialized).digest("base64url"),
            fields: Object.keys(output),
          });
          return {
            content: [{ type: "text", text: serialized }],
            structuredContent: output,
          };
        } catch (error) {
          audit({
            requestId,
            tool: tool.name,
            registryVersion: REGISTRY_VERSION,
            operation: tool.backendOperation.operationId,
            outcome: "error",
            durationMs: Date.now() - startedAt,
          });
          throw error;
        }
      },
    );
  }

  return server;
};
