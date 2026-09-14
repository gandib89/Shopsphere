import { createHash, generateKeyPairSync, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import jwt from "jsonwebtoken";

// Phase 0 OAuth/delegation foundations (issue #6). In-memory grant store and
// ES256 token family with audience separation. No DB migration: persistence
// moves to Prisma in a later phase; the function shapes stay the same.
// The existing browser JWT (utils/tokens.js, HS256) is untouched and never
// accepted here; delegated tokens never touch legacy verifiers.

export const MCP_AUDIENCE = process.env.MCP_AUDIENCE ?? "https://mcp.shopsphere.example/mcp";
export const ASSISTANT_AUDIENCE = process.env.ASSISTANT_AUDIENCE ?? "shopsphere-assistant-api";
export const OAUTH_ISSUER = process.env.MCP_OAUTH_ISSUER ?? "https://auth.shopsphere.example";
export const TOKEN_ALGORITHM = "ES256";
export const ALLOWED_ALGORITHMS = Object.freeze(["ES256"]);
export const MCP_TOKEN_TTL_SEC = 5 * 60;
export const DELEGATED_TOKEN_TTL_SEC = 60;
export const GRANT_TTL_MS = 60 * 60 * 1000;

export const OAUTH_SCOPES = Object.freeze([
  "catalog:read",
  "policy:read",
  "profile:read",
  "orders:read",
  "cart:read",
]);

const defaultClients = ["shopsphere-first-party-client"];
const configuredClients = (process.env.MCP_OAUTH_CLIENTS ?? "")
  .split(",")
  .map((c) => c.trim())
  .filter(Boolean);
export const TRUSTED_CLIENTS = Object.freeze([...new Set([...defaultClients, ...configuredClients])]);

export const isTrustedClient = (clientId) => TRUSTED_CLIENTS.includes(clientId);

export class OAuthError extends Error {
  constructor(code, message, status = 400) {
    super(`${code}: ${message}`);
    this.code = code;
    this.status = status;
  }
}

// --- PKCE (RFC 7636, S256 only) ---

export const generateCodeVerifier = () => randomBytes(32).toString("base64url");

export const createCodeChallenge = (verifier) =>
  createHash("sha256").update(verifier).digest("base64url");

export const verifyCodeChallenge = (verifier, challenge) => {
  if (typeof verifier !== "string" || typeof challenge !== "string") return false;
  if (!verifier || !challenge) return false;
  const expected = Buffer.from(createCodeChallenge(verifier));
  const actual = Buffer.from(challenge);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

// --- Metadata (RFC 8414 / draft-ietf-oauth-resource-metadata) ---

export const getProtectedResourceMetadata = (resource = MCP_AUDIENCE) => ({
  resource,
  authorization_servers: [OAUTH_ISSUER],
  bearer_methods_supported: ["header"],
  scopes_supported: [...OAUTH_SCOPES],
});

export const getAuthorizationServerMetadata = (issuer = OAUTH_ISSUER) => ({
  issuer,
  authorization_endpoint: `${issuer}/authorize`,
  token_endpoint: `${issuer}/token`,
  jwks_uri: `${issuer}/.well-known/jwks.json`,
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "urn:ietf:params:oauth:grant-type:token-exchange"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
  scopes_supported: [...OAUTH_SCOPES],
});

// --- Keys (asymmetric; MCP/verifiers hold the public key only) ---

let keyPair = null;
const keyId = (publicPem) => createHash("sha256").update(publicPem).digest("hex").slice(0, 16);

const ensureKeyPair = () => {
  if (!keyPair) rotateOAuthKeys();
  return keyPair;
};

export const rotateOAuthKeys = () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const privatePem = privateKey.export({ format: "pem", type: "pkcs8" });
  const publicPem = publicKey.export({ format: "pem", type: "spki" });
  keyPair = { privatePem, publicPem, kid: keyId(publicPem) };
  return keyPair;
};

export const getOAuthPublicKey = () => ensureKeyPair().publicPem;
export const getOAuthKeyId = () => ensureKeyPair().kid;

// --- Grants (in-memory; active-grant check on every use) ---

const grants = new Map();

const assertScopes = (scopes) => {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new OAuthError("invalid_scope", "At least one scope is required");
  }
  for (const scope of scopes) {
    if (!OAUTH_SCOPES.includes(scope)) throw new OAuthError("invalid_scope", `Unknown scope: ${scope}`);
  }
};

export const createGrant = ({ sub, clientId, scopes, role = "user", codeChallenge = null }) => {
  if (!sub || typeof sub !== "string") throw new OAuthError("invalid_request", "Grant subject is required");
  if (!isTrustedClient(clientId)) throw new OAuthError("unauthorized_client", "Unknown client");
  assertScopes(scopes);
  const now = Date.now();
  const grant = {
    id: randomUUID(),
    sub,
    clientId,
    scopes: [...new Set(scopes)],
    role,
    codeChallenge,
    createdAt: now,
    expiresAt: now + GRANT_TTL_MS,
    revokedAt: null,
  };
  grants.set(grant.id, grant);
  return { ...grant };
};

