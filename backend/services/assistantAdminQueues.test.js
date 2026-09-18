import assert from "node:assert/strict";
import test from "node:test";

import {
  EXCEPTION_STATUSES,
  REFUND_FAILED_STATUS,
  RETURN_STATUSES,
  getOrderExceptionDetail,
  listOrderExceptionQueue,
  listReturnQueue,
  orderExceptionDetailObserve,
} from "./assistantAdminQueues.js";

const ADMIN = "dddddddddddddddddddddddd";
const RIVAL_ADMIN = "eeeeeeeeeeeeeeeeeeeeeeee";
const BUYER = "cccccccccccccccccccccccc";
const SELLER = "bbbbbbbbbbbbbbbbbbbbbbbb";
const SECRET = "admin-queue-cursor-secret-with-32-bytes!!";
const principal = (subject = ADMIN) => ({ subject, role: "admin", clientId: "client-1", grantId: "grant-1" });
const now = new Date("2026-09-18T10:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

const queueRow = (overrides = {}) => ({
  id: "order-1",
  orderNumber: "SP-2026-0001",
  status: "Return Requested",
  createdAt: new Date("2026-09-10T10:00:00Z"),
  userId: BUYER,
  sellerIdAtPurchase: SELLER,
  returnRequestedAt: new Date("2026-09-12T10:00:00Z"),
  refundReleasedAt: null,
  confirmedAt: new Date("2026-09-10T11:00:00Z"),
  processingAt: new Date("2026-09-10T12:00:00Z"),
  shippedAt: null,
  deliveredAt: null,
  cancelledAt: null,
  refunds: [],
  ...overrides,
});

const detailRow = (overrides = {}) => ({
  ...queueRow(),
  quantity: 2,
  totalPrice: "100.00",
  adminCommission: "5.00",
  returnReason: "Arrived with a cracked screen",
  ...overrides,
});

const captureClient = (rows) => {
  const capture = {};
  return {
    capture,
    client: {
      order: {
        findMany: async (args) => {
          capture.where = args.where;
          capture.select = args.select;
          capture.orderBy = args.orderBy;
          capture.take = args.take;
          return rows;
        },
        findFirst: async (args) => {
          capture.where = args.where;
          capture.select = args.select;
          return rows[0] ?? null;
        },
      },
    },
  };
};

const ctx = (client, overrides = {}) => ({
  client,
  principal: principal(),
  cursorSecret: SECRET,
  now,
  ...overrides,
});

test("exception queue membership is the fixed server rule, not a caller filter", async () => {
  const { capture, client } = captureClient([queueRow()]);
  const output = await listOrderExceptionQueue({}, ctx(client));
  const where = capture.where;
  assert.equal(where.AND.length, 3);
  const [window, membership, quarantine] = where.AND;
  assert.deepEqual(membership, {
    OR: [
      { status: { in: [...EXCEPTION_STATUSES] } },
      { refunds: { some: { status: REFUND_FAILED_STATUS } } },
    ],
  });
  assert.deepEqual(quarantine, {
    OR: [
      { userId: { not: null } },
      { sellerIdAtPurchase: { not: null } },
    ],
  });
  // No caller-supplied scope/filter keys: the whole predicate is the fixed
  // AND of window, membership, and quarantine.
  assert.deepEqual(Object.keys(where), ["AND"]);
  const serialized = JSON.stringify(where);
  assert.ok(!serialized.includes('"contains"'));
  // The only string-equality status is the fixed refund-failure rule.
  assert.deepEqual(
    serialized.split('"status":"').slice(1).map((rest) => rest.slice(0, 6)),
    ["Failed"],
  );
  // Stored status strings are exact, spaces included.
  assert.deepEqual(membership.OR[0].status.in, [
    "Return Requested",
    "Return Approved",
    "Return Rejected",
    "Refund Released",
  ]);
  assert.equal(output.orders.length, 1);
  assert.equal(capture.take, 21);
  assert.deepEqual(capture.orderBy, [{ createdAt: "desc" }, { id: "desc" }]);
});

test("exception queue window is the most recent 90 days, enforced server-side", async () => {
  const { capture, client } = captureClient([queueRow()]);
  await listOrderExceptionQueue({}, ctx(client));
  const window = capture.where.AND[0].createdAt;
  assert.equal(window.lte.getTime(), now.getTime());
  assert.equal(window.gte.getTime(), now.getTime() - 90 * DAY_MS);
});

test("default page is 20 and oversized limits clamp at 50", async () => {
  const seen = [];
  const client = {
    order: {
      findMany: async (args) => {
        seen.push(args.take);
        return [];
      },
    },
  };
  await listOrderExceptionQueue({}, ctx(client));
  await listOrderExceptionQueue({ limit: 50 }, ctx(client));
  await listOrderExceptionQueue({ limit: 60 }, ctx(client));
  assert.deepEqual(seen, [21, 51, 51]);
});

test("return queue membership requires the return lifecycle and a requested return", async () => {
  const { capture, client } = captureClient([queueRow()]);
  await listReturnQueue({}, ctx(client));
  const where = capture.where;
  assert.equal(where.AND.length, 3);
  const [window, membership, quarantine] = where.AND;
  assert.equal(window.createdAt.gte.getTime(), now.getTime() - 90 * DAY_MS);
  assert.deepEqual(membership, {
    AND: [
      { status: { in: [...RETURN_STATUSES] } },
      { returnRequestedAt: { not: null } },
    ],
  });
  assert.deepEqual(membership.AND[0].status.in, ["Return Requested", "Return Approved", "Return Rejected"]);
  assert.ok(!membership.AND[0].status.in.includes("Refund Released"));
  assert.deepEqual(quarantine, {
    OR: [
      { userId: { not: null } },
      { sellerIdAtPurchase: { not: null } },
    ],
  });
});

test("projections select lifecycle fields only, never contact or address columns", async () => {
  const { capture, client } = captureClient([queueRow()]);
  await listOrderExceptionQueue({}, ctx(client));
  for (const select of [capture.select]) {
    const keys = Object.keys(select);
    assert.ok(!keys.includes("email"));
    assert.ok(!keys.includes("firstName"));
    assert.ok(!keys.includes("lastName"));
    assert.ok(!keys.some((key) => key.startsWith("delivery")));
    assert.ok(!keys.includes("promoCode"));
    assert.ok(keys.includes("sellerIdAtPurchase"));
    assert.ok(keys.includes("userId"));
  }
  await listReturnQueue({}, ctx(client));
  assert.ok(Object.keys(capture.select).includes("returnImage"));
});

test("rows expose opaque references and never raw buyer or seller identity", async () => {
  const { client } = captureClient([
    queueRow(),
    queueRow({ id: "order-2", userId: null, sellerIdAtPurchase: null }),
  ]);
  const output = await listOrderExceptionQueue({}, ctx(client));
  assert.match(output.orders[0].buyerReference, /^buyer-[0-9a-f]{12}$/);
  assert.match(output.orders[0].sellerReference, /^seller-[0-9a-f]{12}$/);
  const again = await listOrderExceptionQueue({}, ctx(client));
  assert.equal(again.orders[0].buyerReference, output.orders[0].buyerReference);
  assert.equal(again.orders[0].sellerReference, output.orders[0].sellerReference);
  assert.equal(output.orders[1].buyerReference, null);
  assert.equal(output.orders[1].sellerReference, null);
  const serialized = JSON.stringify(output);
  assert.ok(!serialized.includes(BUYER));
  assert.ok(!serialized.includes(SELLER));
  assert.ok(!serialized.includes(ADMIN));
  assert.ok(!serialized.includes("email"));
  assert.ok(!serialized.includes("firstName"));
  assert.ok(!serialized.includes("delivery"));
  assert.deepEqual(
    Object.keys(output.orders[0]),
    ["orderId", "orderNumber", "status", "returnRequestedAt", "refundStatus", "refundAmount", "buyerReference", "sellerReference", "lastTransitionAt"],
  );
});

test("refund fields appear only when a refund exists, with exact NPR money", async () => {
  const { client } = captureClient([
    queueRow(),
    queueRow({ id: "order-2", refunds: [{ status: "Failed", amount: "12.34" }] }),
    queueRow({ id: "order-3", status: "Refund Released", refunds: [{ status: "Succeeded", amount: "100" }] }),
  ]);
  const output = await listOrderExceptionQueue({}, ctx(client));
  assert.equal(output.orders[0].refundStatus, null);
  assert.equal(output.orders[0].refundAmount, null);
  assert.equal(output.orders[1].refundStatus, "Failed");
  assert.deepEqual(output.orders[1].refundAmount, { amount: "12.34", currency: "NPR" });
  assert.deepEqual(output.orders[2].refundAmount, { amount: "100", currency: "NPR" });
});

test("statuses leave exactly as stored, never renamed", async () => {
  const { client } = captureClient([
    queueRow({ status: "Return Requested" }),
    queueRow({ id: "order-2", status: "Refund Released" }),
    queueRow({ id: "order-3", status: "Cancelled", refunds: [{ status: "Failed", amount: "1.00" }] }),
  ]);
  const output = await listOrderExceptionQueue({}, ctx(client));
  assert.deepEqual(
    output.orders.map(({ status }) => status),
    ["Return Requested", "Refund Released", "Cancelled"],
  );
});

test("lastTransitionAt is the newest stored stage timestamp", async () => {
  const { client } = captureClient([queueRow()]);
  const output = await listOrderExceptionQueue({}, ctx(client));
  assert.equal(output.orders[0].lastTransitionAt, "2026-09-12T10:00:00.000Z");
  const stale = await listOrderExceptionQueue({}, ctx(
    captureClient([queueRow({ returnRequestedAt: null })]).client,
  ));
  assert.equal(stale.orders[0].lastTransitionAt, "2026-09-10T12:00:00.000Z");
});

test("return rows expose image presence, never the image path", async () => {
  const { client } = captureClient([
    queueRow({ returnImage: "uploads/returns/evidence-1.png" }),
    queueRow({ id: "order-2", returnImage: null }),
  ]);
  const output = await listReturnQueue({}, ctx(client));
  assert.equal(output.returns[0].hasReturnImage, true);
  assert.equal(output.returns[1].hasReturnImage, false);
  assert.deepEqual(
    Object.keys(output.returns[0]),
    ["orderId", "orderNumber", "status", "returnRequestedAt", "returnReason", "buyerReference", "sellerReference", "hasReturnImage", "refundStatus"],
  );
  const serialized = JSON.stringify(output);
  assert.ok(!serialized.includes("uploads"));
  assert.ok(!serialized.includes("returnImage"));
  assert.ok(!serialized.includes(".png"));
});

test("return reasons are bounded user-authored text", async () => {
  const { client } = captureClient([queueRow({ returnReason: "x".repeat(5000) })]);
  const output = await listReturnQueue({}, ctx(client));
  assert.equal(output.returns[0].returnReason.length, 1000);
  const empty = await listReturnQueue({}, ctx(captureClient([queueRow({ returnReason: null })]).client));
  assert.equal(empty.returns[0].returnReason, null);
});

test("detail returns the minimized row with money, quantity, and reason", async () => {
  const { capture, client } = captureClient([detailRow()]);
  const output = await getOrderExceptionDetail({ orderId: "order-1", purpose: "Review customer refund complaint" }, ctx(client));
  assert.deepEqual(capture.where, {
    AND: [
      { id: "order-1" },
      { createdAt: { gte: new Date(now.getTime() - 90 * DAY_MS), lte: now } },
      {
        OR: [
          { status: { in: [...EXCEPTION_STATUSES] } },
          { refunds: { some: { status: REFUND_FAILED_STATUS } } },
        ],
      },
      {
        OR: [
          { userId: { not: null } },
          { sellerIdAtPurchase: { not: null } },
        ],
      },
    ],
  });
  assert.equal(output.order.orderId, "order-1");
  assert.equal(output.order.quantity, 2);
  assert.deepEqual(output.order.totalPrice, { amount: "100", currency: "NPR" });
  assert.deepEqual(output.order.adminCommission, { amount: "5", currency: "NPR" });
  assert.equal(output.order.returnReason, "Arrived with a cracked screen");
  assert.deepEqual(
    Object.keys(output.order),
    [
      "orderId", "orderNumber", "status", "returnRequestedAt", "refundStatus", "refundAmount",
      "buyerReference", "sellerReference", "lastTransitionAt",
      "quantity", "totalPrice", "adminCommission",
      "confirmedAt", "processingAt", "shippedAt", "deliveredAt", "cancelledAt",
      "returnReason", "refundReleasedAt",
    ],
  );
  const serialized = JSON.stringify(output);
  assert.ok(!serialized.includes("email"));
  assert.ok(!serialized.includes("delivery"));
});

test("detail 404s are identical for missing, foreign, non-queued, and quarantined orders", async () => {
  // Every findFirst misses: the fixed membership predicate is the whole
  // authorization rule, so all four cases resolve to the same generic error.
  const { client } = captureClient([]);
  const attempt = (orderId) => getOrderExceptionDetail({ orderId, purpose: "Support ticket follow-up" }, ctx(client));
  for (const orderId of ["missing-order", "r".padEnd(24, "y"), "nonqueued-order", "quarantined-order"]) {
    await assert.rejects(attempt(orderId), (error) => {
      assert.equal(error.statusCode, 404);
      assert.equal(error.code, "not_found");
      assert.equal(error.message, "Resource not found");
      return true;
    });
  }
});

test("detail rejects oversized ids without touching the client", async () => {
  let called = false;
  const client = { order: { findFirst: async () => { called = true; return null; } } };
  await assert.rejects(
    getOrderExceptionDetail({ orderId: "x".repeat(101), purpose: "Support ticket follow-up" }, ctx(client)),
    { statusCode: 404 },
  );
  assert.equal(called, false);
});

test("detail purpose is validated as bounded admin text", async () => {
  const { client } = captureClient([detailRow()]);
  const run = (purpose) => getOrderExceptionDetail({ orderId: "order-1", purpose }, ctx(client));
  await assert.rejects(run("short"), { statusCode: 400 });
  await assert.rejects(run("x".repeat(501)), { statusCode: 400 });
  await assert.rejects(run(undefined), { statusCode: 400 });
  await assert.doesNotReject(run("x".repeat(500)));
});

test("purpose surfaces in the audit observe metadata, bounded", () => {
  const observed = orderExceptionDetailObserve(
    { order: { orderId: "order-1" } },
    { purpose: "p".repeat(600) },
  );
  assert.equal(observed.rowCount, 1);
  assert.deepEqual(observed.resourceIds, ["order-1"]);
  assert.equal(observed.auditMetadata.purpose.length, 500);
  assert.equal(observed.auditMetadata.purpose, "p".repeat(500));
});

test("cursors are bound to the admin principal, operation, and query", async () => {
  const rows = [
    queueRow({ id: "order-2", createdAt: new Date("2026-09-11T10:00:00Z") }),
    queueRow({ id: "order-1" }),
  ];
  const { client } = captureClient(rows);
  const first = await listOrderExceptionQueue({ limit: 1 }, ctx(client));
  assert.ok(first.nextCursor);
  const rival = { ...ctx(client), principal: principal(RIVAL_ADMIN) };
  await assert.rejects(
    listOrderExceptionQueue({ cursor: first.nextCursor, limit: 1 }, rival),
    { statusCode: 404 },
  );
  // Same principal but a different limit is a different query fingerprint.
  await assert.rejects(
    listOrderExceptionQueue({ cursor: first.nextCursor, limit: 2 }, ctx(client)),
    { statusCode: 404 },
  );
  // A cursor minted for the exception queue never validates on the return queue.
  await assert.rejects(
    listReturnQueue({ cursor: first.nextCursor, limit: 1 }, ctx(client)),
    { statusCode: 404 },
  );
  // Missing signing secret fails closed.
  await assert.rejects(
    listOrderExceptionQueue({ cursor: first.nextCursor, limit: 1 }, { ...ctx(client), cursorSecret: undefined }),
    { statusCode: 503 },
  );
});

test("cursor state pins the 90-day window across pages", async () => {
  const rows = [
    queueRow({ id: "order-2", createdAt: new Date("2026-09-11T10:00:00Z") }),
    queueRow({ id: "order-1" }),
  ];
  const capture = {};
  const client = {
    order: {
      findMany: async (args) => {
        capture.where = args.where;
        return rows;
      },
    },
  };
  const first = await listOrderExceptionQueue({ limit: 1 }, ctx(client));
  assert.ok(first.nextCursor);
  const pinnedFrom = capture.where.AND[0].createdAt.gte;
  const later = new Date(now.getTime() + 5 * DAY_MS);
  await listOrderExceptionQueue({ cursor: first.nextCursor, limit: 1 }, { ...ctx(client), now: later });
  assert.equal(capture.where.AND[0].createdAt.gte.getTime(), pinnedFrom.getTime());
  assert.equal(capture.where.AND[0].createdAt.lte.getTime(), now.getTime());
});
