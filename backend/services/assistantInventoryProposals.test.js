// #28: seller inventory proposals on the #22 platform. Adversarial units with
// a fake client (see assistantPriceProposals.test.js): ownership predicate
// shape, identical foreign/missing 404 (product and option), option-without-
// stock 400, ambiguous product-level target 400, negative-result 400, the
// required reason, the absolute absence of any commerce write at creation,
// the exact preview counts, the product updatedAt epoch-seconds version proxy,
// and the audit-input projection that keeps the user-authored reason out of
// durable audit rows.
import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";

import {
  INVENTORY_ADJUST_ACTION_KIND,
  MAX_ADJUSTMENT,
  MAX_SET_TO,
  MIN_ADJUSTMENT,
  MIN_SET_TO,
  inventoryAdjustmentRejectionFor,
  proposeInventoryAdjustment,
  proposeInventoryAdjustmentInputSchema,
  requestedCountFor,
  resolveInventoryTarget,
} from "./assistantInventoryProposals.js";
import { productVersionOf } from "./assistantPriceProposals.js";
import { inventoryProposalAuditInput } from "../routes/assistantRoute.js";
import { PROPOSAL_TTL_MS } from "./assistantProposals.js";

const SELLER = "aaaaaaaaaaaaaaaaaaaaaaaa";
const RIVAL = "bbbbbbbbbbbbbbbbbbbbbbbb";
const GRANT = "grant-1";
const now = new Date("2026-09-18T10:00:00Z");
const UPDATED_AT = new Date("2026-09-18T09:59:59.250Z");
const EXPECTED_VERSION = Math.floor(UPDATED_AT.getTime() / 1000);
const REASON = "Supplier delivered twelve extra units of this color on Monday";

const principal = (subject = SELLER, grantId = GRANT) => ({
  subject,
  role: "seller",
  clientId: "shopsphere-mcp-client",
  grantId,
});

const optionRow = (overrides = {}) => ({
  id: "opt-color-1",
  kind: "color",
  value: "Black",
  stock: 7,
  ...overrides,
});

const productRow = (overrides = {}) => ({
  id: "prod-1",
  name: "Headphones",
  quantity: 5,
  sellerId: SELLER,
  updatedAt: UPDATED_AT,
  options: [optionRow()],
  ...overrides,
});

// Fake client with hard guards on every commerce-mutation surface: if the
// proposal path ever wrote a product, option, order, payment, refund, revenue,
// bill, or notification row, the test fails at the write itself. Only the
// proposal/outbox writes and the owned-product read are recorded.
const createClient = ({ product = productRow() } = {}) => {
  const calls = { productReads: [], proposal: [], outbox: [] };
  const guard = (surface) => async () => {
    throw new Error(`proposal path must not write ${surface}`);
  };
  const client = {
    calls,
    product: {
      findFirst: async (args) => {
        calls.productReads.push(args);
        const where = args.where ?? {};
        if (!product) return null;
        if (where.sellerId !== SELLER || where.id !== product.id) return null;
        return product;
      },
      update: guard("the product"),
      updateMany: guard("the product"),
      create: guard("the product"),
      delete: guard("the product"),
    },
    productOption: {
      update: guard("an option"),
      updateMany: guard("an option"),
      create: guard("an option"),
    },
    order: {
      update: guard("an order"),
      updateMany: guard("an order"),
      create: guard("an order"),
    },
    payment: {
      update: guard("payments"),
      create: guard("payments"),
    },
    refund: {
      update: guard("refunds"),
      create: guard("refunds"),
    },
    revenue: {
      update: guard("revenue"),
      updateMany: guard("revenue"),
      create: guard("revenue"),
    },
    bill: {
      update: guard("bills"),
      create: guard("bills"),
    },
    promoCode: {
      update: guard("promotions"),
      updateMany: guard("promotions"),
      create: guard("promotions"),
    },
    notification: {
      create: guard("notifications"),
      update: guard("notifications"),
      updateMany: guard("notifications"),
    },
    proposal: {
      create: async (args) => { calls.proposal.push(args.data); return args.data; },
      findFirst: async () => null,
    },
    proposalOutboxEvent: {
      create: async (args) => { calls.outbox.push(args.data); return args.data; },
    },
  };
  return client;
};

const statusCodeOf = async (promise) => {
  try {
    await promise;
    return null;
  } catch (error) {
    return error.statusCode;
  }
};

