import assert from "node:assert/strict";
import test from "node:test";

import { createPrincipalSessionStore } from "../src/redisControls.js";

test("session cache keys and values do not expose raw principals and reject foreign principals", async () => {
  const strings = new Map();
  const sets = new Map();
  const redis = {
    isReady: true,
    async set(key, value) { strings.set(key, value); },
    async get(key) { return strings.get(key) || null; },
    async expire() {},
    async zAdd(key, { value }) { const entries = sets.get(key) || []; entries.push(value); sets.set(key, entries); },
    async zRange() { return []; },
    async zRem() {},
    async del(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) strings.delete(key); },
  };
  const store = createPrincipalSessionStore({ redis });
  const owner = { sub: "owner-secret", clientId: "client-secret", role: "user", grantId: "grant-secret" };
  const session = await store.create(owner);
  assert.equal(await store.validate(session, owner), true);
  assert.equal(await store.validate(session, { ...owner, sub: "foreign-secret" }), false);
  const storedText = JSON.stringify([...strings, ...sets]);
  assert.equal(storedText.includes("owner-secret"), false);
  assert.equal(storedText.includes("client-secret"), false);
  assert.equal(storedText.includes("grant-secret"), false);
  assert.equal(storedText.includes(session), false);
});

