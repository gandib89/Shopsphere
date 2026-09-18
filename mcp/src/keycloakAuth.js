import { createRemoteJWKSet, jwtVerify } from "jose";

const algorithms = ["RS256"];

export const createKeycloakMcpAuth = ({
  issuer,
  jwksUri = `${issuer}/protocol/openid-connect/certs`,
  tokenEndpoint = `${issuer}/protocol/openid-connect/token`,
  introspectionEndpoint = `${issuer}/protocol/openid-connect/token/introspect`,
  audience,
  resourceUrl,
  clientId,
  clientSecret,
  assistantAudience,
  trustedClients,
  jwks,
  fetchImpl = fetch,
}) => {
  if (!issuer || !audience || !resourceUrl || !clientId || !clientSecret || !assistantAudience) {
    throw new Error("Complete Keycloak MCP configuration is required");
  }
  let resource;
  try {
    resource = new URL(resourceUrl);
  } catch {
    throw new Error("MCP_RESOURCE_URL must be the public MCP endpoint URL");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(resource.hostname);
  if ((resource.protocol !== "https:" && !(resource.protocol === "http:" && loopback))
    || resource.pathname !== "/mcp" || resource.search || resource.hash
    || resource.username || resource.password) {
    throw new Error("MCP_RESOURCE_URL must be the public MCP endpoint URL");
  }
  const keySet = jwks ?? createRemoteJWKSet(new URL(jwksUri), { timeoutDuration: 5_000 });
  const clientAuth = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;

  const verify = async (token) => {
    let payload;
    try {
      ({ payload } = await jwtVerify(token, keySet, {
        issuer,
        audience,
        algorithms,
        requiredClaims: ["sub", "exp", "iat", "sid", "shopsphere_user_id", "shopsphere_role", "shopsphere_verified"],
      }));
    } catch {
      const error = new Error("Invalid MCP access token");
      error.statusCode = 401;
      throw error;
    }
    const sourceClient = payload.azp;
    if (!trustedClients.includes(sourceClient)) {
      const error = new Error("Unapproved OAuth client");
      error.statusCode = 403;
      throw error;
    }
    let response;
    try {
      response = await fetchImpl(introspectionEndpoint, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
        headers: { authorization: clientAuth, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
      });
    } catch {
      const error = new Error("OAuth issuer unavailable");
      error.statusCode = 503;
      throw error;
    }
    if (!response.ok) {
      const error = new Error("OAuth issuer unavailable");
      error.statusCode = 503;
      throw error;
    }
    if ((await response.json()).active !== true) {
      const error = new Error("Inactive MCP access token");
      error.statusCode = 401;
      throw error;
    }
    return {
      sub: payload.shopsphere_user_id ?? payload.sub,
      role: payload.shopsphere_role,
      verified: payload.shopsphere_verified === true || payload.shopsphere_verified === "true",
      clientId: sourceClient,
      grantId: payload.sid,
      scopes: typeof payload.scope === "string" ? payload.scope.split(" ").filter(Boolean) : [],
    };
  };

  const exchange = async (subjectToken, scopes) => {
    const response = await fetchImpl(tokenEndpoint, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
      headers: { authorization: clientAuth, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        subject_token: subjectToken,
        requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
        audience: assistantAudience,
        ...(scopes?.length ? { scope: scopes.join(" ") } : {}),
      }),
    });
    if (!response.ok) {
      const error = new Error("Delegated token exchange failed");
      error.statusCode = response.status === 400 || response.status === 403 ? 403 : 503;
      throw error;
    }
    const result = await response.json();
    if (typeof result.access_token !== "string" || !result.access_token) {
      const error = new Error("Delegated token exchange returned no token");
      error.statusCode = 503;
      throw error;
    }
    return result.access_token;
  };

  return Object.freeze({
    verify,
    exchange,
    protectedResourceMetadata: {
      resource: resource.href,
      authorization_servers: [issuer],
      bearer_methods_supported: ["header"],
    },
  });
};
