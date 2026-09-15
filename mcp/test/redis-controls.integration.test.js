import assert from "node:assert/strict";
import test from "node:test";

import { createClient } from "redis";

import { createPrincipalSessionStore } from "../src/redisControls.js";

const enabled = process.env.RUN_REDIS_INTEGRATION === "true";

test("Redis shares principal-bound sessions across MCP replicas", { skip: !enabled }, async (t) => {
  const firstClient = createClient({ url: process.env.REDIS_URL });
  const secondClient = firstClient.duplicate();
  await Promise.all([firstClient.connect(), secondClient.connect()]);

  const prefix = `shopsphere:test:mcp:${process.pid}:${Date.now()}`;
  t.after(async () => {
    try {
      const keys = [];
      for await (const batch of firstClient.scanIterator({ MATCH: `${prefix}:*` })) {
        keys.push(...(Array.isArray(batch) ? batch : [batch]));
      }
      if (keys.length) await firstClient.del(keys);
    } finally {
      await Promise.all([firstClient.quit(), secondClient.quit()]);
    }
  });

  const firstReplica = createPrincipalSessionStore({ redis: firstClient, prefix });
  const secondReplica = createPrincipalSessionStore({ redis: secondClient, prefix });
  const owner = {
    sub: "buyer-live-redis",
    clientId: "approved-client",
    role: "user",
    grantId: "grant-live-redis",
  };

  const sessionId = await firstReplica.create(owner);
  assert.equal(await secondReplica.validate(sessionId, owner), true);
  assert.equal(await secondReplica.validate(sessionId, { ...owner, sub: "foreign-buyer" }), false);

  await secondReplica.destroy(sessionId);
  assert.equal(await firstReplica.validate(sessionId, owner), false);
});
