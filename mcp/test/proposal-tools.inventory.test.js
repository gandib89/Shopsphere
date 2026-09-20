// #28: propose_inventory_adjustment registry metadata, strict input rejection
// (no confirm/execute fields, no absolute stock overwrite, no double change,
// unbounded counts), output schema, and wire registration. Complements (never
// edits) proposal-tools.test.js and the #24/#25/#26/#27 branch test files.
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
  scopes: ["inventory:propose"],
};

const INVENTORY_FLAG = "MCP_TOOL_PROPOSE_INVENTORY_ADJUSTMENT_ENABLED";
const REASON = "Supplier delivered twelve extra units of this color on Monday";

const inventoryPreview = (overrides = {}) => ({
  actionKind: "inventory.adjust",
  productId: "prod-1",
  productName: "Headphones",
  optionId: "opt-color-1",
  optionKind: "color",
  optionValue: "Black",
  currentCount: 7,
  requestedCount: 4,
  reason: REASON,
  disclosedConsequences: [
    'Sets stock for "Headphones" (color: Black) from 7 to 4 on confirm',
    "Concurrent sales between review and confirm make this proposal stale",
    "No orders or notifications are affected",
  ],
  ...overrides,
});

test("propose_inventory_adjustment carries closed propose metadata and default-dark rollout", () => {
  const tool = toolRegistry.find(({ name }) => name === "propose_inventory_adjustment");
  assert.ok(tool, "tool registered in the registry");

  assert.equal(tool.operationClass, "propose");
  assert.equal(tool.rateClass, "proposal");
  assert.deepEqual([...tool.roles], ["seller"]);
  assert.deepEqual([...tool.scopes], ["inventory:propose"]);
  assert.equal(tool.rollout.flag, INVENTORY_FLAG);
  assert.equal(tool.rollout.defaultEnabled, false); // ships dark
  assert.equal(tool.backendOperation.kind, "http");
  assert.equal(tool.backendOperation.operationId, "proposals.inventoryAdjust");
  assert.equal(tool.backendOperation.method, "POST");
  assert.equal(tool.backendOperation.path, "/api/v1/assistant/propose_inventory_adjustment");

  // Visibility requires both the flag and the exact scope; wrong roles/scopes
  // and a dark flag all hide the tool. Verified-seller gating is enforced
  // backend-side (assistantVerifiedSellerGate.js), not at discovery.
  assert.equal(isToolAvailable(tool, {}, auth), false);
  assert.equal(isToolAvailable(tool, { [INVENTORY_FLAG]: true }, { ...auth, scopes: ["catalog:read"] }), false);
  assert.equal(isToolAvailable(tool, { [INVENTORY_FLAG]: true }, { ...auth, role: "user" }), false);
  assert.equal(isToolAvailable(tool, { [INVENTORY_FLAG]: true }, { ...auth, role: "admin" }), false);
  assert.equal(isToolAvailable(tool, { [INVENTORY_FLAG]: true }, auth), true);

  // The registry version stays at the wave-1 value for #28 (additive entry).
  assert.equal(REGISTRY_VERSION, "1.4.0");
});

test("inventory input is strict: confirm, execute, stock overwrite, double change, and bad bounds never parse", () => {
  const schema = toolRegistry.find(({ name }) => name === "propose_inventory_adjustment").inputSchema;
  const base = { productId: "prod-1", optionId: "opt-color-1", adjustment: -3, reason: REASON };

  // Forged confirmation / execution affordances must be schema rejections.
  assert.ok(!schema.safeParse({ ...base, confirm: true }).success);
  assert.ok(!schema.safeParse({ ...base, confirm: false }).success);
  assert.ok(!schema.safeParse({ ...base, executeNow: true }).success);
  assert.ok(!schema.safeParse({ ...base, approved: "yes" }).success);
  // No absolute count overwrite semantics beyond setTo: a bare `stock` field
  // is a schema rejection, never a server state change.
  assert.ok(!schema.safeParse({ productId: "prod-1", reason: REASON, stock: 5 }).success);
  assert.ok(!schema.safeParse({ ...base, stock: 5 }).success);
  // Exactly one of adjustment/setTo.
  assert.ok(!schema.safeParse({ productId: "prod-1", reason: REASON, adjustment: 1, setTo: 5 }).success);
  assert.ok(!schema.safeParse({ productId: "prod-1", reason: REASON }).success);
  // Bounds: signed adjustment and absolute setTo.
  assert.ok(!schema.safeParse({ productId: "prod-1", reason: REASON, adjustment: -10001 }).success);
  assert.ok(!schema.safeParse({ productId: "prod-1", reason: REASON, adjustment: 10001 }).success);
  assert.ok(!schema.safeParse({ productId: "prod-1", reason: REASON, setTo: -1 }).success);
  assert.ok(!schema.safeParse({ productId: "prod-1", reason: REASON, setTo: 100001 }).success);
  assert.ok(!schema.safeParse({ ...base, adjustment: 1.5 }).success);
  // Required user-authored reason.
  assert.ok(!schema.safeParse({ productId: "prod-1", adjustment: 1 }).success);
  assert.ok(!schema.safeParse({ productId: "prod-1", adjustment: 1, reason: "too short" }).success);
  assert.ok(!schema.safeParse({ productId: "prod-1", adjustment: 1, reason: "x".repeat(501) }).success);
  // Closed field set.
  assert.ok(!schema.safeParse({ ...base, extra: 1 }).success);

  assert.ok(schema.safeParse(base).success);
  assert.ok(schema.safeParse({ productId: "prod-1", optionId: "opt-color-1", adjustment: 0, reason: REASON }).success);
  assert.ok(schema.safeParse({ productId: "prod-1", adjustment: -10000, reason: REASON }).success);
  assert.ok(schema.safeParse({ productId: "prod-1", adjustment: 10000, reason: REASON }).success);
  assert.ok(schema.safeParse({ productId: "prod-1", setTo: 0, reason: REASON }).success);
  assert.ok(schema.safeParse({ productId: "prod-1", setTo: 100000, reason: REASON }).success);
  assert.ok(schema.safeParse({ productId: "prod-1", adjustment: 1, reason: "x".repeat(20) }).success);
  assert.ok(schema.safeParse({ productId: "prod-1", adjustment: 1, reason: `  ${REASON}  ` }).success); // trimmed
});