test("creation persists exactly one canonical pending proposal and one outbox event, nothing else", async () => {
  const client = createClient();
  const input = { productId: "prod-1", optionId: "opt-color-1", adjustment: -3, reason: REASON };
  const output = await proposeInventoryAdjustment(input, { client, principal: principal(), now });

  assert.equal(client.calls.proposal.length, 1);
  assert.equal(client.calls.outbox.length, 1);
  assert.equal(client.calls.productReads.length, 1);
  assert.deepEqual(client.calls.outbox[0], {
    id: client.calls.outbox[0].id,
    proposalId: output.proposalId,
    eventType: "created",
    payloadHash: client.calls.proposal[0].payloadHash,
  });

  const data = client.calls.proposal[0];
  assert.equal(data.subjectId, SELLER);
  assert.equal(data.role, "seller");
  assert.equal(data.clientId, "shopsphere-mcp-client");
  assert.equal(data.grantId, GRANT);
  assert.equal(data.actionKind, INVENTORY_ADJUST_ACTION_KIND);
  assert.equal(data.targetType, "product_option");
  assert.equal(data.targetId, "opt-color-1");
  assert.deepEqual(data.canonicalPayload, {
    productId: "prod-1",
    optionId: "opt-color-1",
    adjustment: -3,
    setTo: null,
    currentCount: 7,
    requestedCount: 4,
    reason: REASON,
  });
  assert.equal(
    data.payloadHash,
    crypto.createHash("sha256").update(JSON.stringify(data.canonicalPayload)).digest("hex"),
  );
  assert.equal(data.status, "pending");
  assert.deepEqual(data.expiresAt, new Date(now.getTime() + PROPOSAL_TTL_MS));
  // Version proxy: the PARENT product's updatedAt in epoch SECONDS (int4-safe).
  assert.equal(data.expectedVersion, EXPECTED_VERSION);
  assert.equal(data.expectedVersion, productVersionOf(productRow()));
  assert.equal(Number.isInteger(data.expectedVersion), true);

  // Output contract.
  assert.equal(output.status, "pending");
  assert.equal(output.expiresAt, new Date(now.getTime() + PROPOSAL_TTL_MS).toISOString());
  assert.deepEqual(output.preview, {
    actionKind: INVENTORY_ADJUST_ACTION_KIND,
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
  });
});

test("product-level quantity proposals work only when no option tracks stock", async () => {
  const client = createClient({ product: productRow({ options: [] }) });
  const output = await proposeInventoryAdjustment(
    { productId: "prod-1", setTo: 42, reason: REASON },
    { client, principal: principal(), now },
  );
  const data = client.calls.proposal[0];
  assert.equal(data.targetType, "product");
  assert.equal(data.targetId, "prod-1");
  assert.deepEqual(data.canonicalPayload, {
    productId: "prod-1",
    optionId: null,
    adjustment: null,
    setTo: 42,
    currentCount: 5,
    requestedCount: 42,
    reason: REASON,
  });
  assert.equal(data.expectedVersion, EXPECTED_VERSION);
  assert.equal(!("optionId" in output.preview), true);
  assert.equal(!("optionKind" in output.preview), true);
  assert.equal(!("optionValue" in output.preview), true);
  assert.equal(output.preview.currentCount, 5);
  assert.equal(output.preview.requestedCount, 42);
  assert.deepEqual(output.preview.disclosedConsequences, [
    'Sets stock for "Headphones" from 5 to 42 on confirm',
    "Concurrent sales between review and confirm make this proposal stale",
    "No orders or notifications are affected",
  ]);
});

test("a product with stock-tracking options refuses an ambiguous product-level target with 400", async () => {
  const client = createClient();
  assert.equal(await statusCodeOf(proposeInventoryAdjustment(
    { productId: "prod-1", setTo: 42, reason: REASON },
    { client, principal: principal(), now },
  )), 400);
  assert.equal(client.calls.proposal.length, 0);
  assert.equal(client.calls.outbox.length, 0);
});

test("an option that does not track inventory is a deterministic 400, not a 404", async () => {
  const client = createClient({
    product: productRow({ options: [optionRow({ stock: null })] }),
  });
  assert.equal(await statusCodeOf(proposeInventoryAdjustment(
    { productId: "prod-1", optionId: "opt-color-1", adjustment: 1, reason: REASON },
    { client, principal: principal(), now },
  )), 400);
  assert.equal(client.calls.proposal.length, 0);
  assert.equal(client.calls.outbox.length, 0);
});

