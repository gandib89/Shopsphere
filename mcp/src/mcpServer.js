import { McpServer } from "@modelcontextprotocol/server";

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

  for (const tool of toolRegistry.filter((definition) => isToolEnabled(definition, flags))) {
    if (tool.name !== "get_capabilities") continue;

    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        annotations: { readOnlyHint: true },
      },
      async () => {
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
    );
  }

  return server;
};
