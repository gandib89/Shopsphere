import { z } from "zod";

import { prisma } from "../database/prismaClient.js";
import { verifyPassword } from "../utils/password.js";
import { AI_CLIENTS, ROLE_SCOPES, createKeycloakAdmin } from "../services/keycloakAdmin.js";

const linkSchema = z.object({
  clientId: z.enum(Object.keys(AI_CLIENTS)),
  redirectUri: z.string().url().max(500),
  scopes: z.array(z.string().min(1).max(100)).min(1).max(20),
  codeChallenge: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
  state: z.string().regex(/^[A-Za-z0-9_-]{16,256}$/),
  currentPassword: z.string().min(1).max(200),
}).strict();

export const getConnectionCatalog = async (req, res) => {
  res.json({
    clients: Object.values(AI_CLIENTS).map((client) => ({
      id: client.id,
      name: client.name,
      role: req.user.role,
      availableScopes: ROLE_SCOPES[req.user.role] ?? [],
      retentionNotice: client.retentionNotice,
    })),
  });
};

export const beginConnection = async (req, res, client = prisma, keycloak = createKeycloakAdmin()) => {
  const parsed = linkSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ code: "invalid_input", message: "Invalid connection request" });
  const user = await client.user.findUnique({ where: { id: req.user.id } });
  if (!user || !user.password || !(await verifyPassword(user.password, parsed.data.currentPassword))) {
    return res.status(403).json({ code: "invalid_credentials", message: "Current password is incorrect" });
  }
  const allowedScopes = ROLE_SCOPES[user.role] ?? [];
  const scopes = [...new Set(parsed.data.scopes)];
  if (scopes.some((scope) => !allowedScopes.includes(scope))) {
    return res.status(403).json({ code: "invalid_scope", message: "A selected scope is not available for this role" });
  }
  try {
    await keycloak.ensureUser(user, parsed.data.currentPassword);
    return res.json({ authorizationUrl: keycloak.authorizationUrl({
      clientId: parsed.data.clientId,
      redirectUri: parsed.data.redirectUri,
      scopes,
      codeChallenge: parsed.data.codeChallenge,
      state: parsed.data.state,
      loginHint: user.id,
    }) });
  } catch {
    return res.status(503).json({ code: "connection_service_unavailable", message: "AI connection service is unavailable" });
  }
};

export const listConnections = async (req, res, keycloak = createKeycloakAdmin()) => {
  try {
    return res.json({ connections: await keycloak.listConnections(req.user.id) });
  } catch {
    return res.status(503).json({ code: "connection_service_unavailable", message: "AI connection service is unavailable" });
  }
};

export const revokeConnection = async (req, res, keycloak = createKeycloakAdmin()) => {
  if (!AI_CLIENTS[req.params.clientId]) return res.status(404).json({ code: "not_found", message: "Connection not found" });
  try {
    const revoked = await keycloak.revokeConnection(req.user.id, req.params.clientId);
    if (!revoked) return res.status(404).json({ code: "not_found", message: "Connection not found" });
    return res.status(204).send();
  } catch {
    return res.status(503).json({ code: "connection_service_unavailable", message: "AI connection service is unavailable" });
  }
};
