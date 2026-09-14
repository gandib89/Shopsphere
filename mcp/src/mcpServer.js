import { McpServer } from "@modelcontextprotocol/server";

import {
  describeCapabilities,
  isToolEnabled,
  toolRegistry,
} from "./toolRegistry.js";

const byteLength = (value) => Buffer.byteLength(JSON.stringify(value), "utf8");

const responseLimitError = (maxResponseBytes) => {
  const result = {
    content: [{ type: "text", text: "Response limit exceeded" }],
    isError: true,
  };

  if (byteLength(result) > maxResponseBytes) {
    return { content: [], isError: true };
  }
  return result;
};

const boundedResult = (result, maxResponseBytes) =>
  byteLength(result) <= maxResponseBytes ? result : responseLimitError(maxResponseBytes);

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
        return boundedResult(
          {
            content: [{ type: "text", text: JSON.stringify(output) }],
            structuredContent: output,
          },
          maxResponseBytes,
        );
      },
    );
  }

  return server;
};
