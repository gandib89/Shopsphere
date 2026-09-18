import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { createMcpHttpServer } from "../src/httpServer.js";
import { isToolAvailable, toolRegistry } from "../src/toolRegistry.js";
import { close, listen } from "./support/httpServer.js";

const auth = {
  sub: "user-1",
  role: "user",
  verified: true,
  clientId: "shopsphere-mcp-client",
  grantId: "grant-1",
  scopes: ["cart:propose", "proposals:read"],
};

const PROPOSE_FLAG = "MCP_TOOL_PROPOSE_CART_CHANGE_ENABLED";
const STATUS_FLAG = "MCP_TOOL_GET_MY_ACTION_STATUS_ENABLED";

test("proposal tools carry closed propose/read metadata and default-dark rollout", () => {
  const propose = toolRegistry.find(({ name }) => name === "propose_cart_change");
  const status = toolRegistry.find(({ name }) => name === "get_my_action_status");
  assert.ok(propose && status);

  assert.equal(propose.operationClass, "propose");
  assert.equal(propose.rateClass, "proposal");
  assert.deepEqual([...propose.roles], ["user"]);
  assert.deepEqual([...propose.scopes], ["cart:propose"]);
  assert.equal(propose.rollout.flag, PROPOSE_FLAG);
  assert.equal(propose.rollout.defaultEnabled, false);
  assert.equal(propose.backendOperation.kind, "http");
  assert.equal(propose.backendOperation.operationId, "proposals.proposeCartChange");
  assert.equal(propose.backendOperation.method, "POST");
  assert.equal(propose.backendOperation.path, "/api/v1/assistant/propose_cart_change");

  assert.equal(status.operationClass, "read");
  assert.equal(status.rateClass, "authenticated-read");
  assert.deepEqual([...status.roles], ["user"]);
  assert.deepEqual([...status.scopes], ["proposals:read"]);
  assert.equal(status.rollout.flag, STATUS_FLAG);
  assert.equal(status.rollout.defaultEnabled, false);
  assert.equal(status.backendOperation.operationId, "proposals.actionStatus");
  assert.equal(status.backendOperation.path, "/api/v1/assistant/get_my_action_status");

  // Visibility requires both the flag and the exact scope.
  assert.equal(isToolAvailable(propose, {}, auth), false);
  assert.equal(isToolAvailable(propose, { [PROPOSE_FLAG]: true }, { ...auth, scopes: ["cart:read"] }), false);
  assert.equal(isToolAvailable(propose, { [PROPOSE_FLAG]: true }, auth), true);
  assert.equal(isToolAvailable(status, { [STATUS_FLAG]: true }, { ...auth, role: "seller" }), false);
});

test("propose input is strict: forged confirmation flags, execute fields, and totals never parse", () => {
  const schema = toolRegistry.find(({ name }) => name === "propose_cart_change").inputSchema;
  // Forged confirmation / execution affordances must be schema rejections.
  assert.ok(!schema.safeParse({ action: "add_item", productId: "p1", quantity: 1, confirm: true }).success);
  assert.ok(!schema.safeParse({ action: "add_item", productId: "p1", quantity: 1, executeNow: true }).success);
  assert.ok(!schema.safeParse({ action: "add_item", productId: "p1", quantity: 1, totalPrice: "1.00" }).success);
  assert.ok(!schema.safeParse({ action: "add_item", productId: "p1", quantity: 1, approved: "yes" }).success);

  // Cross-field rules: one action at a time, with exactly the fields it needs.
  assert.ok(!schema.safeParse({ action: "add_item", productId: "p1" }).success);
  assert.ok(!schema.safeParse({ action: "add_item", quantity: 1 }).success);
  assert.ok(!schema.safeParse({ action: "add_item", productId: "p1", quantity: 1, cartItemId: "c1" }).success);
  assert.ok(!schema.safeParse({ action: "update_quantity", cartItemId: "c1" }).success);
  assert.ok(!schema.safeParse({ action: "update_quantity", cartItemId: "c1", quantity: 1, productId: "p1" }).success);
  assert.ok(!schema.safeParse({ action: "remove_item", cartItemId: "c1", quantity: 1 }).success);
  assert.ok(!schema.safeParse({ action: "remove_item", cartItemId: "c1", productId: "p1" }).success);
  assert.ok(!schema.safeParse({ action: "remove_item", cartItemId: "c1", options: { color: "Black" } }).success);
  assert.ok(!schema.safeParse({ action: "add_item", productId: "p1", quantity: 0 }).success);
  assert.ok(!schema.safeParse({ action: "add_item", productId: "p1", quantity: 21 }).success);
  assert.ok(!schema.safeParse({ action: "add_item", productId: "p1", quantity: 1, options: { a: "1", b: "2", c: "3", d: "4", e: "5", f: "6" } }).success);
  assert.ok(!schema.safeParse({ action: "add_item", productId: "p1", quantity: 1, options: { kind: "x".repeat(51) } }).success);
  assert.ok(!schema.safeParse({ action: "bogus", productId: "p1" }).success);

  // Well-formed single-action inputs parse cleanly.
  assert.ok(schema.safeParse({ action: "add_item", productId: "p1", quantity: 1 }).success);
  assert.ok(schema.safeParse({ action: "add_item", productId: "p1", quantity: 20, options: { color: "Black" } }).success);
  assert.ok(schema.safeParse({ action: "update_quantity", cartItemId: "c1", quantity: 3 }).success);
  assert.ok(schema.safeParse({ action: "remove_item", cartItemId: "c1" }).success);
});

