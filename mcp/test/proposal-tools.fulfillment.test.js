// #29: propose_fulfillment_transition registry metadata, strict input
// rejection (no currentStatus, no confirm/execute fields), output schema,
// and wire registration. Complements (never edits) proposal-tools.test.js and
// the #24/#25/#27 branch test files.
import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { createMcpHttpServer } from "../src/httpServer.js";
import { isToolAvailable, REGISTRY_VERSION, toolRegistry } from "../src/toolRegistry.js";
import { close, listen } from "./support/httpServer.js";

const auth = {
  sub: "seller-1",
  role: "seller",
  verified: true,
  clientId: "shopsphere-mcp-client",
  grantId: "grant-1",
  scopes: ["fulfillment:propose"],
};

const FULFILLMENT_FLAG = "MCP_TOOL_PROPOSE_FULFILLMENT_TRANSITION_ENABLED";

const fulfillmentPreview = (overrides = {}) => ({
  actionKind: "sale.advance_fulfillment",
  saleLineId: "a1b2c3d4e5f6a7b8c9d0e1f2",
  orderNumber: "ORD-2026-0042",
  productName: "Headphones",
  currentStatus: "Confirmed",
  nextStatus: "Processing",
  stageTimestamps: {
    confirmedAt: "2026-09-19T08:00:00.000Z",
    processingAt: null,
    shippedAt: null,
    deliveredAt: null,
  },
  willSetTimestamp: "processingAt",
  disclosedConsequences: [
    "Sets processingAt on the sale line",
    "No buyer notification or email is sent by this execution (the storefront fulfillment flow normally sends one)",
    "No payment, refund, or stock change happens",
  ],
  ...overrides,
});

test("propose_fulfillment_transition carries closed propose metadata and default-dark rollout", () => {
  const tool = toolRegistry.find(({ name }) => name === "propose_fulfillment_transition");
  assert.ok(tool, "tool registered in the registry");

  assert.equal(tool.operationClass, "propose");
  assert.equal(tool.rateClass, "proposal");
  assert.deepEqual([...tool.roles], ["seller"]);
  assert.deepEqual([...tool.scopes], ["fulfillment:propose"]);
  assert.equal(tool.rollout.flag, FULFILLMENT_FLAG);
  assert.equal(tool.rollout.defaultEnabled, false); // ships dark
  assert.equal(tool.backendOperation.kind, "http");
  assert.equal(tool.backendOperation.operationId, "proposals.fulfillmentTransition");
  assert.equal(tool.backendOperation.method, "POST");
  assert.equal(tool.backendOperation.path, "/api/v1/assistant/propose_fulfillment_transition");

  // Visibility requires both the flag and the exact scope; wrong roles/scopes
  // and a dark flag all hide the tool. Verified-seller gating is enforced
  // backend-side (assistantVerifiedSellerGate.js), not at discovery.
  assert.equal(isToolAvailable(tool, {}, auth), false);
  assert.equal(isToolAvailable(tool, { [FULFILLMENT_FLAG]: true }, { ...auth, scopes: ["sales:read"] }), false);
  assert.equal(isToolAvailable(tool, { [FULFILLMENT_FLAG]: true }, { ...auth, role: "user" }), false);
  assert.equal(isToolAvailable(tool, { [FULFILLMENT_FLAG]: true }, { ...auth, role: "admin" }), false);
  assert.equal(isToolAvailable(tool, { [FULFILLMENT_FLAG]: true }, auth), true);

  // The registry version stays at the current additive-entry value (#29 does
  // not bump the wave version).
  assert.equal(REGISTRY_VERSION, "1.4.0");
});

