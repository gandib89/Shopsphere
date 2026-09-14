import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { generateKeyPairSync } from "node:crypto";
import jwt from "jsonwebtoken";

import {
  ASSISTANT_AUDIENCE,
  MCP_AUDIENCE,
  OAUTH_ISSUER,
  TRUSTED_CLIENTS,
  clearOAuthState,
  createCodeChallenge,
  createGrant,
  exchangeForDelegatedToken,
  generateCodeVerifier,
  getAuthorizationServerMetadata,
  getProtectedResourceMetadata,
  isTrustedClient,
  mintMcpToken,
  revokeGrant,
  verifyCodeChallenge,
  verifyDelegatedToken,
  verifyMcpToken,
} from "./mcpOAuth.js";
import { authenticateAssistantDelegation, rejectDelegatedTokens } from "../middlewares/assistantDelegation.js";
import mcpOAuthRouter from "../routes/mcpOAuthRoute.js";
import { signAccessToken } from "./tokens.js";

process.env.JWT_SECRET ??= "mcp-oauth-test-secret";

const CLIENT = TRUSTED_CLIENTS[0];
const SCOPES = ["catalog:read", "policy:read"];
const WORKLOAD = "mcp-workload-test";

const setup = () => {
  clearOAuthState();
  const grant = createGrant({ sub: "user-1", clientId: CLIENT, scopes: SCOPES, role: "user" });
  const mcpToken = mintMcpToken({
    sub: grant.sub,
    clientId: grant.clientId,
    grantId: grant.id,
    scopes: SCOPES,
  });
  return { grant, mcpToken };
};

const fakeRes = () => {
  const res = { statusCode: null, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return { json: (body) => { res.body = body; } };
  };
  return res;
};

test("PKCE uses S256 and rejects tampered verifiers", () => {
  const verifier = generateCodeVerifier();
  assert.ok(verifier.length >= 43);
  const challenge = createCodeChallenge(verifier);
  assert.ok(verifyCodeChallenge(verifier, challenge));
  assert.equal(verifyCodeChallenge(`${verifier}x`, challenge), false);
  assert.equal(verifyCodeChallenge("", challenge), false);
});

test("metadata advertises PKCE, pre-registered clients stay usable without secrets", () => {
  const pr = getProtectedResourceMetadata();
  assert.equal(pr.resource, MCP_AUDIENCE);
  assert.deepEqual(pr.authorization_servers, [OAUTH_ISSUER]);
  assert.deepEqual(pr.bearer_methods_supported, ["header"]);

  const as = getAuthorizationServerMetadata();
  assert.equal(as.issuer, OAUTH_ISSUER);
  assert.deepEqual(as.code_challenge_methods_supported, ["S256"]);
  assert.ok(as.grant_types_supported.includes("urn:ietf:params:oauth:grant-type:token-exchange"));
  assert.ok(isTrustedClient(CLIENT));
  assert.equal(isTrustedClient("evil-client"), false);
  assert.throws(() => createGrant({ sub: "u", clientId: "evil-client", scopes: SCOPES }), /Unknown client/);
});

test("MCP and Express tokens are audience-separated; browser JWT fits neither", () => {
  const { mcpToken } = setup();
  assert.equal(verifyMcpToken(mcpToken).sub, "user-1");
  assert.throws(() => verifyDelegatedToken(mcpToken), /invalid_token/);

  const delegated = exchangeForDelegatedToken({ subjectToken: mcpToken, workloadId: WORKLOAD });
  assert.equal(verifyDelegatedToken(delegated).aud, ASSISTANT_AUDIENCE);
  assert.throws(() => verifyMcpToken(delegated), /invalid_token/);

  const browser = signAccessToken({ id: "user-1", role: "user" });
  assert.throws(() => verifyMcpToken(browser), /invalid_token/);
  assert.throws(() => verifyDelegatedToken(browser), /invalid_token/);
});

test("exchange binds subject, grant, client, workload and narrows scopes", () => {
  const { grant, mcpToken } = setup();
  const delegated = exchangeForDelegatedToken({
    subjectToken: mcpToken,
    workloadId: WORKLOAD,
    scopes: ["catalog:read"],
  });
  const claims = verifyDelegatedToken(delegated);
  assert.equal(claims.sub, grant.sub);
  assert.equal(claims.grant_id, grant.id);
  assert.equal(claims.client_id, CLIENT);
  assert.equal(claims.scope, "catalog:read");
  assert.equal(claims.act.workload, WORKLOAD);
});

test("exchange rejects victim-sub forgery, wider scopes, and arbitrary audiences", () => {
  const { mcpToken } = setup();

  // Forged subject token: correct issuer/audience shape, victim sub, wrong key.
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const forged = jwt.sign(
    { sub: "victim", client_id: CLIENT, grant_id: "whatever", scope: SCOPES.join(" ") },
    privateKey.export({ format: "pem", type: "pkcs8" }),
    { algorithm: "ES256", issuer: OAUTH_ISSUER, audience: MCP_AUDIENCE, expiresIn: 300 },
  );
  assert.throws(() => exchangeForDelegatedToken({ subjectToken: forged, workloadId: WORKLOAD }), /invalid_token/);

  // Caller-supplied victim sub is not a parameter: attested subject wins.
  const kept = verifyDelegatedToken(
    exchangeForDelegatedToken({ subjectToken: mcpToken, workloadId: WORKLOAD, sub: "victim" }),
  );
  assert.equal(kept.sub, "user-1");

  assert.throws(
    () => exchangeForDelegatedToken({ subjectToken: mcpToken, workloadId: WORKLOAD, scopes: ["orders:read"] }),
    /Scope exceeds/,
  );
  assert.throws(
    () => exchangeForDelegatedToken({ subjectToken: mcpToken, workloadId: WORKLOAD, audience: "https://evil.test" }),
    /Unknown target/,
  );
});

