// Route-scoped draft rate limits for issue #20 (listing draft tools only).
// Deliberately separate from the shared enforceAssistantDistributedLimit:
// drafting is a heavier operationClass, so the four draft routes add this
// limiter in their own middleware chain — 10 drafts/minute and 100/day per
// subject+client. Fail-closed: unavailable Redis state is a 503, exactly like
// the shared limiter.
import crypto from "node:crypto";

import { getAssistantRedis } from "./assistantRedis.js";

const DRAFT_MINUTE_LIMIT = 10;
const DRAFT_DAY_LIMIT = 100;
const MINUTE_WINDOW_MS = 60_000;
const DAY_WINDOW_MS = 24 * 60 * 60 * 1000;

const CONSUME_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
if current > tonumber(ARGV[2]) then return {0, redis.call('PTTL', KEYS[1])} end
return {1, redis.call('PTTL', KEYS[1])}
`;

const keyPart = (value) => crypto.createHash("sha256").update(String(value || "unknown")).digest("base64url");

export const consumeListingDraftLimit = async (redis, { subject, clientId }) => {
  if (!redis?.isReady) {
    throw Object.assign(new Error("Draft limit state unavailable"), { statusCode: 503 });
  }
  const base = `shopsphere:assistant:rate:drafts:${keyPart(`${subject}:${clientId}`)}`;
  const windows = [
    [`${base}:day`, DAY_WINDOW_MS, DRAFT_DAY_LIMIT],
    [`${base}:minute`, MINUTE_WINDOW_MS, DRAFT_MINUTE_LIMIT],
  ];
  let retryAfterMs = 0;
  for (const [key, windowMs, limit] of windows) {
    const [allowed, ttl] = await redis.eval(CONSUME_LUA, {
      keys: [key],
      arguments: [String(windowMs), String(limit)],
    });
    retryAfterMs = Math.max(retryAfterMs, Number(ttl) || 0);
    if (Number(allowed) !== 1) return { allowed: false, retryAfterMs };
  }
  return { allowed: true, retryAfterMs };
};

export const enforceListingDraftLimit = () => async (req, res, next) => {
  try {
    const redis = await getAssistantRedis();
    const result = await consumeListingDraftLimit(redis, {
      subject: req.delegation?.sub,
      clientId: req.delegation?.clientId,
    });
    if (!result.allowed) {
      res.set("retry-after", String(Math.max(1, Math.ceil(result.retryAfterMs / 1_000))));
      return res.status(429).json({ code: "rate_limited", message: "Listing draft rate limit exceeded" });
    }
    return next();
  } catch {
    return res.status(503).json({ code: "limit_unavailable", message: "Distributed limit state is unavailable" });
  }
};
