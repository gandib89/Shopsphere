import { McpServer } from "@modelcontextprotocol/server";

import { getStorePolicy } from "./policyContent.js";
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
}) => {
  const server = new McpServer({
    name: "shopsphere-mcp",
    version: "1.0.0",
  });

  const handlers = {
    get_capabilities: () =>
      describeCapabilities({ flags, maxRequestBytes, maxResponseBytes }),
    get_store_policy: (args) => ({
      ...getStorePolicy(args.topic),
      registryVersion: REGISTRY_VERSION,
    }),
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
      async (args) => {
        const output = handle(args);
        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
        };
      },
    );
  }

  return server;
};
