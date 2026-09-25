import http from "node:http";
import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";

import { createShopSphereMcpServer } from "./mcpServer.js";
import {
  DEFAULT_MAX_REQUEST_BYTES,
  DEFAULT_MAX_RESPONSE_BYTES,
  POLICY_VERSION,
  PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
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
  "access-control-expose-headers": "Mcp-Session-Id, X-Request-Id",
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

const withRequestId = (response, requestId) => {
  const headers = new Headers(response.headers);
  headers.set("x-request-id", requestId);
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
  const chunks = [];
  let size = 0;
  const reader = request.body?.getReader();
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxRequestBytes) {
      await reader.cancel();
      return { error: jsonResponse(413, { error: "MCP request exceeds the request limit" }) };
    }
    chunks.push(Buffer.from(value));
  }
  try {
    return { body: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { error: protocolError(400, null, "Invalid JSON") };
  }
};

const safeEqual = (left, right) => {
  const a = Buffer.from(left || "");
  const b = Buffer.from(right || "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const requestIdFor = (request) => {
  const supplied = request.headers.get("x-request-id");
  return supplied && /^[A-Za-z0-9_-]{1,100}$/.test(supplied) ? supplied : crypto.randomUUID();
};

const validateSupportedProtocol = (request, body) => {
  const isSupported = (version) => SUPPORTED_PROTOCOL_VERSIONS.includes(version);
  const unsupported = (id) =>
    protocolError(
      400,
      id,
      `Supported MCP protocols: ${SUPPORTED_PROTOCOL_VERSIONS.join(", ")}`,
    );
  if (request.method !== "POST") {
    const version = request.headers.get("mcp-protocol-version");
    return isSupported(version) ? null : unsupported(null);
  }

  const messages = Array.isArray(body) ? body : [body];
  const initialize = messages.find((message) => message?.method === "initialize");
  if (initialize) {
    return isSupported(initialize.params?.protocolVersion)
      ? null
      : unsupported(initialize.id);
  }

  const version = request.headers.get("mcp-protocol-version");
  return isSupported(version) ? null : unsupported(messages[0]?.id);
};

export const createMcpHttpServer = ({
  enabled = true,
  flags = {},
  allowedOrigins = [],
  maxRequestBytes = DEFAULT_MAX_REQUEST_BYTES,
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
  accessToken,
  tokenVerifier,
  authContextResolver,
  protectedResourceMetadata,
  backendClient,
  requestsPerMinute = 60,
  maxConcurrency = 4,
  distributedControls,
  sessionStore,
  audit,
} = {}) => {
  if (enabled && !tokenVerifier && (!accessToken || accessToken.length < 32)) {
    throw new Error("OAuth verification or a 32-character test access token is required when MCP is enabled");
  }
  const requestScope = new AsyncLocalStorage();
  const scopedBackendClient = {
    call: (name, input) => backendClient.call(name, input, requestScope.getStore()),
  };
  const recordObserverAudit = async (event) => {
    if (typeof audit !== "function") return;
    await audit({
      type: "mcp_audit",
      time: new Date().toISOString(),
      ...event,
    });
  };
  const persistAudit = async (event, explicitContext) => {
    const context = explicitContext || requestScope.getStore() || {};
    const auth = context.auth || {};
    await recordObserverAudit({
      ...event,
      requestId: event.requestId ?? context.requestId,
    });
    const { requestId, durationMs, fields, registryVersion, ...safeEvent } = event;
    const enriched = {
      ...safeEvent,
      traceId: event.traceId || requestId || context.requestId,
      subjectId: auth.sub || null,
      role: auth.role || null,
      clientId: auth.clientId || null,
      workloadId: auth.workload || "shopsphere-mcp",
      grantId: auth.grantId || null,
      authorizationOutcome: event.authorizationOutcome || "allowed",
      policyVersion: event.policyVersion || registryVersion || "1.0.0",
      returnedFields: event.returnedFields || fields || [],
      latencyMs: durationMs ?? event.latencyMs ?? 0,
    };
    if (typeof backendClient?.recordAudit === "function") {
      return backendClient.recordAudit(enriched, context);
    }
    if (typeof audit !== "function") {
      console.log(JSON.stringify({ type: "mcp_audit", time: new Date().toISOString(), ...enriched }));
    }
  };
  const handler = createMcpHandler(
    () =>
      createShopSphereMcpServer({
        flags,
        maxRequestBytes,
        maxResponseBytes,
        backendClient: scopedBackendClient,
        authContext: requestScope.getStore()?.auth,
        audit: persistAudit,
      }),
    { legacy: "stateless" },
  );
  const rateBuckets = new Map();
  let activeRequests = 0;

  const guardedHandler = {
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/health" && request.method === "GET") {
        return jsonResponse(200, { status: "ok", mcpEnabled: enabled });
      }
      if (url.pathname === "/.well-known/oauth-protected-resource" && request.method === "GET") {
        return protectedResourceMetadata
          ? jsonResponse(200, protectedResourceMetadata)
          : jsonResponse(503, { error: "OAuth is not configured" });
      }
      if (url.pathname !== "/mcp") {
        return jsonResponse(404, { error: "Not found" });
      }
      const requestId = requestIdFor(request);
      let authContext;
      const auditIngress = async ({
        operation,
        outcome,
        authorizationOutcome = "denied",
        failureReason,
        observerOutcome = outcome,
        observerReason = failureReason,
      }) => {
        await recordObserverAudit({
          requestId,
          operation,
          outcome: observerOutcome,
          reason: observerReason,
        });
        if (typeof backendClient?.recordAudit !== "function") return;
        await backendClient.recordAudit({
          traceId: requestId,
          subjectId: authContext?.sub || null,
          role: authContext?.role || null,
          clientId: authContext?.clientId || null,
          workloadId: "shopsphere-mcp",
          grantId: authContext?.grantId || null,
          policyVersion: POLICY_VERSION,
          tool: null,
          operation,
          authorizationOutcome,
          outcome,
          returnedFields: [],
          resourceIds: [],
          responseDigest: null,
          responseBytes: null,
          rowCount: null,
          latencyMs: 0,
          failureReason,
        }, { requestId });
      };
      if (!enabled) {
        try {
          await auditIngress({
            operation: "transport.request",
            outcome: "denied",
            failureReason: "kill_switch",
          });
        } catch {
          console.warn("Durable audit unavailable during kill-switch denial");
          return withRequestId(jsonResponse(503, { error: "Audit service unavailable" }), requestId);
        }
        return withRequestId(jsonResponse(503, { error: "MCP is disabled" }), requestId);
      }

      const origin = request.headers.get("origin");
      if (origin && !allowedOrigins.includes(origin)) {
        try { await auditIngress({ operation: "transport.request", outcome: "origin_denied", failureReason: "origin_not_allowed", observerOutcome: "denied" }); } catch { return withRequestId(jsonResponse(503, { error: "Audit service unavailable" }), requestId); }
        return withRequestId(jsonResponse(403, { error: "Origin is not allowed" }), requestId);
      }
      if (request.method === "OPTIONS") {
        return origin
          ? new Response(null, { status: 204, headers: corsHeaders(origin) })
          : new Response(null, { status: 204 });
      }

      const authorization = request.headers.get("authorization") || "";
      const suppliedToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
      let authPhase = "token verification";
      try {
        if (tokenVerifier) authContext = await tokenVerifier(suppliedToken);
        else if (!safeEqual(suppliedToken, accessToken)) throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
        if (authContextResolver) {
          authPhase = "authorization context";
          const resolved = await authContextResolver({ auth: authContext, subjectToken: suppliedToken });
          authContext = resolved.auth;
        }
      } catch (error) {
        console.warn("Local OAuth diagnosis", { phase: authPhase, hasToken: Boolean(suppliedToken), reason: error?.message });
        const status = error?.statusCode === 503 ? 503 : error?.statusCode === 403 ? 403 : 401;
        try { await auditIngress({ operation: "authorization.resolve", outcome: status === 503 ? "dependency_unavailable" : "denied", failureReason: status === 503 ? "issuer_or_grant_unavailable" : "invalid_credential" }); } catch { return withCors(withRequestId(jsonResponse(503, { error: "Audit service unavailable" }), requestId), origin); }
        return withCors(withRequestId(jsonResponse(status, { error: status === 503 ? "OAuth issuer unavailable" : "Unauthorized" }), requestId), origin);
      }

      const now = Date.now();
      const rateIdentity = authContext
        ? `${authContext.sub}:${authContext.clientId}:${authContext.grantId}`
        : suppliedToken;
      const rateKey = crypto.createHash("sha256").update(rateIdentity).digest("base64url");
      const bucket = rateBuckets.get(rateKey);
      const current = !bucket || now - bucket.startedAt >= 60_000
        ? { startedAt: now, count: 0 }
        : bucket;
      current.count += 1;
      rateBuckets.set(rateKey, current);
      if (current.count > requestsPerMinute) {
        try { await auditIngress({ operation: "transport.request", outcome: "rate_limited", failureReason: "rate_limited", observerOutcome: "denied", observerReason: "rate_limit" }); } catch { return withCors(withRequestId(jsonResponse(503, { error: "Audit service unavailable" }), requestId), origin); }
        return withCors(withRequestId(new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": "60" },
        }), requestId), origin);
      }
      let distributedLease;
      if (distributedControls) {
        try {
          distributedLease = await distributedControls.enter({
            auth: authContext,
            ip: request.headers.get("x-shopsphere-peer-ip") || "unknown",
          });
        } catch {
          try { await auditIngress({ operation: "transport.request", outcome: "dependency_unavailable", failureReason: "limit_unavailable" }); } catch {}
          return withCors(withRequestId(jsonResponse(503, { error: "Distributed limit state unavailable" }), requestId), origin);
        }
        if (!distributedLease.allowed) {
          try { await auditIngress({ operation: "transport.request", outcome: distributedLease.busy ? "busy" : "rate_limited", failureReason: distributedLease.busy ? "concurrency_limited" : "rate_limited" }); } catch { return jsonResponse(503, { error: "Audit service unavailable" }); }
          return withCors(withRequestId(new Response(JSON.stringify({ error: distributedLease.busy ? "Server is busy" : "Rate limit exceeded" }), {
            status: distributedLease.busy ? 503 : 429,
            headers: { "content-type": "application/json", "retry-after": String(Math.max(1, Math.ceil(distributedLease.retryAfterMs / 1000))) },
          }), requestId), origin);
        }
      } else if (activeRequests >= maxConcurrency) {
        try { await auditIngress({ operation: "transport.request", outcome: "busy", failureReason: "concurrency_limited", observerOutcome: "denied", observerReason: "concurrency_limit" }); } catch { return withCors(withRequestId(jsonResponse(503, { error: "Audit service unavailable" }), requestId), origin); }
        return withCors(withRequestId(new Response(JSON.stringify({ error: "Server is busy" }), {
          status: 503,
          headers: { "content-type": "application/json", "retry-after": "1" },
        }), requestId), origin);
      }
      activeRequests += 1;
      try {

        let body;
        if (request.method === "POST") {
          const parsed = await parseBody(request, maxRequestBytes);
          if (parsed.error) return withCors(withRequestId(parsed.error, requestId), origin);
          body = parsed.body;
        }

        const messages = Array.isArray(body) ? body : [body];
        const isInitialize = messages.some((message) => message?.method === "initialize");
        const suppliedSession = request.headers.get("mcp-session-id");
        if (sessionStore && !isInitialize && !(await sessionStore.validate(suppliedSession, authContext))) {
          try { await auditIngress({ operation: "transport.session", outcome: "not_found", failureReason: "invalid_session" }); } catch { return jsonResponse(503, { error: "Audit service unavailable" }); }
          return withCors(withRequestId(jsonResponse(404, { error: "Session not found" }), requestId), origin);
        }

        const versionError = validateSupportedProtocol(request, body);
        const requestHeaders = new Headers(request.headers);
        requestHeaders.set("x-request-id", requestId);
        const mcpRequest = new Request(request.url, {
          method: request.method,
          headers: requestHeaders,
        });
        const mcpResponse = versionError ?? (await requestScope.run(
          { requestId, auth: authContext, subjectToken: suppliedToken },
          () => handler.fetch(mcpRequest, { parsedBody: body }),
        ));
        const response = await enforceResponseLimit(mcpResponse, maxResponseBytes, body);
        const headers = new Headers(response.headers);
        if (sessionStore && isInitialize && response.status >= 200 && response.status < 300) {
          headers.set("mcp-session-id", await sessionStore.create(authContext));
        }
        if (sessionStore && request.method === "DELETE" && suppliedSession) {
          await sessionStore.destroy(suppliedSession);
        }
        headers.set("x-request-id", requestId);
        return withCors(
          new Response(response.body, { status: response.status, statusText: response.statusText, headers }),
          origin,
        );
      } finally {
        activeRequests -= 1;
        await distributedLease?.release?.().catch(() => {});
      }
    },
  };

  const nodeHandler = toNodeHandler(guardedHandler);
  const server = http.createServer((request, response) => {
    // Never trust a caller-supplied forwarding header for the IP quota. The
    // ingress peer is injected from the socket and overwrites any request value.
    request.headers["x-shopsphere-peer-ip"] = request.socket.remoteAddress || "unknown";
    void nodeHandler(request, response);
  });
  server.on("close", () => {
    void handler.close();
  });
  return server;
};
