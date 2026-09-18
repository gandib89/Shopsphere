import assert from "node:assert/strict";
import test from "node:test";

import { createBackendClient } from "../src/backendClient.js";
import { readConfig } from "../src/config.js";
import { isToolAvailable, toolRegistry } from "../src/toolRegistry.js";

// Admin support queues (#17). Membership is fixed server-side, so inputs are
// pagination-only (plus the detail purpose) and every arbitrary-filter field
// must be rejected by the strict schemas.
const expected = {
  list_order_exception_queue: {
    roles: ["admin"],
    scopes: ["support:read"],
    operationId: "support.orderExceptionQueue",
    path: "/api/v1/assistant/list_order_exception_queue",
    flag: "MCP_TOOL_LIST_ORDER_EXCEPTION_QUEUE_ENABLED",
  },
  get_order_exception_detail: {
    roles: ["admin"],
    scopes: ["support:read"],
    operationId: "support.orderExceptionDetail",
    path: "/api/v1/assistant/get_order_exception_detail",
    flag: "MCP_TOOL_GET_ORDER_EXCEPTION_DETAIL_ENABLED",
  },
  list_return_queue: {
    roles: ["admin"],
    scopes: ["support:read"],
    operationId: "support.returnQueue",
    path: "/api/v1/assistant/list_return_queue",
    flag: "MCP_TOOL_LIST_RETURN_QUEUE_ENABLED",
  },
};

const byName = Object.fromEntries(toolRegistry.map((tool) => [tool.name, tool]));

const queueRow = {
  orderId: "order-1",
  orderNumber: "SP-2026-0001",
  status: "Return Requested",
  returnRequestedAt: "2026-09-12T10:00:00.000Z",
  refundStatus: null,
  refundAmount: null,
  buyerReference: "buyer-0123456789ab",
  sellerReference: "seller-0123456789ab",
  lastTransitionAt: "2026-09-12T10:00:00.000Z",
};

const detailOrder = {
  ...queueRow,
  quantity: 2,
  totalPrice: { amount: "100", currency: "NPR" },
  adminCommission: { amount: "5", currency: "NPR" },
  confirmedAt: "2026-09-10T11:00:00.000Z",
  processingAt: null,
  shippedAt: null,
  deliveredAt: null,
  cancelledAt: null,
  returnReason: "Arrived with a cracked screen",
  refundReleasedAt: null,
};

const returnRow = {
  orderId: "order-1",
  orderNumber: "SP-2026-0001",
  status: "Return Approved",
  returnRequestedAt: "2026-09-12T10:00:00.000Z",
  returnReason: "Arrived with a cracked screen",
  buyerReference: "buyer-0123456789ab",
  sellerReference: "seller-0123456789ab",
  hasReturnImage: true,
  refundStatus: "Processing",
};

test("admin queue tools carry closed role, scope, and backend metadata", () => {
  for (const [name, wanted] of Object.entries(expected)) {
    const tool = byName[name];
    assert.ok(tool, name);
    assert.deepEqual([...tool.roles], wanted.roles, `${name} roles`);
    assert.deepEqual([...tool.scopes], wanted.scopes, `${name} scopes`);
    assert.equal(tool.operationClass, "read", `${name} class`);
    assert.equal(tool.rateClass, "authenticated-read", `${name} rate`);
    assert.equal(tool.backendOperation.kind, "http", `${name} kind`);
    assert.equal(tool.backendOperation.method, "POST", `${name} method`);
    assert.equal(tool.backendOperation.operationId, wanted.operationId, `${name} op`);
    assert.equal(tool.backendOperation.path, wanted.path, `${name} path`);
    assert.equal(tool.rollout.flag, wanted.flag, `${name} flag`);
    assert.equal(tool.rollout.defaultEnabled, false, `${name} default off`);
  }
});

test("admin queue flags default to false and parse from the environment", () => {
  const defaults = readConfig({});
  for (const { flag } of Object.values(expected)) {
    assert.equal(defaults.flags[flag], false, flag);
  }
  const enabled = readConfig({
    MCP_TOOL_LIST_ORDER_EXCEPTION_QUEUE_ENABLED: "true",
    MCP_TOOL_GET_ORDER_EXCEPTION_DETAIL_ENABLED: "true",
    MCP_TOOL_LIST_RETURN_QUEUE_ENABLED: "true",
  });
  for (const { flag } of Object.values(expected)) {
    assert.equal(enabled.flags[flag], true, flag);
  }
});

test("detail requires a bounded purpose and rejects extra fields", () => {
  const detail = byName.get_order_exception_detail.inputSchema;
  assert.ok(!detail.safeParse({ orderId: "order-1" }).success, "purpose required");
  assert.ok(!detail.safeParse({ orderId: "order-1", purpose: "short" }).success, "purpose min length");
  assert.ok(!detail.safeParse({ orderId: "order-1", purpose: "x".repeat(501) }).success, "purpose max length");
  assert.ok(!detail.safeParse({ orderId: "x".repeat(101), purpose: "Support ticket follow-up" }).success, "orderId bound");
  assert.ok(!detail.safeParse({ orderId: "order-1", purpose: "Support ticket follow-up", reason: "extra" }).success, "strict extra field");
  assert.ok(detail.safeParse({ orderId: "order-1", purpose: "x".repeat(500) }).success);
  assert.ok(detail.safeParse({ orderId: "order-1", purpose: "Reviewing a customer refund complaint" }).success);
});