test("foreign products and foreign/missing option ids are the identical generic 404 (no existence leak)", async () => {
  const foreignProduct = createClient();
  const missingProduct = createClient({ product: null });
  const missingOption = createClient({
    product: productRow({ options: [optionRow({ id: "opt-other" })] }),
  });

  // A product owned by a DIFFERENT seller resolves to null under this
  // principal's sellerId predicate: the identical generic 404.
  assert.equal(await statusCodeOf(proposeInventoryAdjustment(
    { productId: "prod-1", optionId: "opt-color-1", adjustment: 1, reason: REASON },
    { client: foreignProduct, principal: principal(RIVAL), now },
  )), 404);
  assert.equal(foreignProduct.calls.proposal.length, 0);
  assert.equal(foreignProduct.calls.outbox.length, 0);

  // A missing product id: the identical generic 404.
  assert.equal(await statusCodeOf(proposeInventoryAdjustment(
    { productId: "prod-1", optionId: "opt-color-1", adjustment: 1, reason: REASON },
    { client: missingProduct, principal: principal(), now },
  )), 404);
  assert.equal(missingProduct.calls.proposal.length, 0);
  assert.equal(missingProduct.calls.outbox.length, 0);

  // An optionId that does not resolve inside the owned product is the same 404.
  assert.equal(await statusCodeOf(proposeInventoryAdjustment(
    { productId: "prod-1", optionId: "opt-missing", adjustment: 1, reason: REASON },
    { client: missingOption, principal: principal(), now },
  )), 404);
  assert.equal(missingOption.calls.proposal.length, 0);
  assert.equal(missingOption.calls.outbox.length, 0);
});

test("a negative requested count is refused at propose time with 400", async () => {
  const client = createClient();
  assert.equal(await statusCodeOf(proposeInventoryAdjustment(
    { productId: "prod-1", optionId: "opt-color-1", adjustment: -10, reason: REASON },
    { client, principal: principal(), now },
  )), 400);
  assert.equal(client.calls.proposal.length, 0);
  assert.equal(client.calls.outbox.length, 0);
});

test("the reason is required: missing, too short, and over-long are 400", async () => {
  // Option-level target: passes target resolution so only the reason rule is
  // under test.
  const base = { productId: "prod-1", optionId: "opt-color-1", adjustment: 1 };
  for (const reason of [undefined, "", "too short", "x".repeat(501)]) {
    const client = createClient();
    assert.equal(await statusCodeOf(proposeInventoryAdjustment(
      { ...base, reason },
      { client, principal: principal(), now },
    )), 400, `reason ${JSON.stringify(reason)?.slice(0, 20)} must be refused`);
    assert.equal(client.calls.proposal.length, 0);
  }
  // 20 and 500 characters are the inclusive bounds.
  const okMin = createClient();
  await proposeInventoryAdjustment(
    { ...base, reason: "x".repeat(20) },
    { client: okMin, principal: principal(), now },
  );
  assert.equal(okMin.calls.proposal.length, 1);
  const okMax = createClient();
  await proposeInventoryAdjustment(
    { ...base, reason: "x".repeat(500) },
    { client: okMax, principal: principal(), now },
  );
  assert.equal(okMax.calls.proposal.length, 1);
});

