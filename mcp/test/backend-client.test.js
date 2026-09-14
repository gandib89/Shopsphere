import assert from "node:assert/strict";
import test from "node:test";

import { createBackendClient } from "../src/backendClient.js";

test("private backend calls use workload authentication plus exchanged delegation", async () => {
  const requests = [];
  const client = createBackendClient({
    origin: "http://backend:4000",
    token: "workload-secret",
    exchangeToken: async (subjectToken, scopes) => {
      assert.equal(subjectToken, "mcp-subject-token");
      assert.deepEqual(scopes, ["profile:read"]);
      return "delegated-token";
    },
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(JSON.stringify({ displayName: "Ada Buyer", role: "user", verified: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const output = await client.call("get_my_profile_summary", {}, { subjectToken: "mcp-subject-token" });
  assert.equal(output.displayName, "Ada Buyer");
  assert.equal(requests[0].init.headers.authorization, "Bearer delegated-token");
  assert.equal(requests[0].init.headers["x-assistant-api-token"], "workload-secret");
});

test("authorization context is resolved through a fresh exchanged token", async () => {
  let exchanges = 0;
  const client = createBackendClient({
    origin: "http://backend:4000",
    token: "workload-secret",
    exchangeToken: async () => { exchanges += 1; return "delegated-token"; },
    fetchImpl: async (url, init) => {
      assert.match(String(url), /authorization-context$/);
      assert.equal(init.headers.authorization, "Bearer delegated-token");
      return new Response(JSON.stringify({ subject: "user-1", role: "seller", verified: true, scopes: ["profile:read"], grantId: "grant-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const resolved = await client.resolveAuthorization({
    subjectToken: "mcp-token",
    auth: { sub: "user-1", role: "user", scopes: ["profile:read"] },
  });
  assert.equal(exchanges, 1);
  assert.equal(resolved.auth.role, "seller");
});
