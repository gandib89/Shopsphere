// #27: propose_price_change registry metadata, strict input rejection (no
// totals, no confirm/execute fields, no option-level target), output schema,
// and wire registration. Complements (never edits) proposal-tools.test.js and
// the #24/#25 branch test files.
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
  scopes: ["pricing:propose"],
};

const PRICE_FLAG = "MCP_TOOL_PROPOSE_PRICE_CHANGE_ENABLED";

const pricePreview = (overrides = {}) => ({
  actionKind: "product.set_price",
  currency: "NPR",
  productId: "prod-1",
  productName: "Headphones",
  change: "set_price",
  oldValue: "900",
  newValue: "850",
  effectiveDisplayPriceBefore: { amount: "810", currency: "NPR" },
  effectiveDisplayPriceAfter: { amount: "765", currency: "NPR" },
  disclosedConsequences: [
    "Changes the live listing price from 900 to 850 NPR",
    "No orders, payments, or promotions are affected",
  ],
  ...overrides,
});

test("propose_price_change carries closed propose metadata and default-dark rollout", () => {
  const tool = toolRegistry.find(({ name }) => name === "propose_price_change");
  assert.ok(tool, "tool registered in the registry");

  assert.equal(tool.operationClass, "propose");
  assert.equal(tool.rateClass, "proposal");
  assert.deepEqual([...tool.roles], ["seller"]);
  assert.deepEqual([...tool.scopes], ["pricing:propose"]);
  assert.equal(tool.rollout.flag, PRICE_FLAG);
  assert.equal(tool.rollout.defaultEnabled, false); // ships dark
  assert.equal(tool.backendOperation.kind, "http");
  assert.equal(tool.backendOperation.operationId, "proposals.priceChange");
  assert.equal(tool.backendOperation.method, "POST");
  assert.equal(tool.backendOperation.path, "/api/v1/assistant/propose_price_change");

  // Visibility requires both the flag and the exact scope; wrong roles/scopes
  // and a dark flag all hide the tool. Verified-seller gating is enforced
  // backend-side (assistantVerifiedSellerPriceGate.js), not at discovery.
  assert.equal(isToolAvailable(tool, {}, auth), false);
  assert.equal(isToolAvailable(tool, { [PRICE_FLAG]: true }, { ...auth, scopes: ["catalog:read"] }), false);
  assert.equal(isToolAvailable(tool, { [PRICE_FLAG]: true }, { ...auth, role: "user" }), false);
  assert.equal(isToolAvailable(tool, { [PRICE_FLAG]: true }, { ...auth, role: "admin" }), false);
  assert.equal(isToolAvailable(tool, { [PRICE_FLAG]: true }, auth), true);

  // The registry version stays at the wave-1 value for #27 (additive entry).
  assert.equal(REGISTRY_VERSION, "1.4.0");
});

test("price-change input is strict: totals, confirm, execute, and option targeting never parse", () => {
  const schema = toolRegistry.find(({ name }) => name === "propose_price_change").inputSchema;
  const base = { productId: "prod-1", change: "set_price", newValue: "850" };

  // Model-supplied payable totals are schema rejections, never server state.
  assert.ok(!schema.safeParse({ ...base, total: "850.00" }).success);
  assert.ok(!schema.safeParse({ ...base, payableTotal: "850.00" }).success);
  // Forged confirmation / execution affordances must be schema rejections.
  assert.ok(!schema.safeParse({ ...base, confirm: true }).success);
  assert.ok(!schema.safeParse({ ...base, executeNow: true }).success);
  assert.ok(!schema.safeParse({ ...base, approved: "yes" }).success);
  // Options only carry priceDelta deltas: option-level targeting is out of
  // contract and rejected with the schema (400 at the route).
  assert.ok(!schema.safeParse({ ...base, optionId: "opt-1" }).success);
  assert.ok(!schema.safeParse({ ...base, option: { kind: "color", value: "Black" } }).success);

  // Shape: exactly one product, one change, one bounded decimal value.
  assert.ok(!schema.safeParse({}).success);
  assert.ok(!schema.safeParse({ productId: "prod-1" }).success);
  assert.ok(!schema.safeParse({ productId: "prod-1", change: "set_price" }).success);
  assert.ok(!schema.safeParse({ ...base, productId: "" }).success);
  assert.ok(!schema.safeParse({ ...base, change: "increase_price" }).success);
  assert.ok(!schema.safeParse({ ...base, newValue: "-5" }).success);
  assert.ok(!schema.safeParse({ ...base, newValue: "850.005" }).success);
  assert.ok(!schema.safeParse({ ...base, newValue: 850 }).success); // no raw numbers
  // Percent form violations for set_discount: the schema pins the syntactic
  // percent form only — the semantic [0, 100] bound is enforced server-side
  // (assistantPriceProposals.js bounds), so "150" parses here but 400s there.
  assert.ok(!schema.safeParse({ ...base, change: "set_discount", newValue: "-1" }).success);
  assert.ok(!schema.safeParse({ ...base, change: "set_discount", newValue: "abc" }).success);
  assert.ok(!schema.safeParse({ ...base, change: "set_discount", newValue: "12.505" }).success);
  assert.ok(schema.safeParse({ ...base, change: "set_discount", newValue: "150" }).success);
  assert.ok(!schema.safeParse({ ...base, extra: 1 }).success);

  assert.ok(schema.safeParse(base).success);
  assert.ok(schema.safeParse({ productId: "prod-1", change: "set_discount", newValue: "25.5" }).success);
});