test("the strict input schema enforces exactly one change, closed fields, and the bounds", () => {
  const base = { productId: "prod-1", reason: REASON };
  // Exactly one of adjustment/setTo.
  assert.ok(proposeInventoryAdjustmentInputSchema.safeParse({ ...base, adjustment: 1 }).success);
  assert.ok(proposeInventoryAdjustmentInputSchema.safeParse({ ...base, setTo: 5 }).success);
  assert.ok(!proposeInventoryAdjustmentInputSchema.safeParse({ ...base }).success);
  assert.ok(!proposeInventoryAdjustmentInputSchema.safeParse({ ...base, adjustment: 1, setTo: 5 }).success);
  // Confirm/execute and absolute-overwrite affordances never parse.
  assert.ok(!proposeInventoryAdjustmentInputSchema.safeParse({ ...base, adjustment: 1, confirm: true }).success);
  assert.ok(!proposeInventoryAdjustmentInputSchema.safeParse({ ...base, adjustment: 1, execute: true }).success);
  assert.ok(!proposeInventoryAdjustmentInputSchema.safeParse({ ...base, adjustment: 1, stock: 5 }).success);
  // Bounds.
  assert.ok(proposeInventoryAdjustmentInputSchema.safeParse({ ...base, adjustment: MIN_ADJUSTMENT }).success);
  assert.ok(proposeInventoryAdjustmentInputSchema.safeParse({ ...base, adjustment: MAX_ADJUSTMENT }).success);
  assert.ok(!proposeInventoryAdjustmentInputSchema.safeParse({ ...base, adjustment: MIN_ADJUSTMENT - 1 }).success);
  assert.ok(!proposeInventoryAdjustmentInputSchema.safeParse({ ...base, adjustment: MAX_ADJUSTMENT + 1 }).success);
  assert.ok(proposeInventoryAdjustmentInputSchema.safeParse({ ...base, setTo: MIN_SET_TO }).success);
  assert.ok(proposeInventoryAdjustmentInputSchema.safeParse({ ...base, setTo: MAX_SET_TO }).success);
  assert.ok(!proposeInventoryAdjustmentInputSchema.safeParse({ ...base, setTo: MAX_SET_TO + 1 }).success);
  // Non-integer adjustments never parse.
  assert.ok(!proposeInventoryAdjustmentInputSchema.safeParse({ ...base, adjustment: 1.5 }).success);
  // Reason bounds mirror the service.
  assert.ok(!proposeInventoryAdjustmentInputSchema.safeParse({ ...base, adjustment: 1, reason: "x".repeat(19) }).success);
  assert.ok(proposeInventoryAdjustmentInputSchema.safeParse({ ...base, adjustment: 1, reason: "x".repeat(20) }).success);
});

test("shared business-rule helper: bounds, negative results, and exactly-one semantics", () => {
  assert.equal(inventoryAdjustmentRejectionFor({ adjustment: 5 }, 10), null);
  assert.equal(inventoryAdjustmentRejectionFor({ setTo: 0 }, 10), null);
  assert.equal(inventoryAdjustmentRejectionFor({ adjustment: MIN_ADJUSTMENT }, 10000), null);
  assert.equal(inventoryAdjustmentRejectionFor({ adjustment: MAX_ADJUSTMENT + 1 }, 10000), "out_of_bounds");
  assert.equal(inventoryAdjustmentRejectionFor({ adjustment: -11 }, 10), "negative_result");
  assert.equal(inventoryAdjustmentRejectionFor({ setTo: MAX_SET_TO + 1 }, 0), "out_of_bounds");
  assert.equal(inventoryAdjustmentRejectionFor({}, 10), "invalid_change");
  assert.equal(inventoryAdjustmentRejectionFor({ adjustment: 1, setTo: 1 }, 10), "invalid_change");
  // The requested count is always computed from the CURRENT count.
  assert.equal(requestedCountFor({ adjustment: -3 }, 7), 4);
  assert.equal(requestedCountFor({ setTo: 9 }, 7), 9);
});

test("resolveInventoryTarget mirrors the exact option-tracking semantics", () => {
  const tracked = productRow({ options: [optionRow(), optionRow({ id: "opt-b", stock: null })] });
  assert.deepEqual(resolveInventoryTarget(tracked, "opt-color-1"), {
    ok: true,
    currentCount: 7,
    option: tracked.options[0],
  });
  assert.equal(resolveInventoryTarget(tracked, "opt-b").ok, false);
  assert.equal(resolveInventoryTarget(tracked, "opt-b").code, "option_not_tracked");
  assert.equal(resolveInventoryTarget(tracked, null).ok, false);
  assert.equal(resolveInventoryTarget(tracked, null).code, "option_required");
  assert.equal(resolveInventoryTarget(productRow({ options: [] }), null).ok, true);
  assert.equal(resolveInventoryTarget(productRow({ options: [] }), null).currentCount, 5);
  assert.equal(resolveInventoryTarget(productRow({ options: [] }), "opt-x").code, "missing");
});

test("the durable audit input keeps ids and numbers but never the reason", () => {
  const input = { productId: "prod-1", optionId: "opt-color-1", adjustment: -3, reason: REASON };
  assert.deepEqual(inventoryProposalAuditInput(input), {
    productId: "prod-1",
    optionId: "opt-color-1",
    adjustment: -3,
  });
  const setToInput = { productId: "prod-1", setTo: 42, reason: REASON };
  assert.deepEqual(inventoryProposalAuditInput(setToInput), { productId: "prod-1", setTo: 42 });
  assert.equal(!("reason" in inventoryProposalAuditInput(input)), true);
  assert.equal(!("reason" in inventoryProposalAuditInput(setToInput)), true);
  assert.equal(!JSON.stringify(inventoryProposalAuditInput(input)).includes(REASON), true);
});
