import crypto from "node:crypto";

import { prisma } from "../database/prismaClient.js";
import { assistantPrisma } from "../database/assistantPrisma.js";
import { withAssistantActor } from "../database/assistantTransaction.js";
import { isDelegatedTokenShape, verifyDelegatedToken } from "../utils/mcpOAuth.js";

const bearer = (req) => {
  const header = req.headers?.authorization ?? req.get?.("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
};

// Verifies the audience-separated delegated token family only. Never falls
// back to the legacy browser JWT: a delegated failure is a denial, and a
// browser/MCP-audience token here is a denial too.
export const authenticateAssistantDelegation = async (req, res, next, verify = verifyDelegatedToken) => {
  const token = bearer(req);
  if (!token) {
    return res.status(401).json({ code: "invalid_token", message: "No delegated token provided" });
  }
  try {
    const claims = await verify(token);
    req.delegation = {
      sub: claims.sub,
      clientId: claims.client_id,
      grantId: claims.grant_id,
      scopes: claims.scopes,
      role: claims.role,
      verified: claims.verified,
      workload: claims.azp,
    };
    return next();
  } catch (error) {
    const status = error?.status === 403 ? 403 : 401;
    return res.status(status).json({ code: error?.code ?? "invalid_token", message: "Invalid delegated credential" });
  }
};

// Global-restriction seam (wired to non-assistant routes in a later phase):
// a valid delegated token is never valid outside /api/v1/assistant/*.
export const rejectDelegatedTokens = async (req, res, next, verify = verifyDelegatedToken) => {
  const token = bearer(req);
  if (!token || !isDelegatedTokenShape(token)) return next();
  try {
    await verify(token);
  } catch {
    // Token-like delegated credentials fail closed on non-assistant routes too.
  }
  return res.status(403).json({ code: "delegated_not_allowed", message: "Delegated tokens are assistant-only" });
};

const safeEqual = (left, right) => {
  const a = Buffer.from(left || "");
  const b = Buffer.from(right || "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

export const authenticateAssistantWorkload = (req, res, next) => {
  const expected = process.env.ASSISTANT_API_TOKEN;
  if (!expected || !safeEqual(req.get?.("x-assistant-api-token"), expected)) {
    return res.status(401).json({ code: "invalid_workload", message: "Invalid assistant workload" });
  }
  return next();
};

export const validateAssistantAccess = async (
  req,
  { roles = ["user", "seller", "admin"], scope, rolloutFlag } = {},
  client = prisma,
) => {
  if (rolloutFlag && process.env[rolloutFlag] !== "true") {
    return { status: 404, code: "not_available" };
  }
  if (scope && !req.delegation.scopes.includes(scope)) {
    return { status: 403, code: "insufficient_scope" };
  }
  const account = await client.user.findUnique({
    where: { id: req.delegation.sub },
    select: { id: true, firstName: true, lastName: true, role: true, isVerified: true },
  });
  if (!account) return { status: 401, code: "inactive_account" };
  if (account.role !== req.delegation.role || Boolean(account.isVerified) !== req.delegation.verified) {
    return { status: 403, code: "stale_identity" };
  }
  if (!roles.includes(account.role)) return { status: 403, code: "role_not_allowed" };
  return { account };
};

export const authorizeAssistantOperation = (policy = {}, client = assistantPrisma) => async (req, res, next) => {
  try {
    const result = await withAssistantActor({
      actorId: req.delegation.sub,
      role: req.delegation.role,
      operation: policy.operation ?? "authorization.resolve",
      signal: req.signal,
    }, (tx) => validateAssistantAccess(req, policy, tx), client);
    if (!result.account) {
      return res.status(result.status).json({ code: result.code, message: "Assistant operation is not available" });
    }
    req.assistantAccount = result.account;
    return next();
  } catch {
    return res.status(503).json({ code: "account_check_unavailable", message: "Account check is unavailable" });
  }
};
