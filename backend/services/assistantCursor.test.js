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

const applicationCodec = createCursorCodec({ operation: "sellers.listApplications", confidential: true });
const applicationPrincipal = { subject: "admin-account", role: "admin", clientId: "client-1", grantId: "grant-1" };
const applicationRow = { id: "private-seller-account-id", createdAt: row.createdAt };

test("confidential application cursors conceal account positions and use fresh nonces", () => {
  const first = applicationCodec.encode(applicationRow, applicationPrincipal, query, SECRET);
  const second = applicationCodec.encode(applicationRow, applicationPrincipal, query, SECRET);
  assert.notEqual(first, second);
  assert.equal(applicationCodec.decode(first, applicationPrincipal, query, SECRET).id, applicationRow.id);
  const publicBytes = Buffer.from(first.split(".")[1], "base64url");
  assert.equal(publicBytes.includes(Buffer.from(applicationRow.id)), false);
  assert.throws(() => JSON.parse(publicBytes.toString("utf8")));
});

test("confidential application cursors reject tampering, old plaintext and every binding mismatch", () => {
  const cursor = applicationCodec.encode(applicationRow, applicationPrincipal, query, SECRET);
  for (const mismatch of [
    { ...applicationPrincipal, subject: "another-admin" },
    { ...applicationPrincipal, role: "user" },
    { ...applicationPrincipal, clientId: "another-client" },
    { ...applicationPrincipal, grantId: "another-grant" },
  ]) assert.throws(() => applicationCodec.decode(cursor, mismatch, query, SECRET), { statusCode: 404 });
  assert.throws(() => applicationCodec.decode(cursor, applicationPrincipal, { ...query, limit: 1 }, SECRET), { statusCode: 404 });
  const otherOperation = createCursorCodec({ operation: "other.operation", confidential: true });
  assert.throws(() => otherOperation.decode(cursor, applicationPrincipal, query, SECRET), { statusCode: 404 });
  assert.throws(() => applicationCodec.decode(cursor, applicationPrincipal, query, `${SECRET}rotated`), { statusCode: 404 });
  const packed = Buffer.from(cursor.split(".")[1], "base64url");
  packed[packed.length - 1] ^= 1;
  for (const malformed of [`c1.${packed.toString("base64url")}`, `${cursor}=`, `${cursor}.`, `${cursor}..`, "c1.AAA", "c1."]) {
    assert.throws(() => applicationCodec.decode(malformed, applicationPrincipal, query, SECRET), { statusCode: 404 });
  }
  const oldCodec = createCursorCodec({ operation: "sellers.listApplications" });
  const old = oldCodec.encode(applicationRow, applicationPrincipal, query, SECRET);
  assert.throws(() => applicationCodec.decode(old, applicationPrincipal, query, SECRET), { statusCode: 404 });
  assert.throws(() => applicationCodec.decode(cursor, applicationPrincipal, query, "short"), { statusCode: 503 });
});
