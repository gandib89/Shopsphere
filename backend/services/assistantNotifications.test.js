import assert from "node:assert/strict";
import test from "node:test";

import { listMyNotifications } from "./assistantNotifications.js";

const secret = "cursor-test-secret-that-is-at-least-thirty-two-bytes";
const row = (id, subject, createdAt) => ({
  id,
  userId: subject,
  type: "order",
  title: "Order update",
  message: "Ready",
  read: false,
  productId: null,
  productName: null,
  createdAt: new Date(createdAt),
});

const principal = (subject) => ({ subject, role: "user", clientId: "client-1", grantId: "grant-1" });

test("notification pages are bounded, minimized, and cursor-bound to the principal", async () => {
  const rows = [
    row("bbbbbbbbbbbbbbbbbbbbbbbb", "aaaaaaaaaaaaaaaaaaaaaaaa", "2026-09-15T02:00:00Z"),
    row("aaaaaaaaaaaaaaaaaaaaaaaa", "aaaaaaaaaaaaaaaaaaaaaaaa", "2026-09-15T01:00:00Z"),
  ];
  const calls = [];
  const client = { notification: { findMany: async (query) => { calls.push(query); return rows; } } };
  const first = await listMyNotifications({ limit: 1 }, {
    client,
    principal: principal("aaaaaaaaaaaaaaaaaaaaaaaa"),
    cursorSecret: secret,
  });
  assert.equal(first.notifications.length, 1);
  assert.deepEqual(Object.keys(first.notifications[0]), ["id", "type", "title", "message", "read", "productId", "productName", "createdAt"]);
  assert.equal(calls[0].where.userId, "aaaaaaaaaaaaaaaaaaaaaaaa");
  assert.ok(first.nextCursor);

  await assert.rejects(
    listMyNotifications({ cursor: first.nextCursor, limit: 1 }, {
      client,
      principal: principal("cccccccccccccccccccccccc"),
      cursorSecret: secret,
    }),
    { statusCode: 404, code: "not_found" },
  );
});
test("notification cursor state fails closed when its signing dependency is unavailable", async () => {
  await assert.rejects(
    listMyNotifications({ cursor: "opaque", limit: 1 }, {
      client: { notification: { findMany: async () => [] } },
      principal: principal("aaaaaaaaaaaaaaaaaaaaaaaa"),
    }),
    { statusCode: 503 },
  );
});