test("status input is strict and outputs expose no preview, secret, or execution fields", () => {
  const status = toolRegistry.find(({ name }) => name === "get_my_action_status");
  assert.ok(!status.inputSchema.safeParse({ proposalId: "p1", confirm: true }).success);
  assert.ok(!status.inputSchema.safeParse({ proposalId: "p1", execute: true }).success);
  assert.ok(!status.inputSchema.safeParse({}).success);
  assert.ok(status.inputSchema.safeParse({ proposalId: "p1" }).success);

  const base = {
    proposalId: "prop-1",
    actionKind: "cart.update_quantity",
    status: "pending",
    createdAt: "2026-09-18T10:00:00.000Z",
    expiresAt: "2026-09-18T10:10:00.000Z",
    executedAt: null,
    outcomeReason: null,
  };
  assert.ok(status.outputSchema.safeParse(base).success);
  assert.ok(status.outputSchema.safeParse({ ...base, status: "expired", outcomeReason: "expired" }).success);
  assert.ok(status.outputSchema.safeParse({ ...base, status: "executed", executedAt: "2026-09-18T10:01:00.000Z" }).success);
  assert.ok(!status.outputSchema.safeParse({ ...base, status: "EXECUTED" }).success);
  assert.ok(!status.outputSchema.safeParse({ ...base, approvalSecret: "grant-me" }).success);
  assert.ok(!status.outputSchema.safeParse({ ...base, executionMethod: "POST /api/v1/proposals/prop-1/execute" }).success);
  assert.ok(!status.outputSchema.safeParse({ ...base, preview: { before: {}, after: {} } }).success);
});

test("propose output pins the exact server-computed preview shape", () => {
  const schema = toolRegistry.find(({ name }) => name === "propose_cart_change").outputSchema;
  const output = {
    proposalId: "prop-1",
    status: "pending",
    expiresAt: "2026-09-18T10:10:00.000Z",
    preview: {
      actionKind: "cart.add_item",
      currency: "NPR",
      productName: "Headphones",
      availability: "In stock",
      before: { quantity: null, unitPrice: null, lineTotal: null, cartSubtotal: { amount: "180", currency: "NPR" } },
      after: { quantity: 5, unitPrice: { amount: "90", currency: "NPR" }, lineTotal: { amount: "450", currency: "NPR" }, cartSubtotal: { amount: "450", currency: "NPR" } },
    },
  };
  assert.ok(schema.safeParse(output).success);
  assert.ok(!schema.safeParse({ ...output, status: "executed" }).success);
  assert.ok(!schema.safeParse({
    ...output,
    preview: { ...output.preview, before: { ...output.preview.before, cartSubtotal: { amount: "180", currency: "USD" } } },
  }).success);
  assert.ok(!schema.safeParse({ ...output, preview: { ...output.preview, extra: "field" } }).success);
  assert.ok(!schema.safeParse({
    ...output,
    preview: { ...output.preview, availability: "Backordered" },
  }).success);
});

