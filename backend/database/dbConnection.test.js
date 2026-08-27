import assert from "node:assert/strict";
import test from "node:test";

import { initializeDatabase } from "./dbConnection.js";

test("waits for connection and default admin but skips demo data unless enabled", async () => {
  const calls = [];
  const client = { $connect: async () => calls.push("connect") };

  await initializeDatabase({
    client,
    demoEnabled: false,
    seedDefaultAdmin: async () => calls.push("admin"),
    seedDemo: async () => calls.push("demo"),
  });

  assert.deepEqual(calls, ["connect", "admin"]);
});

test("waits for demo data when explicitly enabled", async () => {
  const calls = [];
  const client = { $connect: async () => calls.push("connect") };

  await initializeDatabase({
    client,
    demoEnabled: true,
    seedDefaultAdmin: async () => calls.push("admin"),
    seedDemo: async () => {
      await Promise.resolve();
      calls.push("demo");
      return { usersCreated: 4, usersExisting: 0, productsCreated: 12, productsExisting: 0 };
    },
  });

  assert.deepEqual(calls, ["connect", "admin", "demo"]);
});