test("inventory output pins the exact server-computed preview shape", () => {
  const schema = toolRegistry.find(({ name }) => name === "propose_inventory_adjustment").outputSchema;
  const output = {
    proposalId: "prop-inv-1",
    status: "pending",
    expiresAt: "2026-09-19T10:10:00.000Z",
    preview: inventoryPreview(),
  };
  assert.ok(schema.safeParse(output).success);

  // Product-level proposals omit the option fields entirely (no nulls).
  assert.ok(schema.safeParse({
    ...output,
    preview: inventoryPreview({
      optionId: undefined,
      optionKind: undefined,
      optionValue: undefined,
      currentCount: 5,
      requestedCount: 42,
      disclosedConsequences: [
        'Sets stock for "Headphones" from 5 to 42 on confirm',
        "Concurrent sales between review and confirm make this proposal stale",
        "No orders or notifications are affected",
      ],
    }),
  }).success);

  // Only the inventory action kind can ever appear, only pending proposals,
  // counts are nonnegative integers, and no caller-shaped fields ride out.
  assert.ok(!schema.safeParse({ ...output, preview: inventoryPreview({ actionKind: "order.cancel" }) }).success);
  assert.ok(!schema.safeParse({ ...output, status: "executed" }).success);
  assert.ok(!schema.safeParse({ ...output, preview: inventoryPreview({ currentCount: -1 }) }).success);
  assert.ok(!schema.safeParse({ ...output, preview: inventoryPreview({ requestedCount: 4.5 }) }).success);
  assert.ok(!schema.safeParse({ ...output, proposalId: "x", preview: inventoryPreview({ reason: "too short" }) }).success);
  assert.ok(!schema.safeParse({ ...output, preview: inventoryPreview({ extra: "field" }) }).success);
  assert.ok(!schema.safeParse({ ...output, preview: inventoryPreview({ productId: "" }) }).success);
});

const fakeInventoryBackend = () => {
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
      if (name === "propose_inventory_adjustment") {
        return {
          proposalId: "prop-inv-1",
          status: "pending",
          expiresAt: "2026-09-19T10:10:00.000Z",
          preview: inventoryPreview({
            requestedCount: input.adjustment !== undefined ? 7 + input.adjustment : input.setTo,
          }),
        };
      }
      throw new Error("Unknown backend operation");
    },
  };
};

test("the inventory tool registers over the wire, reaches the backend once, and rejects forged fields", async (t) => {
  const backend = fakeInventoryBackend();
  const server = createMcpHttpServer({
    enabled: true,
    accessToken: "mcp-inventory-test-token-1234",
    tokenVerifier: async () => auth,
    authContextResolver: async (context) => ({ ...context, auth, delegatedToken: "delegated-token" }),
    backendClient: backend,
    flags: { [INVENTORY_FLAG]: true },
  });
  const url = await listen(server);
  t.after(() => close(server));

  const client = new Client(
    { name: "shopsphere-inventory-test", version: "1.0.0" },
    { versionNegotiation: { mode: "legacy" } },
  );
  await client.connect(new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { authorization: "Bearer mcp-inventory-test-token-1234" } },
  }));
  t.after(() => client.close());

  const names = (await client.listTools()).tools.map(({ name }) => name);
  assert.ok(names.includes("propose_inventory_adjustment"), "propose_inventory_adjustment registered");

  const proposed = await client.callTool({
    name: "propose_inventory_adjustment",
    arguments: { productId: "prod-1", optionId: "opt-color-1", adjustment: -3, reason: REASON },
  });
  assert.equal(proposed.isError, undefined);
  assert.equal(proposed.structuredContent.proposalId, "prop-inv-1");
  assert.equal(proposed.structuredContent.status, "pending");
  assert.equal(proposed.structuredContent.preview.currentCount, 7);
  assert.equal(proposed.structuredContent.preview.requestedCount, 4);
  assert.deepEqual(backend.calls, [
    { name: "propose_inventory_adjustment", input: { productId: "prod-1", optionId: "opt-color-1", adjustment: -3, reason: REASON } },
  ]);

  // Forged confirmation / overwrite fields never reach the backend as an
  // accepted call: the strict schema turns them into errors.
  for (const forged of [
    { productId: "prod-1", optionId: "opt-color-1", adjustment: -3, reason: REASON, confirm: true },
    { productId: "prod-1", optionId: "opt-color-1", adjustment: -3, reason: REASON, stock: 5 },
    { productId: "prod-1", reason: REASON, adjustment: 1, setTo: 2 },
  ]) {
    const result = await client.callTool({ name: "propose_inventory_adjustment", arguments: forged });
    assert.equal(result.isError, true);
  }
  assert.equal(backend.accepted.length, 1);
  assert.ok(
    backend.calls.every(
      ({ input }) => !("confirm" in input) && !("stock" in input) && !("executeNow" in input),
    ),
  );
});
