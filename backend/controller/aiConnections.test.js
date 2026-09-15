import assert from "node:assert/strict";
import test from "node:test";

import { beginConnection, getConnectionCatalog, listConnections, revokeConnection } from "./aiConnections.js";
import { hashPassword } from "../utils/password.js";

const response = () => {
  const res = { statusCode: 200, body: null };
  res.status = (statusCode) => { res.statusCode = statusCode; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.send = () => res;
  return res;
};

const user = async (overrides = {}) => ({
  id: "user-1",
  firstName: "Ada",
  lastName: "Buyer",
  email: "ada@example.com",
  role: "user",
  password: await hashPassword("correct-password"),
  ...overrides,
});

test("connection catalog exposes one live role and the external retention boundary", async () => {
  const res = response();
  await getConnectionCatalog({ user: { id: "user-1", role: "seller" } }, res);
  assert.equal(res.body.clients[0].role, "seller");
  assert.ok(res.body.clients[0].availableScopes.includes("catalog:read"));
  assert.match(res.body.clients[0].retentionNotice, /cannot control/i);
  assert.equal(JSON.stringify(res.body).includes("secret"), false);
});

test("connection start verifies the browser user and only permits current-role scopes", async () => {
  const account = await user();
  const client = { user: { findUnique: async () => account } };
  let ensured = null;
  const keycloak = {
    ensureUser: async (value, password) => { ensured = { value, password }; },
    authorizationUrl: ({ scopes }) => `https://auth.test/authorize?scope=${scopes.join("+")}`,
  };
  const baseBody = {
    clientId: "shopsphere-mcp-client",
    redirectUri: "http://localhost:6274/oauth/callback",
    scopes: ["profile:read", "cart:read"],
    codeChallenge: "a".repeat(43),
    state: "b".repeat(16),
    currentPassword: "correct-password",
  };
  const res = response();
  await beginConnection({ user: { id: account.id }, body: baseBody }, res, client, keycloak);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(ensured, { value: account, password: "correct-password" });
  assert.match(res.body.authorizationUrl, /profile:read\+cart:read/);

  const wrongPassword = response();
  await beginConnection({ user: { id: account.id }, body: { ...baseBody, currentPassword: "wrong" } }, wrongPassword, client, keycloak);
  assert.equal(wrongPassword.statusCode, 403);

  const widened = response();
  await beginConnection({ user: { id: account.id }, body: { ...baseBody, scopes: ["catalog:read"] } }, widened, client, keycloak);
  assert.equal(widened.statusCode, 403);
});

test("connection reads and revocation always bind the authenticated owner", async () => {
  const observed = [];
  const keycloak = {
    listConnections: async (subject) => { observed.push(["list", subject]); return [{ id: "shopsphere-mcp-client" }]; },
    revokeConnection: async (subject, clientId) => { observed.push(["revoke", subject, clientId]); return true; },
  };
  const listed = response();
  await listConnections({ user: { id: "owner-1" } }, listed, keycloak);
  assert.deepEqual(listed.body.connections, [{ id: "shopsphere-mcp-client" }]);

  const revoked = response();
  await revokeConnection({ user: { id: "owner-1" }, params: { clientId: "shopsphere-mcp-client" } }, revoked, keycloak);
  assert.equal(revoked.statusCode, 204);
  assert.deepEqual(observed, [
    ["list", "owner-1"],
    ["revoke", "owner-1", "shopsphere-mcp-client"],
  ]);
});
