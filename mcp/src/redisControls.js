import crypto from "node:crypto";
import { createClient } from "redis";

const RATE_SCRIPT = `
for i, key in ipairs(KEYS) do
  local current = redis.call('INCR', key)
  if current == 1 then redis.call('PEXPIRE', key, ARGV[1]) end
  if current > tonumber(ARGV[2]) then return {0, redis.call('PTTL', key)} end
end
return {1, tonumber(ARGV[1])}
`;

const ACQUIRE_SCRIPT = `
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

const RELEASE_SCRIPT = `
for i, key in ipairs(KEYS) do
  local current = tonumber(redis.call('GET', key) or '0')
  if current <= 1 then redis.call('DEL', key) else redis.call('DECR', key) end
end
return 1
`;

const hash = (value) => crypto.createHash("sha256").update(String(value || "unknown")).digest("base64url");
const principalFingerprint = (auth) => hash(JSON.stringify({
  subject: auth?.sub,
  clientId: auth?.clientId,
  role: auth?.role,
  grantId: auth?.grantId,
}));

export const connectAssistantRedis = async (url) => {
  if (!url) throw new Error("REDIS_URL is required when MCP is enabled");
  const client = createClient({ url });
  client.on("error", () => {});
  await client.connect();
  return client;
};

export const createDistributedControls = ({ redis, prefix = "shopsphere:mcp", windowMs = 60_000, limit = 60, concurrency = 4 } = {}) => ({
  async enter({ auth, ip }) {
    if (!redis?.isReady) throw Object.assign(new Error("Distributed limits unavailable"), { statusCode: 503 });
    const subject = auth?.sub || "public";
    const clientId = auth?.clientId || "unknown";
    const keys = [
      `${prefix}:rate:subject-client:${hash(`${subject}:${clientId}`)}`,
      `${prefix}:rate:client:${hash(clientId)}`,
      `${prefix}:rate:role:${hash(auth?.role || "public")}`,
      `${prefix}:rate:ip:${hash(ip)}`,
      `${prefix}:rate:platform:all`,
      ...(auth?.role === "seller" ? [`${prefix}:rate:seller:${hash(subject)}`] : []),
    ];
    const [allowed, ttl] = await redis.eval(RATE_SCRIPT, { keys, arguments: [String(windowMs), String(limit)] });
    if (Number(allowed) !== 1) return { allowed: false, retryAfterMs: Number(ttl) || windowMs };
    const concurrencyKeys = [
      `${prefix}:concurrency:subject-client:${hash(`${subject}:${clientId}`)}`,
      `${prefix}:concurrency:platform:all`,
    ];
    const acquired = await redis.eval(ACQUIRE_SCRIPT, {
      keys: concurrencyKeys,
      arguments: ["15000", String(concurrency)],
    });
    if (Number(acquired) !== 1) return { allowed: false, busy: true, retryAfterMs: 1_000 };
    return {
      allowed: true,
      release: () => redis.eval(RELEASE_SCRIPT, { keys: concurrencyKeys, arguments: [] }),
    };
  },
});

export const createPrincipalSessionStore = ({ redis, prefix = "shopsphere:mcp", ttlSeconds = 900, maxPerPrincipal = 8 } = {}) => ({
  async create(auth) {
    if (!redis?.isReady) throw Object.assign(new Error("Session state unavailable"), { statusCode: 503 });
    const id = crypto.randomBytes(32).toString("base64url");
    const idKey = `${prefix}:session:${hash(id)}`;
    const principal = principalFingerprint(auth);
    const indexKey = `${prefix}:sessions:${principal}`;
    const now = Date.now();
    await redis.set(idKey, principal, { EX: ttlSeconds });
    await redis.zAdd(indexKey, { score: now, value: hash(id) });
    await redis.expire(indexKey, ttlSeconds);
    const excess = await redis.zRange(indexKey, 0, -(maxPerPrincipal + 1));
    if (excess.length) {
      await redis.del(excess.map((member) => `${prefix}:session:${member}`));
      await redis.zRem(indexKey, excess);
    }
    return id;
  },
  async validate(id, auth) {
    if (!redis?.isReady || !id || id.length > 100) return false;
    const key = `${prefix}:session:${hash(id)}`;
    const stored = await redis.get(key);
    const expected = principalFingerprint(auth);
    if (!stored || stored.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(stored), Buffer.from(expected))) return false;
    await redis.expire(key, ttlSeconds);
    return true;
  },
  async destroy(id) {
    if (id) await redis.del(`${prefix}:session:${hash(id)}`);
  },
});
