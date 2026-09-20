// #24: propose_order_cancellation registry metadata, strict input rejection,
// output schema, and wire registration. Complements (never edits)
// proposal-tools.test.js (cart proposals).
import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { createMcpHttpServer } from "../src/httpServer.js";
import { isToolAvailable, REGISTRY_VERSION, toolRegistry } from "../src/toolRegistry.js";
import { close, listen } from "./support/httpServer.js";

const auth = {
  sub: "user-1",
  role: "user",
  verified: true,
  clientId: "shopsphere-mcp-client",
  grantId: "grant-1",
  scopes: ["orders:propose", "proposals:read"],
};

const CANCEL_FLAG = "MCP_TOOL_PROPOSE_ORDER_CANCELLATION_ENABLED";

test("propose_order_cancellation carries closed propose metadata and default-dark rollout", () => {
  const tool = toolRegistry.find(({ name }) => name === "propose_order_cancellation");
  assert.ok(tool, "tool registered in the registry");

  assert.equal(tool.operationClass, "propose");
  assert.equal(tool.rateClass, "proposal");
  assert.deepEqual([...tool.roles], ["user"]);
  assert.deepEqual([...tool.scopes], ["orders:propose"]);
  assert.equal(tool.rollout.flag, CANCEL_FLAG);
  assert.equal(tool.rollout.defaultEnabled, false); // ships dark
  assert.equal(tool.backendOperation.kind, "http");
  assert.equal(tool.backendOperation.operationId, "proposals.orderCancel");
  assert.equal(tool.backendOperation.method, "POST");
  assert.equal(tool.backendOperation.path, "/api/v1/assistant/propose_order_cancellation");

  // Visibility requires both the flag and the exact scope; wrong roles/scopes
  // and a dark flag all hide the tool.
  assert.equal(isToolAvailable(tool, {}, auth), false);
  assert.equal(isToolAvailable(tool, { [CANCEL_FLAG]: true }, { ...auth, scopes: ["orders:read"] }), false);
  assert.equal(isToolAvailable(tool, { [CANCEL_FLAG]: true }, { ...auth, role: "admin" }), false);
  assert.equal(isToolAvailable(tool, { [CANCEL_FLAG]: true }, auth), true);

  // The registry version stays at the wave-1 value for #24 (additive entry).
  assert.equal(REGISTRY_VERSION, "1.4.0");
});

test("cancellation input is strict: confirm, execute, refund, and total fields never parse", () => {
  const schema = toolRegistry.find(({ name }) => name === "propose_order_cancellation").inputSchema;
  // Forged confirmation / execution / refund affordances must be schema
  // rejections, never server state changes.
  assert.ok(!schema.safeParse({ orderId: "order1", confirm: true }).success);
  assert.ok(!schema.safeParse({ orderId: "order1", executeNow: true }).success);
  assert.ok(!schema.safeParse({ orderId: "order1", refund: true }).success);
  assert.ok(!schema.safeParse({ orderId: "order1", releaseRefund: "yes" }).success);
  assert.ok(!schema.safeParse({ orderId: "order1", approved: "yes" }).success);
  assert.ok(!schema.safeParse({ orderId: "order1", total: "1.00" }).success);

  // Shape: exactly one bounded order id.
  assert.ok(!schema.safeParse({}).success);
  assert.ok(!schema.safeParse({ orderId: "" }).success);
  assert.ok(!schema.safeParse({ orderId: "order-with-spaces" }).success);
  assert.ok(!schema.safeParse({ orderId: "x".repeat(25) }).success);
  assert.ok(!schema.safeParse({ orderId: "order1", extra: 1 }).success);

  assert.ok(schema.safeParse({ orderId: "order1" }).success);
  assert.ok(schema.safeParse({ orderId: "a".repeat(24) }).success);
});

