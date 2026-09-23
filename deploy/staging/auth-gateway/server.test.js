import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import test from "node:test";

import { createGateway, permittedPath, metadataTokenProvider } from "./server.js";

const AUTH = "https://stage-auth-123.asia-south1.run.app";
const PUBLIC = "https://stage-login-123.asia-south1.run.app";
const requestGateway = (server, path, headers = {}) => new Promise((resolve, reject) => {
  const request = httpRequest({
    host: "127.0.0.1",
    port: server.address().port,
    path,
    headers: { host: new URL(PUBLIC).host, ...headers },
  }, (response) => {
    const chunks = [];
    response.on("data", (chunk) => chunks.push(chunk));
    response.on("end", () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString() }));
  });
  request.on("error", reject);
  request.end();
});

test("gateway only permits staging login and asset paths", () => {
  for (const path of ["/realms/shopsphere", "/realms/shopsphere/protocol/openid-connect/auth", "/resources/a.css"]) {
    assert.equal(permittedPath(path), true);
  }
  for (const path of ["/", "/admin/", "/realms/master/", "/realms/shopsphere-other/", "/realms/shopsphere/%2e%2e/master", "/realms/shopsphere/../../admin/", "//evil.example/"]) {
    assert.equal(permittedPath(path), false);
  }
});

test("gateway authenticates to private Keycloak and preserves its login response", async () => {
  const calls = [];
  const server = createGateway({
    authOrigin: AUTH,
    publicOrigin: PUBLIC,
    tokenProvider: async () => "google-token",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response("login", { status: 200, headers: { "content-type": "text/html" } });
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await requestGateway(server, "/realms/shopsphere/protocol/openid-connect/auth", {
      "x-serverless-authorization": "attacker-token",
    });
    assert.equal(response.status, 200);
    assert.equal(response.body, "login");
    assert.equal(calls[0].url, `${AUTH}/realms/shopsphere/protocol/openid-connect/auth`);
    assert.equal(calls[0].init.headers.get("x-serverless-authorization"), "Bearer google-token");
    assert.equal(calls[0].init.headers.get("x-forwarded-host"), new URL(PUBLIC).host);
  } finally {
    server.close();
  }
});

test("gateway denies admin paths before calling private Keycloak", async () => {
  const server = createGateway({
    authOrigin: AUTH,
    publicOrigin: PUBLIC,
    tokenProvider: async () => { throw new Error("must not run"); },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await requestGateway(server, "/admin/realms/shopsphere");
    assert.equal(response.status, 404);
  } finally {
    server.close();
  }
});

test("metadata token provider rejects empty responses", async () => {
  const provider = metadataTokenProvider(AUTH, async (_url, init) => {
    assert.equal(init.headers["Metadata-Flavor"], "Google");
    return new Response("", { status: 200 });
  });
  await assert.rejects(provider(), /Gateway identity unavailable/);
});
