import assert from "node:assert/strict";
import test from "node:test";

import { createCursorCodec } from "./assistantCursor.js";

const SECRET = "shared-codec-secret-that-is-at-least-thirty-two-bytes!!";
const codec = createCursorCodec({ operation: "orders.listMine" });
const other = createCursorCodec({ operation: "products.listMine" });
const principal = (subject) => ({ subject, role: "user", clientId: "client-1", grantId: "grant-1" });
const row = { id: "ord-1", createdAt: new Date("2026-09-01T10:00:00Z") };
const query = { status: null, limit: 20 };

test("shared cursor codec round-trips and binds principal, query, and operation", () => {
  const cursor = codec.encode(row, principal("aaaaaaaaaaaaaaaaaaaaaaaa"), query, SECRET);
  const payload = codec.decode(cursor, principal("aaaaaaaaaaaaaaaaaaaaaaaa"), query, SECRET);
  assert.equal(payload.id, "ord-1");
  assert.equal(codec.decode(null, principal("aaaaaaaaaaaaaaaaaaaaaaaa"), query, SECRET), null);
});

test("shared cursor codec rejects cross-principal, cross-query, and cross-operation replay", () => {
  const cursor = codec.encode(row, principal("aaaaaaaaaaaaaaaaaaaaaaaa"), query, SECRET);
  assert.throws(
    () => codec.decode(cursor, principal("bbbbbbbbbbbbbbbbbbbbbbbb"), query, SECRET),
    { statusCode: 404 },
  );
  assert.throws(
    () => codec.decode(cursor, principal("aaaaaaaaaaaaaaaaaaaaaaaa"), { ...query, limit: 50 }, SECRET),
    { statusCode: 404 },
  );
  assert.throws(
    () => other.decode(cursor, principal("aaaaaaaaaaaaaaaaaaaaaaaa"), query, SECRET),
    { statusCode: 404 },
  );
  assert.throws(() => codec.decode("opaque", principal("aaaaaaaaaaaaaaaaaaaaaaaa"), query, SECRET), { statusCode: 404 });
});

test("shared cursor codec fails closed without its signing secret", () => {
  assert.throws(
    () => codec.encode(row, principal("aaaaaaaaaaaaaaaaaaaaaaaa"), query, "short"),
    { statusCode: 503 },
  );
  assert.throws(
    () => codec.decode("anything.at.all", principal("aaaaaaaaaaaaaaaaaaaaaaaa"), query, undefined),
    { statusCode: 503 },
  );
});
