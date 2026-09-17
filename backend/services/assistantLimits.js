import crypto from "node:crypto";

const LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
if current > tonumber(ARGV[2]) then return {0, redis.call('PTTL', KEYS[1])} end
return {1, redis.call('PTTL', KEYS[1])}
`;
const ACQUIRE_LUA = `
for i, key in ipairs(KEYS) do
  local current = redis.call('INCR', key)
  if current == 1 then redis.call('PEXPIRE', key, ARGV[1]) end
  if current > tonumber(ARGV[2]) then
    redis.call('DECR', key)
    for j = 1, i - 1 do redis.call('DECR', KEYS[j]) end
    return 0
  end
end
return 1
`;
const RELEASE_LUA = `
for i, key in ipairs(KEYS) do
  local current = tonumber(redis.call('GET', key) or '0')
  if current <= 1 then redis.call('DEL', key) else redis.call('DECR', key) end
end
return 1
`;

const keyPart = (value) => crypto.createHash("sha256").update(String(value || "unknown")).digest("base64url");

export const createAssistantLimitStore = ({ redis, prefix = "shopsphere:assistant", windowMs = 60_000 } = {}) => ({
  async consume({ subject, clientId, role, sellerId, ip, platform = "all", limit = 60 }) {
    if (!redis?.isReady) throw Object.assign(new Error("Distributed limit state unavailable"), { statusCode: 503 });
    const dimensions = [
      ["subject-client", `${subject}:${clientId}`],
      ["client", clientId],
      ["role", role],
      ["ip", ip],
      ["platform", platform],
      ...(sellerId ? [["seller", sellerId]] : []),
    ];
    let retryAfterMs = 0;
    for (const [dimension, value] of dimensions) {
      const key = `${prefix}:rate:${dimension}:${keyPart(value)}`;
      const [allowed, ttl] = await redis.eval(LUA, { keys: [key], arguments: [String(windowMs), String(limit)] });
      retryAfterMs = Math.max(retryAfterMs, Number(ttl) || 0);
      if (Number(allowed) !== 1) return { allowed: false, retryAfterMs };
    }
    return { allowed: true, retryAfterMs };
  },
  async acquire({ subject, clientId, maxConcurrency = 4 }) {
    if (!redis?.isReady) throw Object.assign(new Error("Distributed limit state unavailable"), { statusCode: 503 });
    const keys = [
      `${prefix}:concurrency:subject-client:${keyPart(`${subject}:${clientId}`)}`,
      `${prefix}:concurrency:platform:all`,
    ];
    const allowed = await redis.eval(ACQUIRE_LUA, { keys, arguments: ["15000", String(maxConcurrency)] });
    if (Number(allowed) !== 1) return { allowed: false };
    return { allowed: true, release: () => redis.eval(RELEASE_LUA, { keys, arguments: [] }) };
  },
});
