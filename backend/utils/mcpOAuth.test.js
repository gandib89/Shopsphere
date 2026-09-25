import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from "jose";

import {
  ASSISTANT_AUDIENCE,
  MCP_AUDIENCE,
  OAUTH_ISSUER,
  createKeycloakTokenVerifier,
  getProtectedResourceMetadata,
} from "./mcpOAuth.js";
import {
  authenticateAssistantDelegation,
  rejectDelegatedTokens,
  validateAssistantAccess,
} from "../middlewares/assistantDelegation.js";
import mcpOAuthRouter from "../routes/mcpOAuthRoute.js";

const WORKLOAD = "shopsphere-mcp-workload";

const fixture = async ({ audience = ASSISTANT_AUDIENCE, azp = WORKLOAD, expiresIn = "5m" } = {}) => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = "test-key";
  publicJwk.use = "sig";
  publicJwk.alg = "RS256";
  const token = await new SignJWT({
    shopsphere_user_id: "user-1",
    shopsphere_role: "user",
    shopsphere_verified: true,
    scope: "catalog:read profile:read",
    azp,
    sid: "session-1",
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(OAUTH_ISSUER)
    .setAudience(audience)
    .setSubject("keycloak-user-1")
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(privateKey);
  return { token, jwks: createLocalJWKSet({ keys: [publicJwk] }) };
};

const verifierFor = ({ jwks, active = true, audience = ASSISTANT_AUDIENCE, azp = WORKLOAD } = {}) =>
  createKeycloakTokenVerifier({
    issuer: OAUTH_ISSUER,
    audience,
    jwks,
    requiredAuthorizedParty: azp,
    introspectionEndpoint: "https://keycloak.test/introspect",
    introspectionClientId: "assistant-api",
    introspectionClientSecret: "secret",
    fetchImpl: async () => new Response(JSON.stringify({ active }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });

const fakeRes = () => {
  const res = { statusCode: null, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
};

test("protected-resource metadata delegates authorization to Keycloak", () => {
  const metadata = getProtectedResourceMetadata();
  assert.equal(metadata.resource, MCP_AUDIENCE);
  assert.deepEqual(metadata.authorization_servers, [OAUTH_ISSUER]);
  assert.ok(metadata.scopes_supported.includes("profile:read"));
});

test("Keycloak verification enforces issuer, audience, algorithm, workload, session, and active state", async () => {
  const { token, jwks } = await fixture();
  const claims = await verifierFor({ jwks })(token);
  assert.equal(claims.sub, "user-1");
  assert.equal(claims.grant_id, "session-1");
  assert.equal(claims.client_id, WORKLOAD);
  assert.deepEqual(claims.scopes, ["catalog:read", "profile:read"]);

  await assert.rejects(verifierFor({ jwks, active: false })(token), /invalid_token/);
  await assert.rejects(verifierFor({ jwks, audience: "wrong-audience" })(token), /invalid_token/);
  await assert.rejects(verifierFor({ jwks, azp: "wrong-workload" })(token), /invalid_token/);
  await assert.rejects(verifierFor({ jwks })("not.a.token"), /invalid_token/);
});

test("introspection outage fails closed", async () => {
  const { token, jwks } = await fixture();
  const verify = createKeycloakTokenVerifier({
    issuer: OAUTH_ISSUER,
    audience: ASSISTANT_AUDIENCE,
    jwks,
    requiredAuthorizedParty: WORKLOAD,
    introspectionEndpoint: "https://keycloak.test/introspect",
    introspectionClientId: "assistant-api",
    introspectionClientSecret: "secret",
    fetchImpl: async () => { throw new Error("offline"); },
  });
  await assert.rejects(verify(token), (error) => error.code === "issuer_unavailable" && error.status === 503);
});

test("delegation middleware exposes normalized claims and rejects inactive credentials", async () => {
  const { token, jwks } = await fixture();
  const verify = verifierFor({ jwks });
  const req = { headers: { authorization: `Bearer ${token}` } };
  let nexted = false;
  await authenticateAssistantDelegation(req, fakeRes(), () => { nexted = true; }, verify);
  assert.equal(nexted, true);
  assert.equal(req.delegation.sub, "user-1");
  assert.equal(req.delegation.grantId, "session-1");
  assert.equal(req.delegation.verified, true);
  assert.equal(req.user, undefined);

  const denied = fakeRes();
  await authenticateAssistantDelegation(req, denied, () => {}, verifierFor({ jwks, active: false }));
  assert.equal(denied.statusCode, 401);
});

test("assistant access rechecks live role, verification, scope, and rollout before data access", async () => {
  const previous = process.env.MCP_TOOL_GET_MY_PROFILE_SUMMARY_ENABLED;
  const previousCohort = process.env.MCP_ACCOUNT_COHORT;
  process.env.MCP_TOOL_GET_MY_PROFILE_SUMMARY_ENABLED = "true";
  process.env.MCP_ACCOUNT_COHORT = "user-1";
  try {
    const account = { id: "user-1", firstName: "Ada", lastName: "Buyer", role: "user", isVerified: true };
    const client = { user: { findUnique: async () => account } };
    const request = { delegation: { sub: "user-1", role: "user", verified: true, scopes: ["profile:read"] } };
    assert.deepEqual(
      await validateAssistantAccess(request, { scope: "profile:read", rolloutFlag: "MCP_TOOL_GET_MY_PROFILE_SUMMARY_ENABLED" }, client),
      { account },
    );
    assert.equal((await validateAssistantAccess({ delegation: { ...request.delegation, scopes: [] } }, { scope: "profile:read" }, client)).code, "insufficient_scope");
    assert.equal((await validateAssistantAccess({ delegation: { ...request.delegation, role: "seller" } }, {}, client)).code, "stale_identity");
    assert.equal((await validateAssistantAccess({ delegation: { ...request.delegation, verified: false } }, {}, client)).code, "stale_identity");
    process.env.MCP_TOOL_GET_MY_PROFILE_SUMMARY_ENABLED = "false";
    assert.equal((await validateAssistantAccess(request, { rolloutFlag: "MCP_TOOL_GET_MY_PROFILE_SUMMARY_ENABLED" }, client)).code, "not_available");
  } finally {
    if (previous === undefined) delete process.env.MCP_TOOL_GET_MY_PROFILE_SUMMARY_ENABLED;
    else process.env.MCP_TOOL_GET_MY_PROFILE_SUMMARY_ENABLED = previous;
    if (previousCohort === undefined) delete process.env.MCP_ACCOUNT_COHORT;
    else process.env.MCP_ACCOUNT_COHORT = previousCohort;
  }
});

test("delegated tokens are rejected outside assistant routes", async () => {
  const { token, jwks } = await fixture();
  const blocked = fakeRes();
  let passed = false;
  await rejectDelegatedTokens(
    { headers: { authorization: `Bearer ${token}` } },
    blocked,
    () => { passed = true; },
    verifierFor({ jwks }),
  );
  assert.equal(passed, false);
  assert.equal(blocked.statusCode, 403);

  const inactive = fakeRes();
  await rejectDelegatedTokens(
    { headers: { authorization: `Bearer ${token}` } },
    inactive,
    () => {},
    verifierFor({ jwks, active: false }),
  );
  assert.equal(inactive.statusCode, 403);

  passed = false;
  await rejectDelegatedTokens(
    { headers: { authorization: "Bearer browser-token" } },
    fakeRes(),
    () => { passed = true; },
    verifierFor({ jwks }),
  );
  assert.equal(passed, true);
});

test("the application exposes protected-resource metadata but not a home-grown token endpoint", async (t) => {
  const app = express();
  app.use(mcpOAuthRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const metadata = await fetch(`${base}/.well-known/oauth-protected-resource`);
  assert.equal(metadata.status, 200);
  assert.deepEqual((await metadata.json()).authorization_servers, [OAUTH_ISSUER]);
  assert.equal((await fetch(`${base}/api/v1/oauth/token`, { method: "POST" })).status, 404);
});