test("queue inputs reject arbitrary filters, scopes, and identity fields", () => {
  for (const name of ["list_order_exception_queue", "list_return_queue"]) {
    const input = byName[name].inputSchema;
    assert.ok(!input.safeParse({ status: ["Return Requested"] }).success, `${name} status list`);
    assert.ok(!input.safeParse({ where: { status: "Return Requested" } }).success, `${name} where clause`);
    assert.ok(!input.safeParse({ statuses: "Return Requested" }).success, `${name} statuses`);
    assert.ok(!input.safeParse({ userId: "victim" }).success, `${name} userId`);
    assert.ok(!input.safeParse({ sellerId: "victim" }).success, `${name} sellerId`);
    assert.ok(!input.safeParse({ orderId: "order-1" }).success, `${name} detail-by-id`);
    assert.ok(!input.safeParse({ from: "2026-01-01T00:00:00Z" }).success, `${name} date override`);
    assert.ok(!input.safeParse({ limit: 51 }).success, `${name} oversized limit`);
    assert.ok(!input.safeParse({ limit: 0 }).success, `${name} zero limit`);
    assert.ok(input.safeParse({}).success, `${name} empty input`);
    assert.ok(input.safeParse({ limit: 50 }).success, `${name} max limit`);
  }
});

test("exception queue output pins the exact stored status strings", () => {
  const output = byName.list_order_exception_queue.outputSchema;
  const list = (rows) => output.safeParse({ orders: rows, nextCursor: null });
  assert.ok(list([queueRow]).success);
  for (const stored of ["Return Requested", "Return Approved", "Return Rejected", "Refund Released", "Cancelled"]) {
    assert.ok(list([{ ...queueRow, status: stored }]).success, stored);
  }
  // MCP-fictional names from earlier buyer/seller enums are not stored states.
  for (const fake of ["ReturnRequested", "Returned", "return requested", "Pending"]) {
    assert.ok(!list([{ ...queueRow, status: fake }]).success, fake);
  }
  assert.ok(!list([{ ...queueRow, refundAmount: { amount: "1", currency: "USD" } }]).success, "currency pinned");
  assert.ok(!list([{ ...queueRow, refundAmount: { amount: "1.234", currency: "NPR" } }]).success, "exact decimals");
  assert.ok(!list([{ ...queueRow, lastTransitionAt: null }]).success, "lastTransitionAt required");
});

test("detail output carries the minimized order and rejects PII-shaped extras", () => {
  const output = byName.get_order_exception_detail.outputSchema;
  assert.ok(output.safeParse({ order: detailOrder }).success);
  assert.ok(!output.safeParse({ order: { ...detailOrder, email: "buyer@example.test" } }).success);
  assert.ok(!output.safeParse({ order: { ...detailOrder, deliveryStreet: "1 Main St" } }).success);
  assert.ok(!output.safeParse({ order: { ...detailOrder, returnImage: "uploads/returns/x.png" } }).success);
  assert.ok(!output.safeParse({ order: { ...detailOrder, payment: {} } }).success);
  assert.ok(!output.safeParse({ order: detailOrder, purpose: "why" }).success);
  assert.ok(!output.safeParse({ order: { ...detailOrder, totalPrice: { amount: "1", currency: "USD" } } }).success);
});

test("return output exposes image presence as a boolean, never a path", () => {
  const output = byName.list_return_queue.outputSchema;
  assert.ok(output.safeParse({ returns: [returnRow], nextCursor: null }).success);
  assert.ok(!output.safeParse({ returns: [{ ...returnRow, returnImage: "uploads/returns/x.png" }] }).success, "no path column");
  assert.ok(!output.safeParse({ returns: [{ ...returnRow, hasReturnImageUrl: "https://x.test/i.png" }] }).success, "no url field");
  assert.ok(!output.safeParse({ returns: [{ ...returnRow, hasReturnImage: "yes" }] }).success, "boolean only");
  // The return queue can only ever contain live return lifecycle states.
  assert.ok(!output.safeParse({ returns: [{ ...returnRow, status: "Refund Released" }] }).success);
  assert.ok(!output.safeParse({ returns: [{ ...returnRow, returnRequestedAt: null }] }).success);
});

test("queues are undiscoverable without admin role, scope, and rollout flag", () => {
  const enabled = Object.fromEntries(toolRegistry.map((tool) => [tool.rollout.flag, true]));
  const admin = { role: "admin", scopes: ["support:read"] };
  for (const name of Object.keys(expected)) {
    assert.ok(isToolAvailable(byName[name], enabled, admin), name);
    assert.ok(!isToolAvailable(byName[name], {}, admin), `${name} flag off`);
    assert.ok(!isToolAvailable(byName[name], enabled, { role: "admin", scopes: [] }), `${name} scope missing`);
    assert.ok(!isToolAvailable(byName[name], enabled, { role: "seller", scopes: ["support:read"] }), `${name} seller`);
    assert.ok(!isToolAvailable(byName[name], enabled, { role: "user", scopes: ["support:read"] }), `${name} user`);
  }
});

test("backend client exchanges the support scope for each queue operation", async () => {
  const seen = [];
  const client = createBackendClient({
    origin: "http://backend:4000",
    token: "workload-secret",
    exchangeToken: async (subjectToken, scopes) => {
      seen.push(scopes);
      return "delegated-token";
    },
    fetchImpl: async (url, init) => {
      if (!init.headers.authorization?.includes("delegated-token") || !init.headers["x-assistant-api-token"]) {
        return new Response("unauthorized", { status: 401 });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  await client.call("list_order_exception_queue", {}, { subjectToken: "s" });
  await client.call("get_order_exception_detail", { orderId: "order-1", purpose: "Review a refund complaint" }, { subjectToken: "s" });
  await client.call("list_return_queue", {}, { subjectToken: "s" });
  assert.deepEqual(seen, [["support:read"], ["support:read"], ["support:read"]]);
});