test("price-change output pins the exact server-computed preview shape with NPR money", () => {
  const schema = toolRegistry.find(({ name }) => name === "propose_price_change").outputSchema;
  const output = {
    proposalId: "prop-price-1",
    status: "pending",
    expiresAt: "2026-09-19T10:10:00.000Z",
    preview: pricePreview(),
  };
  assert.ok(schema.safeParse(output).success);

  // Discount proposals carry percent old/new values with the same shape.
  assert.ok(schema.safeParse({
    ...output,
    preview: pricePreview({
      actionKind: "product.set_discount",
      change: "set_discount",
      oldValue: "10",
      newValue: "25",
      disclosedConsequences: [
        "Changes the discount percentage from 10% to 25%",
        "No orders, payments, or promotions are affected",
      ],
    }),
  }).success);

  // Only the two product action kinds can ever appear.
  assert.ok(!schema.safeParse({ ...output, preview: pricePreview({ actionKind: "order.cancel" }) }).success);
  assert.ok(!schema.safeParse({ ...output, status: "executed" }).success);
  assert.ok(!schema.safeParse({ ...output, preview: pricePreview({ change: "set_both" }) }).success);

  // Money is exact-decimal NPR only, and no caller-shaped totals can ride out.
  assert.ok(!schema.safeParse({
    ...output,
    preview: pricePreview({ effectiveDisplayPriceAfter: { amount: "765", currency: "USD" } }),
  }).success);
  assert.ok(!schema.safeParse({
    ...output,
    preview: pricePreview({ newValue: "-5" }),
  }).success);
  assert.ok(!schema.safeParse({ ...output, total: "765" }).success);
  assert.ok(!schema.safeParse({ ...output, preview: pricePreview({ optionId: "opt-1" }) }).success);
  assert.ok(!schema.safeParse({ ...output, preview: pricePreview({ extra: "field" }) }).success);
});

const fakePriceBackend = () => {
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
      if (name === "propose_price_change") {
        return {
          proposalId: "prop-price-1",
          status: "pending",
          expiresAt: "2026-09-19T10:10:00.000Z",
          preview: pricePreview({ newValue: input.newValue }),
        };
      }
      throw new Error("Unknown backend operation");
    },
  };
};

test("the price tool registers over the wire, reaches the backend once, and rejects forged fields", async (t) => {
  const backend = fakePriceBackend();
  const server = createMcpHttpServer({
    enabled: true,
    accessToken: "mcp-price-test-token-123456789",
    tokenVerifier: async () => auth,
    authContextResolver: async (context) => ({ ...context, auth, delegatedToken: "delegated-token" }),
    backendClient: backend,
    flags: { [PRICE_FLAG]: true },
  });
  const url = await listen(server);
  t.after(() => close(server));

  const client = new Client(
    { name: "shopsphere-price-test", version: "1.0.0" },
    { versionNegotiation: { mode: "legacy" } },
  );
  await client.connect(new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { authorization: "Bearer mcp-price-test-token-123456789" } },
  }));
  t.after(() => client.close());

  const names = (await client.listTools()).tools.map(({ name }) => name);
  assert.ok(names.includes("propose_price_change"), "propose_price_change registered");

  const proposed = await client.callTool({
    name: "propose_price_change",
    arguments: { productId: "prod-1", change: "set_price", newValue: "850" },
  });
  assert.equal(proposed.isError, undefined);
  assert.equal(proposed.structuredContent.proposalId, "prop-price-1");
  assert.equal(proposed.structuredContent.status, "pending");
  assert.equal(proposed.structuredContent.preview.oldValue, "900");
  assert.deepEqual(proposed.structuredContent.preview.effectiveDisplayPriceAfter, { amount: "765", currency: "NPR" });
  assert.deepEqual(backend.calls, [
    { name: "propose_price_change", input: { productId: "prod-1", change: "set_price", newValue: "850" } },
  ]);

  // Forged totals / confirmation / option-targeting fields never reach the
  // backend as an accepted call: the strict schema turns them into errors.
  for (const forged of [
    { productId: "prod-1", change: "set_price", newValue: "850", total: "850.00" },
    { productId: "prod-1", change: "set_price", newValue: "850", confirm: true },
    { productId: "prod-1", change: "set_price", newValue: "850", optionId: "opt-1" },
  ]) {
    const result = await client.callTool({ name: "propose_price_change", arguments: forged });
    assert.equal(result.isError, true);
  }
  assert.equal(backend.accepted.length, 1);
  assert.ok(
    backend.calls.every(
      ({ input }) => !("total" in input) && !("confirm" in input) && !("optionId" in input),
    ),
  );
});