test("fulfillment input is strict: currentStatus, confirm/execute, and identity fields never parse", () => {
  const schema = toolRegistry.find(({ name }) => name === "propose_fulfillment_transition").inputSchema;
  const base = { saleLineId: "a1b2c3d4e5f6a7b8c9d0e1f2", nextStatus: "Processing" };

  // The server derives the current status: a caller-supplied one is a schema
  // rejection, never an input.
  assert.ok(!schema.safeParse({ ...base, currentStatus: "Pending" }).success);
  assert.ok(!schema.safeParse({ ...base, currentStatus: "Confirmed" }).success);
  // Forged confirmation / execution affordances must be schema rejections.
  assert.ok(!schema.safeParse({ ...base, confirm: true }).success);
  assert.ok(!schema.safeParse({ ...base, executeNow: true }).success);
  assert.ok(!schema.safeParse({ ...base, approved: "yes" }).success);
  // Seller identity is attributed server-side, never an input.
  assert.ok(!schema.safeParse({ ...base, sellerId: "aaaaaaaaaaaaaaaaaaaaaaaa" }).success);

  // Shape: exactly one 24-char sale line id and one forward stage.
  assert.ok(!schema.safeParse({}).success);
  assert.ok(!schema.safeParse({ saleLineId: "a1b2c3d4e5f6a7b8c9d0e1f2" }).success);
  assert.ok(!schema.safeParse({ nextStatus: "Processing" }).success);
  assert.ok(!schema.safeParse({ ...base, saleLineId: "" }).success);
  assert.ok(!schema.safeParse({ ...base, saleLineId: "short" }).success);
  assert.ok(!schema.safeParse({ ...base, saleLineId: "A1B2C3D4E5F6A7B8C9D0E1F2" }).success); // hex-only id
  assert.ok(!schema.safeParse({ ...base, nextStatus: "Confirmed" }).success); // confirmOrderCore's gate, never a proposal
  assert.ok(!schema.safeParse({ ...base, nextStatus: "Pending" }).success);
  assert.ok(!schema.safeParse({ ...base, nextStatus: "Cancelled" }).success);
  // The schema stays syntactic: a forward stage like "Delivered" or "Shipped"
  // always parses; whether the sale line is actually one step away is the
  // server's deterministic 409 not_fulfillable.
  assert.ok(!schema.safeParse({ ...base, orderId: "order-1" }).success);
  assert.ok(!schema.safeParse({ ...base, extra: 1 }).success);

  assert.ok(schema.safeParse(base).success);
  assert.ok(schema.safeParse({ ...base, nextStatus: "Shipped" }).success);
  assert.ok(schema.safeParse({ ...base, nextStatus: "Delivered" }).success);
});

test("fulfillment output pins the exact server-computed preview shape", () => {
  const schema = toolRegistry.find(({ name }) => name === "propose_fulfillment_transition").outputSchema;
  const output = {
    proposalId: "prop-fulfill-1",
    status: "pending",
    expiresAt: "2026-09-19T10:10:00.000Z",
    preview: fulfillmentPreview(),
  };
  assert.ok(schema.safeParse(output).success);

  // Shipped -> Delivered backfills deliveredAt and carries the set timestamps.
  assert.ok(schema.safeParse({
    ...output,
    preview: fulfillmentPreview({
      currentStatus: "Shipped",
      nextStatus: "Delivered",
      willSetTimestamp: "deliveredAt",
      stageTimestamps: {
        confirmedAt: "2026-09-19T08:00:00.000Z",
        processingAt: "2026-09-19T08:30:00.000Z",
        shippedAt: "2026-09-19T09:00:00.000Z",
        deliveredAt: null,
      },
      disclosedConsequences: [
        "Sets deliveredAt on the sale line",
        "No buyer notification or email is sent by this execution (the storefront fulfillment flow normally sends one)",
        "No payment, refund, or stock change happens",
      ],
    }),
  }).success);

  // Only the fulfillable current statuses, forward stages, and the single
  // action kind can ever appear; terminal states and buyer statuses cannot.
  assert.ok(!schema.safeParse({ ...output, preview: fulfillmentPreview({ currentStatus: "Pending" }) }).success);
  assert.ok(!schema.safeParse({ ...output, preview: fulfillmentPreview({ currentStatus: "Delivered" }) }).success);
  assert.ok(!schema.safeParse({ ...output, preview: fulfillmentPreview({ currentStatus: "Return Requested" }) }).success);
  assert.ok(!schema.safeParse({ ...output, preview: fulfillmentPreview({ currentStatus: "Confirmed", nextStatus: "Confirmed" }) }).success);
  assert.ok(!schema.safeParse({ ...output, preview: fulfillmentPreview({ actionKind: "order.cancel" }) }).success);
  assert.ok(!schema.safeParse({ ...output, status: "executed" }).success);
  assert.ok(!schema.safeParse({ ...output, preview: fulfillmentPreview({ willSetTimestamp: "cancelledAt" }) }).success);
  assert.ok(!schema.safeParse({ ...output, preview: fulfillmentPreview({ extra: "field" }) }).success);
});

