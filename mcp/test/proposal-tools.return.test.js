import assert from "node:assert/strict";
import test from "node:test";

import { isToolAvailable, toolRegistry } from "../src/toolRegistry.js";

const auth = {
  sub: "user-1",
  role: "user",
  verified: true,
  clientId: "shopsphere-mcp-client",
  grantId: "grant-1",
  scopes: ["returns:propose"],
};

const PROPOSE_FLAG = "MCP_TOOL_PROPOSE_ORDER_RETURN_ENABLED";

const tool = () => toolRegistry.find(({ name }) => name === "propose_order_return");

test("propose_order_return carries closed propose metadata and default-dark rollout", () => {
  const propose = tool();
  assert.ok(propose);

  assert.equal(propose.operationClass, "propose");
  assert.equal(propose.rateClass, "proposal");
  assert.deepEqual([...propose.roles], ["user"]);
  assert.deepEqual([...propose.scopes], ["returns:propose"]);
  assert.equal(propose.rollout.flag, PROPOSE_FLAG);
  assert.equal(propose.rollout.defaultEnabled, false);
  assert.equal(propose.backendOperation.kind, "http");
  assert.equal(propose.backendOperation.operationId, "proposals.orderReturn");
  assert.equal(propose.backendOperation.method, "POST");
  assert.equal(propose.backendOperation.path, "/api/v1/assistant/propose_order_return");

  // Visibility requires both the flag and the exact scope.
  assert.equal(isToolAvailable(propose, {}, auth), false);
  assert.equal(isToolAvailable(propose, { [PROPOSE_FLAG]: true }, { ...auth, scopes: ["orders:read"] }), false);
  assert.equal(isToolAvailable(propose, { [PROPOSE_FLAG]: true }, { ...auth, role: "seller" }), false);
  assert.equal(isToolAvailable(propose, { [PROPOSE_FLAG]: true }, auth), true);
});

test("the input is strict: evidence URLs, attachments, images, and confirm flags never parse", () => {
  const schema = tool().inputSchema;

  // Well-formed input parses cleanly.
  assert.ok(schema.safeParse({ orderId: "order123", reason: "The left earcup arrived cracked." }).success);

  // Arbitrary evidence channels are rejections at the schema boundary.
  assert.ok(!schema.safeParse({ orderId: "order123", reason: "The left earcup arrived cracked.", evidenceUrl: "https://evil.example/img.png" }).success);
  assert.ok(!schema.safeParse({ orderId: "order123", reason: "The left earcup arrived cracked.", imageUrl: "https://evil.example/img.png" }).success);
  assert.ok(!schema.safeParse({ orderId: "order123", reason: "The left earcup arrived cracked.", attachmentPath: "/uploads/evil.png" }).success);
  assert.ok(!schema.safeParse({ orderId: "order123", reason: "The left earcup arrived cracked.", returnImage: "evil.png" }).success);

  // No confirmation or execution affordance exists.
  assert.ok(!schema.safeParse({ orderId: "order123", reason: "The left earcup arrived cracked.", confirm: true }).success);
  assert.ok(!schema.safeParse({ orderId: "order123", reason: "The left earcup arrived cracked.", execute: true }).success);
  assert.ok(!schema.safeParse({ orderId: "order123", reason: "The left earcup arrived cracked.", executeNow: "yes" }).success);

  // Bounded reason and orderId shape.
  assert.ok(!schema.safeParse({ orderId: "order123", reason: "short" }).success);
  assert.ok(!schema.safeParse({ orderId: "order123", reason: "x".repeat(1001) }).success);
  assert.ok(schema.safeParse({ orderId: "order123", reason: "  trimmed reason is fine  " }).success); // trimmed within bounds
  assert.ok(!schema.safeParse({ orderId: "order/../../123", reason: "The left earcup arrived cracked." }).success);
  assert.ok(!schema.safeParse({ reason: "The left earcup arrived cracked." }).success);
});

test("the output schema pins the server-computed preview with the NPR money contract", () => {
  const schema = tool().outputSchema;
  const output = {
    proposalId: "prop-1",
    status: "pending",
    expiresAt: "2026-09-18T10:10:00.000Z",
    preview: {
      orderId: "order-1",
      orderNumber: "ORD-2026-0042",
      currentStatus: "Delivered",
      returnEligible: true,
      orderTotal: { amount: "1299", currency: "NPR" },
      policyBasis: [{ sourceId: "faqs.json#1", sourceVersion: "1.0.0" }],
      disclosedConsequences: [
        "Creates a return request for seller/admin review",
        "Evidence photos are uploaded in ShopSphere, not here",
        "No refund is released by this action",
      ],
    },
  };
  assert.ok(schema.safeParse(output).success);

  // status is pinned to a fresh pending proposal.
  assert.ok(!schema.safeParse({ ...output, status: "executed" }).success);
  // Money is the exact NPR contract: no other currency, no numeric amounts.
  assert.ok(!schema.safeParse({ ...output, preview: { ...output.preview, orderTotal: { amount: "1299", currency: "USD" } } }).success);
  assert.ok(!schema.safeParse({ ...output, preview: { ...output.preview, orderTotal: { amount: 1299, currency: "NPR" } } }).success);
  // returnEligible can only ever be true on a created proposal.
  assert.ok(!schema.safeParse({ ...output, preview: { ...output.preview, returnEligible: false } }).success);
  // No extra preview or output fields exist (no evidence, no refund promises).
  assert.ok(!schema.safeParse({ ...output, preview: { ...output.preview, evidenceUrl: "https://evil.example" } }).success);
  assert.ok(!schema.safeParse({ ...output, refundAmount: { amount: "0", currency: "NPR" } }).success);
  // currentStatus carries the exact stored storefront string; anything parseable
  // must keep it a plain bounded string (spaces included).
  assert.ok(schema.safeParse({ ...output, preview: { ...output.preview, currentStatus: "Return Requested" } }).success);
});
