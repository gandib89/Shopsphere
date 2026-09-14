import { McpServer } from "@modelcontextprotocol/server";

import { compareCatalog, searchCatalog } from "./catalogData.js";
import {
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

  // Per-tool handlers keyed by registry name. Other issue agents add their own
  // entry here; unknown registry names are skipped so tools register idempotently.
  const handlers = {
    get_capabilities: async () => {
      const output = describeCapabilities({
        flags,
        maxRequestBytes,
        maxResponseBytes,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
    search_products: async (args) => {
      const output = searchCatalog(args);
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
    compare_products: async (args) => {
      const output = { products: compareCatalog(args.productIds) };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
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
      async (args) => handle(args),
    );
  }

  return server;
};