const fakeFulfillmentBackend = () => {
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
      if (name === "propose_fulfillment_transition") {
        return {
          proposalId: "prop-fulfill-1",
          status: "pending",
          expiresAt: "2026-09-19T10:10:00.000Z",
          preview: fulfillmentPreview({ nextStatus: input.nextStatus }),
        };
      }
      throw new Error("Unknown backend operation");
    },
  };
};

test("the fulfillment tool registers over the wire, reaches the backend once, and rejects forged fields", async (t) => {
  const backend = fakeFulfillmentBackend();
  const server = createMcpHttpServer({
    enabled: true,
    accessToken: "mcp-fulfillment-test-token-123456",
    tokenVerifier: async () => auth,
    authContextResolver: async (context) => ({ ...context, auth, delegatedToken: "delegated-token" }),
    backendClient: backend,
    flags: { [FULFILLMENT_FLAG]: true },
  });
  const url = await listen(server);
  t.after(() => close(server));

  const client = new Client(
    { name: "shopsphere-fulfillment-test", version: "1.0.0" },
    { versionNegotiation: { mode: "legacy" } },
  );
  await client.connect(new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { authorization: "Bearer mcp-fulfillment-test-token-123456" } },
  }));
  t.after(() => client.close());

  const names = (await client.listTools()).tools.map(({ name }) => name);
  assert.ok(names.includes("propose_fulfillment_transition"), "propose_fulfillment_transition registered");

  const proposed = await client.callTool({
    name: "propose_fulfillment_transition",
    arguments: { saleLineId: "a1b2c3d4e5f6a7b8c9d0e1f2", nextStatus: "Processing" },
  });
  assert.equal(proposed.isError, undefined);
  assert.equal(proposed.structuredContent.proposalId, "prop-fulfill-1");
  assert.equal(proposed.structuredContent.status, "pending");
  assert.equal(proposed.structuredContent.preview.currentStatus, "Confirmed");
  assert.equal(proposed.structuredContent.preview.nextStatus, "Processing");
  assert.equal(proposed.structuredContent.preview.willSetTimestamp, "processingAt");
  assert.deepEqual(backend.calls, [
    { name: "propose_fulfillment_transition", input: { saleLineId: "a1b2c3d4e5f6a7b8c9d0e1f2", nextStatus: "Processing" } },
  ]);

  // Forged current-status / confirmation fields never reach the backend as an
  // accepted call: the strict schema turns them into errors.
  for (const forged of [
    { saleLineId: "a1b2c3d4e5f6a7b8c9d0e1f2", nextStatus: "Processing", currentStatus: "Pending" },
    { saleLineId: "a1b2c3d4e5f6a7b8c9d0e1f2", nextStatus: "Processing", confirm: true },
    { saleLineId: "a1b2c3d4e5f6a7b8c9d0e1f2", nextStatus: "Confirmed" },
  ]) {
    const result = await client.callTool({ name: "propose_fulfillment_transition", arguments: forged });
    assert.equal(result.isError, true);
  }
  assert.equal(backend.accepted.length, 1);
  assert.ok(
    backend.calls.every(
      ({ input }) => !("currentStatus" in input) && !("confirm" in input) && !("sellerId" in input),
    ),
  );
});