const fakeProposalBackend = () => {
  // The real Express backend is the enforcement point for strict inputs (zod
  // .strict() parse -> 400 invalid_input). This fake mirrors that contract: it
  // validates every call against the registry schema before "persisting".
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
      if (name === "propose_cart_change") {
        return {
          proposalId: "prop-1",
          status: "pending",
          expiresAt: "2026-09-18T10:10:00.000Z",
          preview: {
            actionKind: `cart.${input.action}`,
            currency: "NPR",
            productName: "Headphones",
            availability: "In stock",
            before: { quantity: null, unitPrice: null, lineTotal: null, cartSubtotal: { amount: "0", currency: "NPR" } },
            after: { quantity: input.quantity, unitPrice: { amount: "90", currency: "NPR" }, lineTotal: { amount: "90", currency: "NPR" }, cartSubtotal: { amount: "90", currency: "NPR" } },
          },
        };
      }
      if (name === "get_my_action_status") {
        return {
          proposalId: input.proposalId,
          actionKind: "cart.add_item",
          status: "pending",
          createdAt: "2026-09-18T10:00:00.000Z",
          expiresAt: "2026-09-18T10:10:00.000Z",
          executedAt: null,
          outcomeReason: null,
        };
      }
      throw new Error("Unknown backend operation");
    },
  };
};

test("the two proposal tools register over the wire and reach the backend exactly once per call", async (t) => {
  const backend = fakeProposalBackend();
  const server = createMcpHttpServer({
    enabled: true,
    accessToken: "mcp-proposal-test-token-123456789",
    tokenVerifier: async () => auth,
    authContextResolver: async (context) => ({ ...context, auth, delegatedToken: "delegated-token" }),
    backendClient: backend,
    flags: { [PROPOSE_FLAG]: true, [STATUS_FLAG]: true },
  });
  const url = await listen(server);
  t.after(() => close(server));

  const client = new Client(
    { name: "shopsphere-proposal-test", version: "1.0.0" },
    { versionNegotiation: { mode: "legacy" } },
  );
  await client.connect(new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { authorization: "Bearer mcp-proposal-test-token-123456789" } },
  }));
  t.after(() => client.close());

  const names = (await client.listTools()).tools.map(({ name }) => name);
  assert.ok(names.includes("propose_cart_change"), "propose_cart_change registered");
  assert.ok(names.includes("get_my_action_status"), "get_my_action_status registered");

  const proposed = await client.callTool({
    name: "propose_cart_change",
    arguments: { action: "add_item", productId: "prod-1", quantity: 1 },
  });
  assert.equal(proposed.isError, undefined);
  assert.equal(proposed.structuredContent.proposalId, "prop-1");
  assert.equal(proposed.structuredContent.status, "pending");
  assert.deepEqual(backend.calls, [{ name: "propose_cart_change", input: { action: "add_item", productId: "prod-1", quantity: 1 } }]);

  const statusResult = await client.callTool({ name: "get_my_action_status", arguments: { proposalId: "prop-1" } });
  assert.equal(statusResult.structuredContent.status, "pending");
  assert.deepEqual(backend.accepted, [
    { name: "propose_cart_change", input: { action: "add_item", productId: "prod-1", quantity: 1 } },
    { name: "get_my_action_status", input: { proposalId: "prop-1" } },
  ]);

  // Forged confirmation flags and cross-field violations never create anything:
  // whatever the protocol boundary lets through is refused by the backend's
  // strict schema, and the tool result comes back as an error outcome.
  const forged = await client.callTool({
    name: "propose_cart_change",
    arguments: { action: "add_item", productId: "prod-1", quantity: 1, confirm: true },
  });
  assert.equal(forged.isError, true);
  const crossField = await client.callTool({
    name: "propose_cart_change",
    arguments: { action: "add_item", productId: "prod-1", quantity: 1, cartItemId: "c1" },
  });
  assert.equal(crossField.isError, true);
  assert.equal(backend.accepted.length, 2);
  assert.ok(backend.calls.every(({ input }) => !("confirm" in input) && !("cartItemId" in input) && !("executeNow" in input)));
});
