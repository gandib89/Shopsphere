// Route-scoped draft rate limits for issue #19 (support.draftMessage).
// Self-contained on purpose: this file is owned by the support-draft route and
// does not modify the shared enforceAssistantDistributedLimit middleware or any
// other tool's limiter. Fixed-window counters in Redis, keyed per subject+client:
//   10 drafts / minute and 100 drafts / day.
// Fails closed: any Redis unavailability is a 503 limit_unavailable, and an
// exceeded window is a 429 rate_limited with a retry-after hint.
import crypto from "node:crypto";

import { getAssistantRedis } from "./assistantRedis.js";

export const DRAFT_LIMITS_PER_MINUTE = 10;
export const DRAFT_LIMITS_PER_DAY = 100;

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;
// Buckets are part of the key, so the TTL is only cleanup slack.
const TTL_SLACK_MS = 1_000;

const INCR_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
if current > tonumber(ARGV[2]) then return {0, redis.call('PTTL', KEYS[1])} end
return {1, redis.call('PTTL', KEYS[1])}
`;

const hash = (value) => crypto.createHash("sha256").update(String(value ?? "unknown")).digest("base64url");

const consume = async (redis, key, windowMs, limit) => {
  const [allowed, ttl] = await redis.eval(INCR_LUA, {
    keys: [key],
    arguments: [String(windowMs + TTL_SLACK_MS), String(limit)],
  });
  return { allowed: Number(allowed) === 1, retryAfterMs: Math.max(TTL_SLACK_MS, Number(ttl) || TTL_SLACK_MS) };
};

export const createDraftSupportLimit = ({ redis = null, now = () => Date.now() } = {}) =>
  async (req, res, next) => {
    let store = redis;
    try {
      store ??= await getAssistantRedis();
      if (!store?.isReady) throw new Error("Draft limit state is not ready");
    } catch {
      return res.status(503).json({ code: "limit_unavailable", message: "Draft limit state is unavailable" });
    }
    const subject = req.delegation?.sub;
    const clientId = req.delegation?.clientId;
    const at = now();
    const minuteKey = `shopsphere:assistant:draft-limit:minute:${hash(`${subject}:${clientId}`)}:${Math.floor(at / MINUTE_MS)}`;
    const dayKey = `shopsphere:assistant:draft-limit:day:${hash(`${subject}:${clientId}`)}:${Math.floor(at / DAY_MS)}`;
    try {
      const minute = await consume(store, minuteKey, MINUTE_MS, DRAFT_LIMITS_PER_MINUTE);
      if (!minute.allowed) {
        res.set("retry-after", String(Math.max(1, Math.ceil(minute.retryAfterMs / 1000))));
        return res.status(429).json({ code: "rate_limited", message: "Draft rate limit exceeded" });
      }
      const day = await consume(store, dayKey, DAY_MS, DRAFT_LIMITS_PER_DAY);
      if (!day.allowed) {
        res.set("retry-after", String(Math.max(1, Math.ceil(day.retryAfterMs / 1000))));
        return res.status(429).json({ code: "rate_limited", message: "Draft rate limit exceeded" });
      }
      return next();
    } catch {
      return res.status(503).json({ code: "limit_unavailable", message: "Draft limit state is unavailable" });
    }
  };