test("cancellation output pins the exact server-computed preview shape with NPR money", () => {
  const schema = toolRegistry.find(({ name }) => name === "propose_order_cancellation").outputSchema;
  const output = {
    proposalId: "prop-1",
    status: "pending",
    expiresAt: "2026-09-19T10:10:00.000Z",
    preview: {
      actionKind: "order.cancel",
      currency: "NPR",
      orderId: "order1",
      orderNumber: "ORD-2026-0001",
      currentStatus: "Confirmed",
      cancelEligible: true,
      stockToRestore: 2,
      paidAmount: { amount: "1890.50", currency: "NPR" },
      disclosedConsequences: [
        "Cancels the order",
        "Restores 2 item(s) to stock",
        "Any refund is a separate manual admin action and is NOT initiated here",
      ],
    },
  };
  assert.ok(schema.safeParse(output).success);

  // Pending snapshot: zero stock restored, honest null paid amount.
  assert.ok(schema.safeParse({
    ...output,
    preview: { ...output.preview, currentStatus: "Pending", stockToRestore: 0, paidAmount: null },
  }).success);

  // Ineligible statuses can never appear: only eligible orders propose.
  assert.ok(!schema.safeParse({ ...output, preview: { ...output.preview, currentStatus: "Shipped" } }).success);
  assert.ok(!schema.safeParse({ ...output, preview: { ...output.preview, cancelEligible: false } }).success);
  assert.ok(!schema.safeParse({ ...output, status: "executed" }).success);

  // Money is exact-decimal NPR only.
  assert.ok(!schema.safeParse({
    ...output,
    preview: { ...output.preview, paidAmount: { amount: "1890.50", currency: "USD" } },
  }).success);
  assert.ok(!schema.safeParse({
    ...output,
    preview: { ...output.preview, paidAmount: { amount: "-5.00", currency: "NPR" } },
  }).success);
  assert.ok(!schema.safeParse({
    ...output,
    preview: { ...output.preview, paidAmount: { amount: "1890.505", currency: "NPR" } },
  }).success);
  assert.ok(!schema.safeParse({
    ...output,
    preview: { ...output.preview, stockToRestore: 2.5 },
  }).success);

  // No refund execution fields can ride on the output.
  assert.ok(!schema.safeParse({ ...output, refund: { status: "Processing" } }).success);
  assert.ok(!schema.safeParse({
    ...output,
    preview: { ...output.preview, refundStatus: "Processing" },
  }).success);
  assert.ok(!schema.safeParse({
    ...output,
    preview: { ...output.preview, extra: "field" },
  }).success);
});

const fakeCancellationBackend = () => {
  // Mirrors the real backend contract: strict registry schema validation
  // before anything is "persisted", then the exact bounded snapshot.
  const schemas = Object.fromEntries(toolRegistry.map((tool) => [tool.name, tool.inputSchema]));
  const calls = [];
  const accepted = [];
  return {
    calls,
    accepted,
    async call(name, input) {
      calls.push({ name, input });
      if (!schemas[name]?.safeParse(input).success) {
        throw Object.assign(new Error("Backend operation failed"), { statusCode: 400 });
      }
      accepted.push({ name, input });
      if (name === "propose_order_cancellation") {
        return {
          proposalId: "prop-cancel-1",
          status: "pending",
          expiresAt: "2026-09-19T10:10:00.000Z",
          preview: {
            actionKind: "order.cancel",
            currency: "NPR",
            orderId: input.orderId,
            orderNumber: "ORD-2026-0001",
            currentStatus: "Confirmed",
            cancelEligible: true,
            stockToRestore: 2,
            paidAmount: { amount: "1890.50", currency: "NPR" },
            disclosedConsequences: [
              "Cancels the order",
              "Restores 2 item(s) to stock",
              "Any refund is a separate manual admin action and is NOT initiated here",
            ],
          },
        };
      }
      throw new Error("Unknown backend operation");
    },
  };
};

test("the cancellation tool registers over the wire, reaches the backend once, and rejects forged fields", async (t) => {
  const backend = fakeCancellationBackend();
  const server = createMcpHttpServer({
    enabled: true,
    accessToken: "mcp-cancel-test-token-123456789",
    tokenVerifier: async () => auth,
    authContextResolver: async (context) => ({ ...context, auth, delegatedToken: "delegated-token" }),
    backendClient: backend,
    flags: { [CANCEL_FLAG]: true },
  });
  const url = await listen(server);
  t.after(() => close(server));

  const client = new Client(
    { name: "shopsphere-cancel-test", version: "1.0.0" },
    { versionNegotiation: { mode: "legacy" } },
  );
  await client.connect(new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { authorization: "Bearer mcp-cancel-test-token-123456789" } },
  }));
  t.after(() => client.close());

  const names = (await client.listTools()).tools.map(({ name }) => name);
  assert.ok(names.includes("propose_order_cancellation"), "propose_order_cancellation registered");

  const proposed = await client.callTool({
    name: "propose_order_cancellation",
    arguments: { orderId: "order1" },
  });
  assert.equal(proposed.isError, undefined);
  assert.equal(proposed.structuredContent.proposalId, "prop-cancel-1");
  assert.equal(proposed.structuredContent.status, "pending");
  assert.equal(proposed.structuredContent.preview.stockToRestore, 2);
  assert.deepEqual(proposed.structuredContent.preview.paidAmount, { amount: "1890.50", currency: "NPR" });
  assert.deepEqual(backend.calls, [{ name: "propose_order_cancellation", input: { orderId: "order1" } }]);

  // Forged confirmation/execution/refund fields never reach the backend as an
  // accepted call: the strict schema turns them into error outcomes.
  for (const forged of [
    { orderId: "order1", confirm: true },
    { orderId: "order1", executeNow: true },
    { orderId: "order1", refund: true },
  ]) {
    const result = await client.callTool({ name: "propose_order_cancellation", arguments: forged });
    assert.equal(result.isError, true);
  }
  assert.equal(backend.accepted.length, 1);
  assert.ok(backend.calls.every(({ input }) => !("confirm" in input) && !("executeNow" in input) && !("refund" in input)));
});
