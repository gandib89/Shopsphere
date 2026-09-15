import crypto from "node:crypto";

import { prisma } from "../database/prismaClient.js";
import { assistantPrisma } from "../database/assistantPrisma.js";
import { withAssistantActor } from "../database/assistantTransaction.js";
import { isDelegatedTokenShape, verifyDelegatedToken } from "../utils/mcpOAuth.js";
import { auditContext, recordAssistantAudit } from "../services/assistantAudit.js";
import { createAssistantLimitStore } from "../services/assistantLimits.js";
import { getAssistantRedis } from "../services/assistantRedis.js";

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
    return auditedDenial(req, res, 401, "invalid_token", "No delegated token provided");
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
    return auditedDenial(req, res, status, error?.code ?? "invalid_token", "Invalid delegated credential");
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

const auditedDenial = async (req, res, status, code, message, operation = "authorization.resolve") => {
  // Direct middleware unit tests do not install requestContext. Every real app
  // request has a trace id and therefore must use the durable fail-closed path.
  if (!req.requestId) return res.status(status).json({ code, message });
  try {
    await recordAssistantAudit(auditContext(req, {
      operation,
      authorizationOutcome: "denied",
      outcome: code,
      failureReason: code,
      latencyMs: 0,
    }));
  } catch {
    return res.status(503).json({ code: "audit_unavailable", message: "Audit service is unavailable" });
  }
  return res.status(status).json({ code, message });
};

export const authenticateAssistantWorkload = async (req, res, next) => {
  const expected = process.env.ASSISTANT_API_TOKEN;
  if (!expected || !safeEqual(req.get?.("x-assistant-api-token"), expected)) {
    return auditedDenial(req, res, 401, "invalid_workload", "Invalid assistant workload");
  }
  return next();
};

export const enforceAssistantDistributedLimit = () => async (req, res, next) => {
  try {
    const store = createAssistantLimitStore({ redis: await getAssistantRedis() });
    const result = await store.consume({
      subject: req.delegation.sub,
      clientId: req.delegation.clientId,
      role: req.delegation.role,
      sellerId: req.delegation.role === "seller" ? req.delegation.sub : null,
      ip: req.ip,
      limit: 60,
    });
    if (!result.allowed) {
      res.set("retry-after", String(Math.max(1, Math.ceil(result.retryAfterMs / 1_000))));
      return auditedDenial(req, res, 429, "rate_limited", "Assistant rate limit exceeded");
    }
    const lease = await store.acquire({
      subject: req.delegation.sub,
      clientId: req.delegation.clientId,
      maxConcurrency: 4,
    });
    if (!lease.allowed) {
      res.set("retry-after", "1");
      return auditedDenial(req, res, 503, "concurrency_limited", "Assistant service is busy");
    }
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      void lease.release().catch(() => {});
    };
    res.once("finish", release);
    res.once("close", release);
    return next();
  } catch {
    return auditedDenial(req, res, 503, "limit_unavailable", "Distributed limit state is unavailable");
  }
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
      return auditedDenial(req, res, result.status, result.code, "Assistant operation is not available", policy.operation);
    }
    req.assistantAccount = result.account;
    return next();
  } catch {
    return auditedDenial(req, res, 503, "account_check_unavailable", "Account check is unavailable", policy.operation);
  }
};