test("exchange denies workload-only fallback", () => {
  const { mcpToken } = setup();
  assert.throws(() => exchangeForDelegatedToken({ workloadId: WORKLOAD }), /Subject token is required/);
  assert.throws(() => exchangeForDelegatedToken({ subjectToken: mcpToken }), /workload/);
  assert.throws(() => exchangeForDelegatedToken({ subjectToken: mcpToken, workloadId: "" }), /workload/);
});

test("revoked, expired, and malformed credentials are denied deterministically", () => {
  const { grant, mcpToken } = setup();
  assert.doesNotThrow(() => verifyMcpToken(mcpToken));

  revokeGrant(grant.id);
  assert.throws(() => verifyMcpToken(mcpToken), /grant_revoked/);
  assert.throws(() => verifyMcpToken(mcpToken), /grant_revoked/); // stable code, not flaky

  const fresh = setup();
  const expired = mintMcpToken({
    sub: fresh.grant.sub,
    clientId: fresh.grant.clientId,
    grantId: fresh.grant.id,
    scopes: SCOPES,
    expiresInSec: -60,
  });
  assert.throws(() => verifyMcpToken(expired), /invalid_token/);
  assert.throws(() => verifyMcpToken("not.a.token"), /invalid_token/);
  const tampered = `${mcpToken.slice(0, -1)}${mcpToken.endsWith("A") ? "B" : "A"}`;
  assert.throws(() => verifyMcpToken(tampered), /invalid_token/);

  // Revocation also kills already-exchanged delegated tokens.
  const live = setup();
  const delegated = exchangeForDelegatedToken({ subjectToken: live.mcpToken, workloadId: WORKLOAD });
  assert.doesNotThrow(() => verifyDelegatedToken(delegated));
  revokeGrant(live.grant.id);
  assert.throws(() => verifyDelegatedToken(delegated), /grant_revoked/);
});

test("delegation middleware populates req.delegation, never req.user, and denies confusion", () => {
  const { mcpToken } = setup();
  const delegated = exchangeForDelegatedToken({ subjectToken: mcpToken, workloadId: WORKLOAD });

  const req = { headers: { authorization: `Bearer ${delegated}` } };
  let nexted = false;
  authenticateAssistantDelegation(req, fakeRes(), () => { nexted = true; });
  assert.equal(nexted, true);
  assert.equal(req.delegation.sub, "user-1");
  assert.equal(req.delegation.workload, WORKLOAD);
  assert.equal(req.user, undefined);

  for (const bad of [mcpToken, signAccessToken({ id: "user-1", role: "user" }), "garbage", null]) {
    const r = { headers: bad ? { authorization: `Bearer ${bad}` } : {} };
    const res = fakeRes();
    let called = false;
    authenticateAssistantDelegation(r, res, () => { called = true; });
    assert.equal(called, false);
    assert.equal(res.statusCode, 401);
    assert.equal(r.user, undefined);
  }
});

test("rejectDelegatedTokens blocks delegated credentials elsewhere but passes the rest", () => {
  const { mcpToken } = setup();
  const delegated = exchangeForDelegatedToken({ subjectToken: mcpToken, workloadId: WORKLOAD });

  const blocked = fakeRes();
  let called = false;
  rejectDelegatedTokens({ headers: { authorization: `Bearer ${delegated}` } }, blocked, () => { called = true; });
  assert.equal(called, false);
  assert.equal(blocked.statusCode, 403);

  for (const ok of [mcpToken, signAccessToken({ id: "user-1", role: "admin" }), null]) {
    const res = fakeRes();
    let passed = false;
    rejectDelegatedTokens(
      { headers: ok ? { authorization: `Bearer ${ok}` } : {} },
      res,
      () => { passed = true; },
    );
    assert.equal(passed, true);
  }
});

test("OAuth routes serve metadata and a bound exchange with deterministic errors", async (t) => {
  clearOAuthState();
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(mcpOAuthRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const pr = await (await fetch(`${base}/.well-known/oauth-protected-resource`)).json();
  assert.equal(pr.resource, MCP_AUDIENCE);
  const as = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
  assert.deepEqual(as.code_challenge_methods_supported, ["S256"]);

  const { mcpToken } = setup();
  const exchange = (body) =>
    fetch(`${base}/api/v1/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        subject_token: mcpToken,
        workload_id: WORKLOAD,
        ...body,
      }),
    });

  const ok = await exchange({ scope: "catalog:read" });
  assert.equal(ok.status, 200);
  const okBody = await ok.json();
  assert.equal(okBody.audience, ASSISTANT_AUDIENCE);
  assert.equal(verifyDelegatedToken(okBody.access_token).scope, "catalog:read");

  const widened = await exchange({ scope: "catalog:read orders:read" });
  assert.equal(widened.status, 400);
  assert.equal((await widened.json()).error, "invalid_scope");

  const wrongAud = await exchange({ audience: "https://evil.test" });
  assert.equal(wrongAud.status, 400);

  const noWorkload = await fetch(`${base}/api/v1/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: mcpToken,
    }),
  });
  assert.equal(noWorkload.status, 400);

  const badGrant = await exchange({ subject_token: "bogus" });
  assert.equal(badGrant.status, 401);

  const clientMismatch = await exchange({ client_id: "shopsphere-first-party-client-x" });
  assert.equal(clientMismatch.status, 400);
});