export const getGrant = (id) => (grants.has(id) ? { ...grants.get(id) } : null);

export const isGrantActive = (id) => {
  const grant = grants.get(id);
  return !!grant && grant.revokedAt === null && grant.expiresAt > Date.now();
};

export const revokeGrant = (id) => {
  const grant = grants.get(id);
  if (!grant) return false;
  grant.revokedAt = Date.now();
  return true;
};

export const clearOAuthState = () => {
  grants.clear();
  rotateOAuthKeys();
};

// --- Tokens ---

const sign = (payload, { audience, expiresInSec, tokenUse }) => {
  const { privatePem, kid } = ensureKeyPair();
  return jwt.sign(
    { ...payload, token_use: tokenUse },
    privatePem,
    {
      algorithm: TOKEN_ALGORITHM,
      issuer: OAUTH_ISSUER,
      audience,
      expiresIn: expiresInSec,
      jwtid: randomUUID(),
      keyid: kid,
    },
  );
};

// Deterministic denial: every verification failure throws OAuthError with a
// stable code. No legacy HS256 fallback exists on this path.
const verify = (token, audience) => {
  if (typeof token !== "string" || !token) {
    throw new OAuthError("invalid_token", "Missing token", 401);
  }
  let decoded;
  try {
    decoded = jwt.verify(token, ensureKeyPair().publicPem, {
      algorithms: [...ALLOWED_ALGORITHMS],
      issuer: OAUTH_ISSUER,
      audience,
    });
  } catch (error) {
    if (error?.name === "TokenExpiredError") throw new OAuthError("invalid_token", "Token expired", 401);
    throw new OAuthError("invalid_token", "Token verification failed", 401);
  }
  if (!isGrantActive(decoded.grant_id)) {
    throw new OAuthError("grant_revoked", "Grant is revoked or expired", 403);
  }
  return decoded;
};

export const mintMcpToken = ({ sub, clientId, grantId, scopes, role = "user", expiresInSec = MCP_TOKEN_TTL_SEC }) => {
  if (!sub || typeof sub !== "string") throw new OAuthError("invalid_request", "Subject is required");
  if (!isTrustedClient(clientId)) throw new OAuthError("unauthorized_client", "Unknown client");
  assertScopes(scopes);
  const grant = grants.get(grantId);
  if (!grant || !isGrantActive(grantId)) throw new OAuthError("invalid_grant", "Grant is not active");
  if (grant.sub !== sub || grant.clientId !== clientId) {
    throw new OAuthError("invalid_grant", "Subject/client must match the grant");
  }
  for (const scope of scopes) {
    if (!grant.scopes.includes(scope)) throw new OAuthError("invalid_scope", "Scope exceeds the grant");
  }
  return sign(
    { sub, client_id: clientId, grant_id: grantId, scope: scopes.join(" "), role },
    { audience: MCP_AUDIENCE, expiresInSec, tokenUse: "mcp_access" },
  );
};

export const verifyMcpToken = (token) => {
  const decoded = verify(token, MCP_AUDIENCE);
  if (decoded.token_use !== "mcp_access") throw new OAuthError("invalid_token", "Not an MCP token", 401);
  return decoded;
};

// RFC 8693-style exchange. Narrow-only: no subject/audience/scope parameter
// can widen what the issuer attested. Workload identity alone grants nothing.
export const exchangeForDelegatedToken = ({ subjectToken, workloadId, scopes = null, audience = ASSISTANT_AUDIENCE }) => {
  if (!subjectToken) throw new OAuthError("invalid_grant", "Subject token is required", 400);
  if (!workloadId || typeof workloadId !== "string") {
    throw new OAuthError("invalid_grant", "Calling workload identity is required", 400);
  }
  if (audience !== ASSISTANT_AUDIENCE) throw new OAuthError("invalid_target", "Unknown target audience", 400);
  const subject = verifyMcpToken(subjectToken);
  const granted = subject.scope ? subject.scope.split(" ") : [];
  const requested = scopes ?? granted;
  assertScopes(requested);
  for (const scope of requested) {
    if (!granted.includes(scope)) throw new OAuthError("invalid_scope", "Scope exceeds the subject token", 400);
  }
  return sign(
    {
      sub: subject.sub,
      client_id: subject.client_id,
      grant_id: subject.grant_id,
      scope: requested.join(" "),
      role: subject.role,
      act: { workload: workloadId },
    },
    { audience: ASSISTANT_AUDIENCE, expiresInSec: DELEGATED_TOKEN_TTL_SEC, tokenUse: "assistant_delegated" },
  );
};

export const verifyDelegatedToken = (token) => {
  const decoded = verify(token, ASSISTANT_AUDIENCE);
  if (decoded.token_use !== "assistant_delegated") {
    throw new OAuthError("invalid_token", "Not a delegated token", 401);
  }
  if (!decoded.act?.workload) throw new OAuthError("invalid_token", "Missing workload binding", 401);
  return decoded;
};
