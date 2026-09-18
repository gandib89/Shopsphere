const REALM = "shopsphere";
const RETENTION_NOTICE =
  "Your selected data is shared with the named external AI client. ShopSphere cannot control that client's retention after disclosure.";

export const AI_CLIENTS = Object.freeze({
  "shopsphere-mcp-client": Object.freeze({
    id: "shopsphere-mcp-client",
    name: "ShopSphere approved MCP client",
    retentionNotice: RETENTION_NOTICE,
  }),
});

export const ROLE_SCOPES = Object.freeze({
  user: Object.freeze(["profile:read", "notifications:read", "orders:read", "cart:read", "cart:propose", "orders:propose", "proposals:read", "support:draft"]),
  seller: Object.freeze(["profile:read", "notifications:read", "catalog:read", "orders:read", "sales:read", "revenue:read", "listings:draft"]),
  admin: Object.freeze(["profile:read", "notifications:read", "platform:read", "sellers:read", "support:read", "promotions:read"]),
});

const requireConfig = (value, name) => {
  if (!value) throw new Error(`${name} is required`);
  return value;
};

export const createKeycloakAdmin = ({
  origin = process.env.KEYCLOAK_ADMIN_ORIGIN,
  issuer = process.env.MCP_OAUTH_ISSUER,
  clientId = process.env.KEYCLOAK_SYNC_CLIENT_ID,
  clientSecret = process.env.KEYCLOAK_SYNC_CLIENT_SECRET,
  redirectUris = (process.env.MCP_CLIENT_REDIRECT_URIS ?? "").split(",").map((value) => value.trim()).filter(Boolean),
  fetchImpl = fetch,
} = {}) => {
  const base = new URL(requireConfig(origin, "KEYCLOAK_ADMIN_ORIGIN"));
  const publicIssuer = requireConfig(issuer, "MCP_OAUTH_ISSUER");
  requireConfig(clientId, "KEYCLOAK_SYNC_CLIENT_ID");
  requireConfig(clientSecret, "KEYCLOAK_SYNC_CLIENT_SECRET");
  let cachedToken = null;
  let tokenExpiresAt = 0;

  const serviceToken = async () => {
    if (cachedToken && tokenExpiresAt > Date.now() + 10_000) return cachedToken;
    const response = await fetchImpl(new URL(`/realms/${REALM}/protocol/openid-connect/token`, base), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error("Keycloak account service is unavailable");
    const body = await response.json();
    cachedToken = body.access_token;
    tokenExpiresAt = Date.now() + Math.min(Number(body.expires_in) || 60, 300) * 1000;
    return cachedToken;
  };

  const request = async (path, init = {}) => {
    const token = await serviceToken();
    const response = await fetchImpl(new URL(path, base), {
      ...init,
      headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error("Keycloak account operation failed");
    return response;
  };

  const findUser = async (shopsphereUserId) => {
    const response = await request(`/admin/realms/${REALM}/users?username=${encodeURIComponent(shopsphereUserId)}&exact=true`);
    const users = await response.json();
    return users.find((user) => user.username === shopsphereUserId) ?? null;
  };

  const ensureUser = async (user, password) => {
    let linked = await findUser(user.id);
    const representation = {
      username: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      enabled: true,
      emailVerified: true,
      attributes: {
        shopsphere_user_id: [user.id],
        shopsphere_role: [user.role],
        shopsphere_verified: [String(Boolean(user.isVerified))],
      },
    };
    if (!linked) {
      await request(`/admin/realms/${REALM}/users`, { method: "POST", body: JSON.stringify(representation) });
      linked = await findUser(user.id);
    } else {
      await request(`/admin/realms/${REALM}/users/${linked.id}`, { method: "PUT", body: JSON.stringify(representation) });
    }
    if (!linked) throw new Error("Keycloak account link was not created");
    await request(`/admin/realms/${REALM}/users/${linked.id}/reset-password`, {
      method: "PUT",
      body: JSON.stringify({ type: "password", value: password, temporary: false }),
    });
    return linked.id;
  };

  const clientRepresentation = async (requestedClientId) => {
    const response = await request(`/admin/realms/${REALM}/clients?clientId=${encodeURIComponent(requestedClientId)}`);
    const clients = await response.json();
    return clients.find((client) => client.clientId === requestedClientId) ?? null;
  };

  const listConnections = async (shopsphereUserId) => {
    const user = await findUser(shopsphereUserId);
    if (!user) return [];
    const response = await request(`/admin/realms/${REALM}/users/${user.id}/consents`);
    const consents = await response.json();
    const connections = [];
    for (const configured of Object.values(AI_CLIENTS)) {
      const client = await clientRepresentation(configured.id);
      const consent = client && consents.find((candidate) => candidate.clientId === client.id);
      if (consent) connections.push({
        id: configured.id,
        clientId: configured.id,
        clientName: configured.name,
        scopes: (consent.grantedClientScopes ?? []).filter((scope) =>
          Object.values(ROLE_SCOPES).some((allowed) => allowed.includes(scope))),
        retentionNotice: configured.retentionNotice,
      });
    }
    return connections;
  };

  const revokeConnection = async (shopsphereUserId, requestedClientId) => {
    const user = await findUser(shopsphereUserId);
    const client = AI_CLIENTS[requestedClientId] && await clientRepresentation(requestedClientId);
    if (!user || !client) return false;
    const connections = await listConnections(shopsphereUserId);
    if (!connections.some((connection) => connection.clientId === requestedClientId)) return false;
    await request(`/admin/realms/${REALM}/users/${user.id}/consents/${client.id}`, { method: "DELETE" });
    await request(`/admin/realms/${REALM}/users/${user.id}/logout`, { method: "POST" });
    return true;
  };

  const authorizationUrl = ({ clientId: requestedClient, redirectUri, scopes, codeChallenge, state, loginHint }) => {
    if (!AI_CLIENTS[requestedClient] || !redirectUris.includes(redirectUri)) throw new Error("Unapproved OAuth client or redirect URI");
    const url = new URL(`${publicIssuer}/protocol/openid-connect/auth`);
    url.search = new URLSearchParams({
      client_id: requestedClient,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: ["openid", "shopsphere-identity", ...scopes].join(" "),
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
      login_hint: loginHint,
    }).toString();
    return url.toString();
  };

  return Object.freeze({ ensureUser, listConnections, revokeConnection, authorizationUrl });
};
