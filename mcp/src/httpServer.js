import http from "node:http";

import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";

import { createShopSphereMcpServer } from "./mcpServer.js";
import {
  DEFAULT_MAX_REQUEST_BYTES,
  DEFAULT_MAX_RESPONSE_BYTES,
  PROTOCOL_VERSION,
} from "./toolRegistry.js";

const jsonResponse = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const protocolError = (status, id, message) =>
  jsonResponse(status, {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code: -32600, message },
  });

const corsHeaders = (origin) => ({
  "access-control-allow-origin": origin,
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers":
    "Authorization, Content-Type, Last-Event-ID, Mcp-Protocol-Version, Mcp-Session-Id",
  "access-control-expose-headers": "Mcp-Session-Id",
  vary: "Origin",
});

const withCors = (response, origin) => {
  if (!origin) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(corsHeaders(origin))) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

const responseLimitFallback = (requestBody) => {
  const messages = Array.isArray(requestBody) ? requestBody : [requestBody];
  const request = messages.find((message) => message?.id !== undefined);
  const isToolCall = request?.method === "tools/call";
  const body = isToolCall
    ? {
        jsonrpc: "2.0",
        id: request.id,
        result: {
          content: [{ type: "text", text: "Response limit exceeded" }],
          isError: true,
        },
      }
    : {
        jsonrpc: "2.0",
        id: request?.id ?? null,
        error: { code: -32603, message: "Response limit exceeded" },
      };
  return { body: JSON.stringify(body), status: isToolCall ? 200 : 500 };
};

const enforceResponseLimit = async (response, maxResponseBytes, requestBody) => {
  const body = Buffer.from(await response.arrayBuffer());
  if (body.byteLength <= maxResponseBytes) {
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  const fallback = responseLimitFallback(requestBody);
  if (Buffer.byteLength(fallback.body, "utf8") > maxResponseBytes) {
    return new Response(null, { status: 507 });
  }
  return new Response(fallback.body, {
    status: fallback.status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json",
    },
  });
};

const parseBody = async (request, maxRequestBytes) => {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxRequestBytes) {
    return { error: jsonResponse(413, { error: "MCP request exceeds the request limit" }) };
  }

  const text = await request.clone().text();
  if (Buffer.byteLength(text, "utf8") > maxRequestBytes) {
    return { error: jsonResponse(413, { error: "MCP request exceeds the request limit" }) };
  }

  try {
    return { body: JSON.parse(text) };
  } catch {
    return { error: protocolError(400, null, "Invalid JSON") };
  }
};

const validatePinnedProtocol = (request, body) => {
  if (request.method !== "POST") {
    const version = request.headers.get("mcp-protocol-version");
    return version === PROTOCOL_VERSION
      ? null
      : protocolError(400, null, `Only MCP protocol ${PROTOCOL_VERSION} is supported`);
  }

  const messages = Array.isArray(body) ? body : [body];
  const initialize = messages.find((message) => message?.method === "initialize");
  if (initialize) {
    return initialize.params?.protocolVersion === PROTOCOL_VERSION
      ? null
      : protocolError(
          400,
          initialize.id,
          `Only MCP protocol ${PROTOCOL_VERSION} is supported`,
        );
  }

  const version = request.headers.get("mcp-protocol-version");
  return version === PROTOCOL_VERSION
    ? null
    : protocolError(400, messages[0]?.id, `Only MCP protocol ${PROTOCOL_VERSION} is supported`);
};

export const createMcpHttpServer = ({
  enabled = true,
  flags = {},
  allowedOrigins = [],
  maxRequestBytes = DEFAULT_MAX_REQUEST_BYTES,
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
} = {}) => {
  const handler = createMcpHandler(
    () => createShopSphereMcpServer({ flags, maxRequestBytes, maxResponseBytes }),
    { legacy: "stateless" },
  );

  const guardedHandler = {
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/health" && request.method === "GET") {
        return jsonResponse(200, { status: "ok", mcpEnabled: enabled });
      }
      if (url.pathname !== "/mcp") {
        return jsonResponse(404, { error: "Not found" });
      }
      if (!enabled) {
        return jsonResponse(503, { error: "MCP is disabled" });
      }

      const origin = request.headers.get("origin");
      if (origin && !allowedOrigins.includes(origin)) {
        return jsonResponse(403, { error: "Origin is not allowed" });
      }
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(origin) });
      }

      let body;
      if (request.method === "POST") {
        const parsed = await parseBody(request, maxRequestBytes);
        if (parsed.error) return parsed.error;
        body = parsed.body;
      }

      const versionError = validatePinnedProtocol(request, body);
      const mcpResponse = versionError ?? (await handler.fetch(request, { parsedBody: body }));
      return withCors(
        await enforceResponseLimit(mcpResponse, maxResponseBytes, body),
        origin,
      );
    },
  };

  const nodeHandler = toNodeHandler(guardedHandler);
  const server = http.createServer((request, response) => {
    void nodeHandler(request, response);
  });
  server.on("close", () => {
    void handler.close();
  });
  return server;
};
