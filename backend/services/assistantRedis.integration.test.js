import assert from "node:assert/strict";
import test from "node:test";

import { createClient } from "redis";

import { createAssistantLimitStore } from "./assistantLimits.js";

const enabled = process.env.RUN_REDIS_INTEGRATION === "true";

test("Redis shares rate and concurrency limits across assistant replicas", { skip: !enabled }, async (t) => {
  const firstClient = createClient({ url: process.env.REDIS_URL });
  const secondClient = firstClient.duplicate();
  await Promise.all([firstClient.connect(), secondClient.connect()]);

  const prefix = `shopsphere:test:assistant:${process.pid}:${Date.now()}`;
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

  const firstReplica = createAssistantLimitStore({ redis: firstClient, prefix });
  const secondReplica = createAssistantLimitStore({ redis: secondClient, prefix });
  const principal = {
    subject: "buyer-live-redis",
    clientId: "approved-client",
    role: "user",
    ip: "192.0.2.10",
    limit: 1,
  };

  assert.equal((await firstReplica.consume(principal)).allowed, true);
  assert.equal((await secondReplica.consume(principal)).allowed, false);

  const firstLease = await firstReplica.acquire({ ...principal, maxConcurrency: 1 });
  assert.equal(firstLease.allowed, true);
  assert.equal((await secondReplica.acquire({ ...principal, maxConcurrency: 1 })).allowed, false);
  await firstLease.release();

  const secondLease = await secondReplica.acquire({ ...principal, maxConcurrency: 1 });
  assert.equal(secondLease.allowed, true);
  await secondLease.release();
});
