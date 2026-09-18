import { createRemoteJWKSet, decodeJwt, decodeProtectedHeader, jwtVerify } from "jose";

export const MCP_AUDIENCE = process.env.MCP_AUDIENCE ?? "shopsphere-mcp";
export const ASSISTANT_AUDIENCE = process.env.ASSISTANT_AUDIENCE ?? "shopsphere-assistant-api";
export const OAUTH_ISSUER = process.env.MCP_OAUTH_ISSUER ?? "http://localhost:8080/realms/shopsphere";
export const TOKEN_ALGORITHMS = Object.freeze(["RS256"]);

export const OAUTH_SCOPES = Object.freeze([
  "catalog:read",
  "policy:read",
  "profile:read",
  "notifications:read",
  "orders:read",
  "cart:read",
  "cart:propose",
  "proposals:read",
  "sales:read",
  "revenue:read",
  "platform:read",
  "sellers:read",
  "listings:draft",
  "support:read",
  "support:draft",
  "promotions:read",
]);

const configuredClients = (process.env.MCP_OAUTH_CLIENTS ?? "shopsphere-mcp-client")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
export const TRUSTED_CLIENTS = Object.freeze([...new Set(configuredClients)]);

export class OAuthError extends Error {
  constructor(code, message, status = 401) {
    super(`${code}: ${message}`);
    this.code = code;
    this.status = status;
  }
}

export const getProtectedResourceMetadata = (resource = MCP_AUDIENCE) => ({
  resource,
  authorization_servers: [OAUTH_ISSUER],
  bearer_methods_supported: ["header"],
  scopes_supported: [...OAUTH_SCOPES],
});

export const isDelegatedTokenShape = (token) => {
  try {
    const header = decodeProtectedHeader(token);
    const payload = decodeJwt(token);
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    return header.alg === "RS256" && payload.iss === OAUTH_ISSUER && audiences.includes(ASSISTANT_AUDIENCE);
  } catch {
    return false;
  }
};

const bearerClaims = (payload) => ({
  ...payload,
  sub: payload.shopsphere_user_id ?? payload.sub,
  client_id: payload.client_id ?? payload.azp,
  grant_id: payload.sid,
  role: payload.shopsphere_role,
  verified: payload.shopsphere_verified === true || payload.shopsphere_verified === "true",
  scopes: typeof payload.scope === "string" ? payload.scope.split(" ").filter(Boolean) : [],
});

const introspect = async ({ token, endpoint, clientId, clientSecret, fetchImpl }) => {
  if (!endpoint || !clientId || !clientSecret) {
    throw new OAuthError("issuer_unavailable", "Token introspection is not configured", 503);
  }
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
      headers: {
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ token }),
    });
  } catch {
    throw new OAuthError("issuer_unavailable", "Token introspection failed", 503);
  }
  if (!response.ok) throw new OAuthError("issuer_unavailable", "Token introspection failed", 503);
  const result = await response.json();
  if (result.active !== true) throw new OAuthError("invalid_token", "Token is inactive");
};

export const createKeycloakTokenVerifier = ({
  issuer = OAUTH_ISSUER,
  audience,
  jwksUri = process.env.MCP_OAUTH_JWKS_URI ?? `${issuer}/protocol/openid-connect/certs`,
  introspectionEndpoint = process.env.MCP_OAUTH_INTROSPECTION_ENDPOINT ?? `${issuer}/protocol/openid-connect/token/introspect`,
  introspectionClientId = process.env.MCP_OAUTH_INTROSPECTION_CLIENT_ID,
  introspectionClientSecret = process.env.MCP_OAUTH_INTROSPECTION_CLIENT_SECRET,
  requiredAuthorizedParty,
  trustedClients = TRUSTED_CLIENTS,
  jwks,
  fetchImpl = fetch,
} = {}) => {
  if (!audience) throw new Error("Keycloak token audience is required");
  const keySet = jwks ?? createRemoteJWKSet(new URL(jwksUri), { timeoutDuration: 5_000 });

  return async (token) => {
    if (typeof token !== "string" || !token) throw new OAuthError("invalid_token", "Missing token");
    let payload;
    try {
      ({ payload } = await jwtVerify(token, keySet, {
        issuer,
        audience,
        algorithms: [...TOKEN_ALGORITHMS],
        requiredClaims: ["sub", "exp", "iat", "sid", "shopsphere_user_id", "shopsphere_role", "shopsphere_verified"],
      }));
    } catch {
      throw new OAuthError("invalid_token", "Token verification failed");
    }

    await introspect({
      token,
      endpoint: introspectionEndpoint,
      clientId: introspectionClientId,
      clientSecret: introspectionClientSecret,
      fetchImpl,
    });

    const claims = bearerClaims(payload);
    if (!claims.grant_id) throw new OAuthError("invalid_token", "Missing grant binding");
    if (requiredAuthorizedParty && payload.azp !== requiredAuthorizedParty) {
      throw new OAuthError("invalid_token", "Wrong authorized workload");
    }
    if (!requiredAuthorizedParty && !trustedClients.includes(claims.client_id)) {
      throw new OAuthError("unauthorized_client", "Unapproved client", 403);
    }
    return claims;
  };
};

let delegatedVerifier;
export const verifyDelegatedToken = (token) => {
  delegatedVerifier ??= createKeycloakTokenVerifier({
    audience: ASSISTANT_AUDIENCE,
    requiredAuthorizedParty: process.env.MCP_WORKLOAD_CLIENT_ID ?? "shopsphere-mcp-workload",
  });
  return delegatedVerifier(token);
};
