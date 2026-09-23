import { createServer } from "node:http";
import { Readable } from "node:stream";

const MAX_REQUEST_BYTES = 1_048_576;
const FORWARDED_REQUEST_HEADERS = [
  "accept", "accept-language", "authorization", "cache-control",
  "content-type", "cookie", "origin", "referer", "user-agent",
];
const EXCLUDED_RESPONSE_HEADERS = new Set([
  "connection", "content-encoding", "content-length", "keep-alive",
  "set-cookie", "transfer-encoding",
]);

export const permittedPath = (rawTarget) => {
  if (!rawTarget?.startsWith("/") || rawTarget.startsWith("//") || rawTarget.includes("\\")) return false;
  const rawPath = rawTarget.split("?", 1)[0];
  if (rawPath.includes("%") || rawPath.split("/").some((part) => part === "." || part === "..")) return false;
  return rawPath === "/realms/shopsphere" || rawPath.startsWith("/realms/shopsphere/")
    || rawPath.startsWith("/resources/")
    || rawPath === "/.well-known/oauth-authorization-server/realms/shopsphere";
};

const requestBody = async (request) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) throw new Error("request too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

export const createGateway = ({ authOrigin, publicOrigin, fetchImpl = fetch, tokenProvider }) => {
  const upstream = new URL(authOrigin);
  const publicUrl = new URL(publicOrigin);
  if (upstream.protocol !== "https:" || !upstream.hostname.endsWith(".run.app") || upstream.pathname !== "/"
    || publicUrl.protocol !== "https:" || !publicUrl.hostname.endsWith(".run.app") || publicUrl.pathname !== "/") {
    throw new Error("Gateway origins must be HTTPS Cloud Run service URLs");
  }
  if (typeof tokenProvider !== "function") throw new Error("Gateway identity provider is required");

  return createServer(async (request, response) => {
    if (request.url === "/health" && request.method === "GET") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("ok");
      return;
    }
    if (!["GET", "HEAD", "POST"].includes(request.method) || !permittedPath(request.url)) {
      response.writeHead(404);
      response.end();
      return;
    }
    if (request.headers.host !== publicUrl.host) {
      response.writeHead(400);
      response.end();
      return;
    }
    if (Number(request.headers["content-length"] ?? 0) > MAX_REQUEST_BYTES) {
      response.writeHead(413);
      response.end();
      return;
    }

    try {
      const headers = new Headers();
      for (const name of FORWARDED_REQUEST_HEADERS) {
        if (request.headers[name]) headers.set(name, request.headers[name]);
      }
      headers.set("x-forwarded-host", publicUrl.host);
      headers.set("x-forwarded-proto", "https");
      headers.set("x-forwarded-port", "443");
      headers.set("x-serverless-authorization", `Bearer ${await tokenProvider()}`);
      const target = new URL(request.url, upstream);
      const body = request.method === "POST" ? await requestBody(request) : undefined;
      const upstreamResponse = await fetchImpl(target, {
        method: request.method,
        headers,
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(60_000),
      });
      const replyHeaders = {};
      for (const [name, value] of upstreamResponse.headers) {
        if (!EXCLUDED_RESPONSE_HEADERS.has(name)) replyHeaders[name] = value;
      }
      const cookies = upstreamResponse.headers.getSetCookie?.() ?? [];
      if (cookies.length) replyHeaders["set-cookie"] = cookies;
      response.writeHead(upstreamResponse.status, replyHeaders);
      if (request.method === "HEAD" || !upstreamResponse.body) response.end();
      else Readable.fromWeb(upstreamResponse.body).pipe(response);
    } catch (error) {
      if (response.headersSent) response.destroy();
      else {
        response.writeHead(error.message === "request too large" ? 413 : 502);
        response.end();
      }
    }
  });
};

export const metadataTokenProvider = (audience, fetchImpl = fetch) => async () => {
  const url = new URL("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity");
  url.searchParams.set("audience", audience);
  const response = await fetchImpl(url, {
    headers: { "Metadata-Flavor": "Google" },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("Gateway identity unavailable");
  const token = (await response.text()).trim();
  if (!token) throw new Error("Gateway identity unavailable");
  return token;
};

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const authOrigin = process.env.AUTH_UPSTREAM_ORIGIN;
  const publicOrigin = process.env.PUBLIC_ORIGIN;
  if (!authOrigin || !publicOrigin) throw new Error("Gateway origins are required");
  const server = createGateway({
    authOrigin,
    publicOrigin,
    tokenProvider: metadataTokenProvider(authOrigin),
  });
  server.listen(Number(process.env.PORT ?? 8080), "0.0.0.0");
}
