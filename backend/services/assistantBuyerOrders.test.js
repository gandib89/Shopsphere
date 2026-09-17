import assert from "node:assert/strict";
import test from "node:test";

import {
  getMyBillSummary,
  getMyOrder,
  getMyPaymentStatus,
  listMyOrders,
  trackMyOrder,
} from "./assistantBuyerOrders.js";

const SUBJECT = "aaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER = "bbbbbbbbbbbbbbbbbbbbbbbb";
const SECRET = "order-cursor-secret-that-is-at-least-thirty-two-bytes!!";
const principal = (subject = SUBJECT) => ({ subject, role: "user", clientId: "client-1", grantId: "grant-1" });

const orderRow = (overrides = {}) => ({
  id: "ord-1",
  userId: SUBJECT,
  status: "Shipped",
  quantity: 2,
  totalPrice: "189.00",
  createdAt: new Date("2026-09-01T10:00:00Z"),
  orderGroupId: null,
  product: { name: "Headphones" },
  confirmedAt: new Date("2026-09-01T11:00:00Z"),
  processingAt: new Date("2026-09-01T12:00:00Z"),
  shippedAt: new Date("2026-09-02T10:00:00Z"),
  deliveredAt: null,
  cancelledAt: null,
  ...overrides,
});

// Read-only proxy: any non-find/count call throws, proving bill/payment
// status reads have no side effects beyond audit/rate-limit metadata.
const readOnlyClient = (handlers, calls = []) => new Proxy({}, {
  get: (_, model) => new Proxy({}, {
    get: (_, method) => async (args) => {
      calls.push(`${model}.${method}`);
      if (!method.startsWith("find") && !method.startsWith("count")) {
        throw new Error(`write blocked: ${model}.${method}`);
      }
      return handlers[`${model}.${method}`]?.(args) ?? null;
    },
  }),
});

test("order list scopes to immutable buyer identity with bounded filters", async () => {
  let where;
  const client = readOnlyClient({
    "order.findMany": (args) => { where = args.where; return [orderRow()]; },
  });
  const output = await listMyOrders(
    { status: "Shipped", from: "2026-08-10T00:00:00Z", to: "2026-09-09T00:00:00Z", limit: 20 },
    { client, principal: principal(), cursorSecret: SECRET },
  );
  assert.equal(where.userId, SUBJECT);
  assert.equal(where.status, "Shipped");
  assert.ok(!("email" in where));
  assert.equal(output.orders.length, 1);
  assert.deepEqual(
    Object.keys(output.orders[0]).sort(),
    ["createdAt", "id", "orderGroupId", "productName", "quantity", "status", "totalPrice"],
  );
  assert.deepEqual(output.orders[0].totalPrice, { amount: "189", currency: "NPR" });
});

test("order list rejects unbounded intervals and unknown statuses", async () => {
  const ctx = { client: readOnlyClient({}), principal: principal(), cursorSecret: SECRET };
  await assert.rejects(
    listMyOrders({ from: "2026-01-01T00:00:00Z", to: "2026-09-09T00:00:00Z" }, ctx),
    /90 days/i,
  );
  await assert.rejects(listMyOrders({ status: "Hacked" }, ctx), /status/i);
  await assert.rejects(
    listMyOrders({ from: "2026-09-09T00:00:00Z", to: "2026-09-01T00:00:00Z" }, ctx),
    /range/i,
  );
});

test("order cursors are bound to the principal and reveal nothing cross-buyer", async () => {
  const rows = [
    orderRow({ id: "ord-2", createdAt: new Date("2026-09-02T10:00:00Z") }),
    orderRow({ id: "ord-1", createdAt: new Date("2026-09-01T10:00:00Z") }),
  ];
  const client = readOnlyClient({ "order.findMany": () => rows });
  const first = await listMyOrders({ limit: 1 }, { client, principal: principal(), cursorSecret: SECRET });
  assert.ok(first.nextCursor);
  await assert.rejects(
    listMyOrders({ cursor: first.nextCursor, limit: 1 }, { client, principal: principal(OTHER), cursorSecret: SECRET }),
    { statusCode: 404 },
  );
});

test("default-window pagination stays valid across requests", async () => {
  const rows = [
    orderRow({ id: "ord-2", createdAt: new Date("2026-09-02T10:00:00Z") }),
    orderRow({ id: "ord-1", createdAt: new Date("2026-09-01T10:00:00Z") }),
  ];
  const windows = [];
  const client = readOnlyClient({ "order.findMany": (args) => { windows.push(args.where.createdAt); return rows; } });
  const baseCtx = { client, principal: principal(), cursorSecret: SECRET };
  const first = await listMyOrders({ limit: 1 }, { ...baseCtx, now: new Date("2026-09-10T00:00:00Z") });
  assert.ok(first.nextCursor);
  const second = await listMyOrders(
    { cursor: first.nextCursor, limit: 1 },
    { ...baseCtx, now: new Date("2026-09-20T00:00:00Z") },
  );
  assert.equal(second.orders.length, 1);
  assert.deepEqual(windows[1], windows[0]);
});

test("order detail uses generic not-found for missing or foreign ids", async () => {
  const foreign = readOnlyClient({ "order.findFirst": () => null });
  await assert.rejects(getMyOrder({ orderId: "ord-9" }, { client: foreign, principal: principal() }), { statusCode: 404 });
  let where;
  const owned = readOnlyClient({
    "order.findFirst": (args) => { where = args.where; return orderRow(); },
    "order.findMany": () => [],
  });
  const output = await getMyOrder({ orderId: "ord-1" }, { client: owned, principal: principal() });
  assert.deepEqual(where, { id: "ord-1", userId: SUBJECT });
  assert.equal(output.order.id, "ord-1");
  assert.ok(!("email" in output.order) && !("deliveryStreet" in output.order));
});

