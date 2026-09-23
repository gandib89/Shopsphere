import assert from "node:assert/strict";
import test from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";

import { createKeycloakMcpAuth } from "../src/keycloakAuth.js";

const ISSUER = "https://auth.test/realms/shopsphere";
const AUDIENCE = "shopsphere-mcp";

const tokenFixture = async ({ azp = "shopsphere-mcp-client", audience = AUDIENCE } = {}) => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  Object.assign(jwk, { kid: "test-key", use: "sig", alg: "RS256" });
  const token = await new SignJWT({
    azp,
    sid: "grant-1",
    scope: "profile:read catalog:read",
    shopsphere_user_id: "user-1",
    shopsphere_role: "user",
    shopsphere_verified: true,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(ISSUER)
    .setAudience(audience)
    .setSubject("keycloak-user-1")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  return { token, jwks: createLocalJWKSet({ keys: [jwk] }) };
};

const createAuth = ({ jwks, active = true, fetchImpl } = {}) => createKeycloakMcpAuth({
  issuer: ISSUER,
  audience: AUDIENCE,
  resourceUrl: "https://mcp.test/mcp",
  assistantAudience: "shopsphere-assistant-api",
  clientId: "shopsphere-mcp-workload",
  clientSecret: "workload-secret",
  trustedClients: ["shopsphere-mcp-client"],
  jwks,
  fetchImpl: fetchImpl ?? (async () => new Response(JSON.stringify({ active }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })),
});

test("verifies an active audience-bound token from an approved client", async () => {
  const { token, jwks } = await tokenFixture();
  const auth = createAuth({ jwks });
  assert.deepEqual(await auth.verify(token), {
    sub: "user-1",
    role: "user",
    verified: true,
    clientId: "shopsphere-mcp-client",
    grantId: "grant-1",
    scopes: ["profile:read", "catalog:read"],
  });
  assert.deepEqual(auth.protectedResourceMetadata.authorization_servers, [ISSUER]);
  assert.equal(auth.protectedResourceMetadata.resource, "https://mcp.test/mcp");
});

test("rejects an audience name or non-loopback HTTP as protected resource metadata", () => {
  for (const resourceUrl of ["shopsphere-mcp", "http://mcp.test/mcp"]) {
    assert.throws(() => createKeycloakMcpAuth({
      issuer: ISSUER,
      audience: AUDIENCE,
      resourceUrl,
      assistantAudience: "shopsphere-assistant-api",
      clientId: "shopsphere-mcp-workload",
      clientSecret: "workload-secret",
      trustedClients: ["shopsphere-mcp-client"],
    }), /MCP_RESOURCE_URL/);
  }
});

test("rejects inactive, wrong-audience, and unapproved-client tokens", async () => {
  const good = await tokenFixture();
  await assert.rejects(createAuth({ jwks: good.jwks, active: false }).verify(good.token), /Inactive/);

  const wrongClient = await tokenFixture({ azp: "evil-client" });
  await assert.rejects(createAuth({ jwks: wrongClient.jwks }).verify(wrongClient.token), /Unapproved/);

  const wrongAudience = await tokenFixture({ audience: "some-api" });
  await assert.rejects(createAuth({ jwks: wrongAudience.jwks }).verify(wrongAudience.token), /Invalid/);
});

test("exchanges only the presented subject token for the fixed assistant audience", async () => {
  const { jwks } = await tokenFixture();
  let request;
  const auth = createAuth({
    jwks,
    fetchImpl: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({ access_token: "delegated-token" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  assert.equal(await auth.exchange("subject-token", ["profile:read"]), "delegated-token");
  const body = new URLSearchParams(request.init.body);
  assert.equal(body.get("subject_token"), "subject-token");
  assert.equal(body.get("subject_token_type"), "urn:ietf:params:oauth:token-type:access_token");
  assert.equal(body.get("audience"), "shopsphere-assistant-api");
  assert.equal(body.get("scope"), "profile:read");
  assert.equal(body.get("subject"), null);
});

test("issuer failures fail closed", async () => {
  const { token, jwks } = await tokenFixture();
  const auth = createAuth({
    jwks,
    fetchImpl: async () => { throw new Error("offline"); },
  });
  await assert.rejects(auth.verify(token), (error) => error.statusCode === 503);
});
