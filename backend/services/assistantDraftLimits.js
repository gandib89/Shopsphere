// All draft tools share one subject budget. Client, grant, role, and tool
// rotation cannot reset it; general client/IP/platform ceilings also apply.
import crypto from "node:crypto";
import { getAssistantRedis } from "./assistantRedis.js";
import { auditContext, recordAssistantAudit } from "./assistantAudit.js";

export const DRAFT_LIMITS_PER_MINUTE = 10;
export const DRAFT_LIMITS_PER_DAY = 100;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const CONSUME_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
if current > tonumber(ARGV[2]) then return {0, redis.call('PTTL', KEYS[1])} end
return {1, redis.call('PTTL', KEYS[1])}
`;

export const consumeDraftLimit = async (
  redis,
  { subject, now = Date.now(), prefix = "shopsphere:assistant:draft-limit" } = {},
) => {
  if (!redis?.isReady || typeof subject !== "string" || !subject) {
    throw Object.assign(new Error("Draft limit state unavailable"), { statusCode: 503 });
  }
  const digest = crypto.createHash("sha256").update(subject).digest("base64url");
  for (const [name, windowMs, limit] of [
    ["minute", MINUTE_MS, DRAFT_LIMITS_PER_MINUTE],
    ["day", DAY_MS, DRAFT_LIMITS_PER_DAY],
  ]) {
    const [allowed, ttl] = await redis.eval(CONSUME_LUA, {
      keys: [`${prefix}:${name}:${digest}:${Math.floor(now / windowMs)}`],
      arguments: [String(windowMs + 1_000), String(limit)],
    });
    const retryAfterMs = Math.max(1_000, Number(ttl) || 1_000);
    if (Number(allowed) !== 1) return { allowed: false, retryAfterMs };
  }
  return { allowed: true };
};

export const createDraftLimit = ({ redis = null, now = () => Date.now(), audit = recordAssistantAudit } = {}) =>
  async (req, res, next) => {
    const deny = async (status, code, message) => {
      if (req.requestId) {
        try {
          await audit(auditContext(req, {
            operation: req.assistantOperation ?? "draft.limit",
            authorizationOutcome: "denied", outcome: code, failureReason: code,
            input: {}, latencyMs: 0,
          }));
        } catch {
          return res.status(503).json({ code: "audit_unavailable", message: "Audit service is unavailable" });
        }
      }
      return res.status(status).json({ code, message });
    };
    try {
      const store = redis ?? await getAssistantRedis();
      const result = await consumeDraftLimit(store, { subject: req.delegation?.sub, now: now() });
      if (!result.allowed) {
        res.set("retry-after", String(Math.max(1, Math.ceil(result.retryAfterMs / 1_000))));
        return deny(429, "rate_limited", "Draft rate limit exceeded");
      }
      return next();
    } catch {
      return deny(503, "limit_unavailable", "Draft limit state is unavailable");
    }
  };