test("multi-seller group children are independently re-scoped to the buyer", async () => {
  const queries = [];
  const sibling = orderRow({ id: "ord-2", product: { name: "Charger" } });
  const client = readOnlyClient({
    "order.findFirst": () => orderRow({ orderGroupId: "grp-1" }),
    "order.findMany": (args) => { queries.push(args.where); return [sibling]; },
  });
  const output = await getMyOrder({ orderId: "ord-1" }, { client, principal: principal() });
  assert.deepEqual(queries[0], { orderGroupId: "grp-1", userId: SUBJECT, id: { not: "ord-1" } });
  assert.equal(output.groupOrders.length, 1);
  assert.equal(output.groupOrders[0].id, "ord-2");
});

test("legacy rows without buyer ownership can never match the subject predicate", async () => {
  // A legacy row with userId NULL cannot satisfy { userId: subject }; the
  // service additionally never queries by email, so ownership cannot be
  // claimed through a caller-supplied address.
  let where;
  const client = readOnlyClient({
    "order.findFirst": (args) => { where = args.where; return null; },
  });
  await assert.rejects(getMyOrder({ orderId: "legacy-1" }, { client, principal: principal() }), { statusCode: 404 });
  assert.ok(where.userId === SUBJECT && !("email" in where));
});

test("tracking reuses stored timestamps and performs no carrier lookup", async () => {
  const calls = [];
  const client = readOnlyClient({ "order.findFirst": () => orderRow() }, calls);
  const output = await trackMyOrder({ orderId: "ord-1" }, { client, principal: principal() });
  assert.equal(output.orderId, "ord-1");
  assert.equal(output.status, "Shipped");
  assert.deepEqual(output.timeline.map((step) => [step.step, step.done]), [
    ["Order Placed", true],
    ["Confirmed", true],
    ["Processing", true],
    ["Shipped", true],
    ["Delivered", false],
  ]);
  assert.ok(calls.every((call) => call.includes("find")));
});

test("tracking never marks fulfilment stages past the current status done", async () => {
  const client = readOnlyClient({
    "order.findFirst": () => orderRow({
      status: "Confirmed",
      confirmedAt: new Date("2026-09-01T11:00:00Z"),
      processingAt: null,
      shippedAt: null,
      deliveredAt: null,
    }),
  });
  const output = await trackMyOrder({ orderId: "ord-1" }, { client, principal: principal() });
  assert.deepEqual(output.timeline.map((step) => [step.step, step.done]), [
    ["Order Placed", true],
    ["Confirmed", true],
    ["Processing", false],
    ["Shipped", false],
    ["Delivered", false],
  ]);
});

test("bill reads never generate or update bills and omit address PII", async () => {
  const calls = [];
  const bill = {
    billNumber: "BILL-ord-1",
    orderId: "ord-1",
    productName: "Headphones",
    quantity: 2,
    unitPrice: "100.00",
    totalPrice: "189.00",
    status: "Generated",
    orderDate: new Date("2026-09-01T10:00:00Z"),
    firstName: "Ada",
    email: "ada@example.com",
    deliveryStreet: "1 Main St",
  };
  const client = readOnlyClient({
    "order.findFirst": () => orderRow(),
    "bill.findFirst": (args) => {
      assert.deepEqual(args.where, { orderId: "ord-1", userId: SUBJECT });
      return bill;
    },
  }, calls);
  const output = await getMyBillSummary({ orderId: "ord-1" }, { client, principal: principal() });
  assert.deepEqual(Object.keys(output).sort(), ["billNumber", "orderDate", "orderId", "productName", "quantity", "status", "totalPrice", "unitPrice"]);
  assert.deepEqual(output.unitPrice, { amount: "100", currency: "NPR" });
  assert.ok(!JSON.stringify(output).includes("Main St"));
  assert.ok(calls.every((call) => call.includes("find")));
  assert.ok(!calls.some((call) => /upsert|create|update/i.test(call)));
});

test("missing bills return generic not-found without creating one", async () => {
  const client = readOnlyClient({
    "order.findFirst": () => orderRow(),
    "bill.findFirst": () => null,
  });
  await assert.rejects(getMyBillSummary({ orderId: "ord-1" }, { client, principal: principal() }), { statusCode: 404 });
});

test("payment status omits gateway payloads, credentials, and execution authority", async () => {
  const queries = [];
  const client = readOnlyClient({
    "order.findFirst": () => orderRow(),
    "payment.findMany": (args) => {
      queries.push(args.where);
      return [{
        status: "Succeeded",
        amount: "189.00",
        gatewayRefId: "secret-ref",
        transactionUuid: "secret-uuid",
        productCode: "EPAY",
      }];
    },
    "refund.findMany": (args) => { queries.push(args.where); return []; },
  });
  const output = await getMyPaymentStatus({ orderId: "ord-1" }, { client, principal: principal() });
  assert.deepEqual(output, {
    orderId: "ord-1",
    status: "Shipped",
    payments: [{ status: "Succeeded", amount: { amount: "189", currency: "NPR" } }],
    refunds: [],
  });
  assert.ok(!JSON.stringify(output).includes("secret"));
  // Payments/refunds carry no buyer column, so every query re-scopes through
  // the owned order relation instead of trusting the earlier order check.
  for (const where of queries) {
    assert.equal(where.orderId, "ord-1");
    assert.deepEqual(where.order, { userId: SUBJECT });
  }
});
