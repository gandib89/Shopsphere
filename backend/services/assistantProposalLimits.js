// Proposal-class rate limits for #22, scoped to the propose_cart_change route
// (the shared enforceAssistantDistributedLimit is left untouched). Three caps:
//   - 5 proposals per subject+client per minute
//   - 50 proposals per subject+client per day
//   - at most 10 pending proposals per subject at any time
// Redis unavailability fails closed with 503 limit_unavailable; exceeded caps
// answer 429 rate_limited. Every denial is durably audited like the other
// assistant denials.
import crypto from "node:crypto";

import { assistantPrisma } from "../database/assistantPrisma.js";
import { withAssistantActor } from "../database/assistantTransaction.js";
import { getAssistantRedis } from "./assistantRedis.js";
import { auditContext, recordAssistantAudit } from "./assistantAudit.js";

export const PROPOSALS_PER_MINUTE = 5;
export const PROPOSALS_PER_DAY = 50;
export const MAX_PENDING_PROPOSALS = 10;

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

const LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
if current > tonumber(ARGV[2]) then return {0, redis.call('PTTL', KEYS[1])} end
return {1, redis.call('PTTL', KEYS[1])}
`;

const keyPart = (value) => crypto.createHash("sha256").update(String(value || "unknown")).digest("base64url");

export const createProposalLimitStore = ({ redis, prefix = "shopsphere:proposal" } = {}) => ({
  async consume({ subject, clientId }) {
    if (!redis?.isReady) {
      throw Object.assign(new Error("Proposal limit state unavailable"), { statusCode: 503 });
    }
    const windows = [
      { key: `${prefix}:rate:minute:${keyPart(`${subject}:${clientId}`)}`, windowMs: MINUTE_MS, limit: PROPOSALS_PER_MINUTE },
      { key: `${prefix}:rate:day:${keyPart(`${subject}:${clientId}`)}`, windowMs: DAY_MS, limit: PROPOSALS_PER_DAY },
    ];
    for (const { key, windowMs, limit } of windows) {
      const [allowed] = await redis.eval(LUA, { keys: [key], arguments: [String(windowMs), String(limit)] });
      if (Number(allowed) !== 1) return { allowed: false };
    }
    return { allowed: true };
  },
});

const auditedLimitDenial = async (req, res, status, code, message, operation = "proposals.proposeCartChange") => {
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

// Pending-proposal headroom is a database count inside the actor context (the
// private runtime can SELECT only its own pending rows via RLS).
export const countPendingProposals = async ({ subjectId, role, signal }, client = assistantPrisma) =>
  withAssistantActor({
    actorId: subjectId,
    role,
    operation: "proposals.proposeCartChange",
    signal,
  }, (tx) => tx.proposal.count({
    where: { subjectId, status: "pending", expiresAt: { gt: new Date() } },
  }), client);

export const enforceProposalCreationLimits = ({
  redisLoader = getAssistantRedis,
  storeFactory = createProposalLimitStore,
  client = assistantPrisma,
} = {}) => async (req, res, next) => {
  try {
    const store = storeFactory({ redis: await redisLoader() });
    const result = await store.consume({ subject: req.delegation.sub, clientId: req.delegation.clientId });
    if (!result.allowed) {
      res.set("retry-after", "60");
      return auditedLimitDenial(req, res, 429, "rate_limited", "Proposal rate limit exceeded");
    }
  } catch {
    return auditedLimitDenial(req, res, 503, "limit_unavailable", "Proposal limit state is unavailable");
  }
  try {
    const pending = await countPendingProposals(
      { subjectId: req.delegation.sub, role: req.delegation.role, signal: req.assistantSignal },
      client,
    );
    if (pending >= MAX_PENDING_PROPOSALS) {
      res.set("retry-after", "60");
      return auditedLimitDenial(req, res, 429, "rate_limited", "Pending proposal limit exceeded");
    }
    return next();
  } catch {
    return auditedLimitDenial(req, res, 503, "limit_unavailable", "Proposal limit state is unavailable");
  }
};
