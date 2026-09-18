// #27: seller price/discount proposals on the #22 platform. Adversarial units
// with a fake client (see assistantCancellationProposals.test.js): ownership
// predicate shape, identical foreign/missing 404, configured bounds incl.
// >100% and negative and same-value denials, verified-seller gate, the absolute
// absence of any commerce write at creation, exact-decimal preview math, and
// the product updatedAt epoch-seconds version proxy.
import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";

import {
  MAX_DISCOUNT_HUNDREDTHS,
  MAX_PRICE_CENTS,
  MIN_PRICE_CENTS,
  parsePriceChangeValue,
  priceChangeRejectionFor,
  priceUpdateDataFor,
  productVersionOf,
  proposePriceChange,
} from "./assistantPriceProposals.js";
import { requireVerifiedSeller } from "./assistantVerifiedSellerPriceGate.js";
import { PROPOSAL_TTL_MS } from "./assistantProposals.js";

const SELLER = "aaaaaaaaaaaaaaaaaaaaaaaa";
const RIVAL = "bbbbbbbbbbbbbbbbbbbbbbbb";
const GRANT = "grant-1";
const now = new Date("2026-09-18T10:00:00Z");
const UPDATED_AT = new Date("2026-09-18T09:59:59.250Z");

const principal = (subject = SELLER, grantId = GRANT) => ({
  subject,
  role: "seller",
  clientId: "shopsphere-mcp-client",
  grantId,
});

const productRow = (overrides = {}) => ({
  id: "prod-1",
  name: "Headphones",
  price: "900.00",
  discount: "10",
  sellerId: SELLER,
  updatedAt: UPDATED_AT,
  ...overrides,
});

// Fake client with hard guards on every commerce-mutation surface: if the
// proposal path ever wrote a product, order, payment, refund, revenue, bill,
// or notification row, the test fails at the write itself. Only the
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
    promoCodeUsage: {
      update: guard("promotions"),
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

test("set_price persists exactly one canonical pending proposal and nothing else", async () => {
  const client = createClient();
  const input = { productId: "prod-1", change: "set_price", newValue: "899.99" };
  const output = await proposePriceChange(input, { client, principal: principal(), now });

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
  assert.equal(data.id, output.proposalId);
  assert.equal(data.subjectId, SELLER);
  assert.equal(data.role, "seller");
  assert.equal(data.clientId, "shopsphere-mcp-client");
  assert.equal(data.grantId, GRANT);
  assert.equal(data.actionKind, "product.set_price");
  assert.equal(data.targetType, "product");
  assert.equal(data.targetId, "prod-1");
  assert.deepEqual(data.canonicalPayload, { productId: "prod-1", change: "set_price", newValue: "899.99" });
  assert.equal(
    data.payloadHash,
    crypto.createHash("sha256").update(JSON.stringify({ productId: "prod-1", change: "set_price", newValue: "899.99" })).digest("hex"),
  );
  assert.equal(data.status, "pending");
  assert.equal(data.expiresAt.getTime(), now.getTime() + PROPOSAL_TTL_MS); // exactly ten minutes
  assert.equal(output.status, "pending");
  assert.equal(output.expiresAt, data.expiresAt.toISOString());
});

test("set_discount persists a product.set_discount proposal with the discount payload", async () => {
  const client = createClient();
  const output = await proposePriceChange(
    { productId: "prod-1", change: "set_discount", newValue: "25" },
    { client, principal: principal(), now },
  );
  assert.equal(client.calls.proposal[0].actionKind, "product.set_discount");
  assert.deepEqual(client.calls.proposal[0].canonicalPayload, {
    productId: "prod-1",
    change: "set_discount",
    newValue: "25",
  });
  assert.equal(output.preview.change, "set_discount");
});

test("the product predicate is the present-day sellerId ownership only", async () => {
  const client = createClient();
  await proposePriceChange({ productId: "prod-1", change: "set_price", newValue: "800" }, { client, principal: principal(), now });

  const where = client.calls.productReads[0].where;
  assert.deepEqual(where, { id: "prod-1", sellerId: SELLER });
  assert.ok(!("OR" in where));
  assert.ok(!("email" in where));
  // The select never reaches past the exact preview projection.
  assert.deepEqual(client.calls.productReads[0].select, {
    id: true,
    name: true,
    price: true,
    discount: true,
    sellerId: true,
    updatedAt: true,
  });
});

test("foreign and missing products are the identical generic 404 and create nothing", async () => {
  // Foreign: another seller's product is indistinguishable from a missing one.
  const foreignClient = createClient();
  await assert.rejects(
    proposePriceChange({ productId: "prod-1", change: "set_price", newValue: "800" }, { client: foreignClient, principal: principal(RIVAL), now }),
    { statusCode: 404, code: "not_found" },
  );
  assert.equal(foreignClient.calls.proposal.length, 0);
  assert.equal(foreignClient.calls.outbox.length, 0);

  const missingClient = createClient({ product: null });
  await assert.rejects(
    proposePriceChange({ productId: "prod-1", change: "set_price", newValue: "800" }, { client: missingClient, principal: principal(), now }),
    { statusCode: 404, code: "not_found" },
  );
  assert.equal(missingClient.calls.proposal.length, 0);
});

test("configured bounds are enforced: below 1, above 999999.99, and malformed prices fail 400", async () => {
  for (const newValue of ["0.99", "0", "1000000", "99999999.99", "-5", "12.505", "abc", ""]) {
    const client = createClient();
    await assert.rejects(
      proposePriceChange({ productId: "prod-1", change: "set_price", newValue }, { client, principal: principal(), now }),
      { statusCode: 400, code: "invalid_input" },
    );
    assert.equal(client.calls.proposal.length, 0, newValue);
    assert.equal(client.calls.outbox.length, 0, newValue);
  }
  // The exact inclusive edges are accepted.
  assert.deepEqual(parsePriceChangeValue("set_price", "1"), { cents: MIN_PRICE_CENTS });
  assert.deepEqual(parsePriceChangeValue("set_price", "999999.99"), { cents: MAX_PRICE_CENTS });
});

test("discount bounds are enforced: >100%, negative, malformed, and the inclusive edges", async () => {
  for (const newValue of ["100.01", "150", "-0.01", "-5", "abc", "100000"]) {
    const client = createClient();
    await assert.rejects(
      proposePriceChange({ productId: "prod-1", change: "set_discount", newValue }, { client, principal: principal(), now }),
      { statusCode: 400, code: "invalid_input" },
    );
    assert.equal(client.calls.proposal.length, 0, newValue);
  }
  assert.deepEqual(parsePriceChangeValue("set_discount", "0"), { cents: 0 });
  assert.deepEqual(parsePriceChangeValue("set_discount", "100"), { cents: MAX_DISCOUNT_HUNDREDTHS });
  assert.equal(parsePriceChangeValue("set_discount", "100.5"), null);
});

test("a value identical to the current value creates NO proposal (deterministic 400)", async () => {
  // Current price 900.00; current discount 10%.
  for (const input of [
    { productId: "prod-1", change: "set_price", newValue: "900" },
    { productId: "prod-1", change: "set_price", newValue: "900.00" },
    { productId: "prod-1", change: "set_discount", newValue: "10" },
    { productId: "prod-1", change: "set_discount", newValue: "10.00" },
  ]) {
    const client = createClient();
    await assert.rejects(
      proposePriceChange(input, { client, principal: principal(), now }),
      { statusCode: 400, code: "invalid_input" },
    );
    assert.equal(client.calls.proposal.length, 0, JSON.stringify(input));
    assert.equal(client.calls.outbox.length, 0, JSON.stringify(input));
  }
});

test("creation mutates nothing: exact-decimal preview for set_price", async () => {
  const client = createClient();
  const output = await proposePriceChange(
    { productId: "prod-1", change: "set_price", newValue: "899.99" },
    { client, principal: principal(), now },
  );
  assert.deepEqual(output.preview, {
    actionKind: "product.set_price",
    currency: "NPR",
    productId: "prod-1",
    productName: "Headphones",
    change: "set_price",
    oldValue: "900",
    newValue: "899.99",
    effectiveDisplayPriceBefore: { amount: "810", currency: "NPR" }, // 900 - 10% = 810 exactly
    effectiveDisplayPriceAfter: { amount: "809.99", currency: "NPR" }, // 899.99 - 10% = 809.991 → 809.99
    disclosedConsequences: [
      "Changes the live listing price from 900 to 899.99 NPR",
      "No orders, payments, or promotions are affected",
    ],
  });
});

test("preview for set_discount keeps the listing price and changes the percentage exactly", async () => {
  const client = createClient({ product: productRow({ price: "999.99", discount: "0" }) });
  const output = await proposePriceChange(
    { productId: "prod-1", change: "set_discount", newValue: "10" },
    { client, principal: principal(), now },
  );
  assert.deepEqual(output.preview.effectiveDisplayPriceBefore, { amount: "999.99", currency: "NPR" });
  // Integer-paisa half-up: 10% of 999.99 is 99.999 → 100.00 discount.
  assert.deepEqual(output.preview.effectiveDisplayPriceAfter, { amount: "899.99", currency: "NPR" });
  assert.deepEqual(output.preview.disclosedConsequences, [
    "Changes the discount percentage from 0% to 10%",
    "No orders, payments, or promotions are affected",
  ]);
});

test("expectedVersion is the productVersionOf updatedAt proxy, shared with execution", async () => {
  const client = createClient();
  await proposePriceChange({ productId: "prod-1", change: "set_price", newValue: "800" }, { client, principal: principal(), now });

  const stored = client.calls.proposal[0].expectedVersion;
  // Epoch seconds (int4-safe), not raw milliseconds, derived exactly as the
  // execution route re-derives it.
  assert.equal(stored, Math.floor(UPDATED_AT.getTime() / 1000));
  assert.equal(productVersionOf({ updatedAt: UPDATED_AT }), stored);
  assert.equal(productVersionOf({ updatedAt: UPDATED_AT.toISOString() }), stored);
  // Any later mutation of the row moves the proxy and would go stale.
  assert.notEqual(productVersionOf({ updatedAt: new Date(UPDATED_AT.getTime() + 1000) }), stored);
});

test("priceChangeRejectionFor is the shared propose/execution business rule", () => {
  const product = productRow();
  assert.equal(priceChangeRejectionFor({ change: "set_price", newValue: "850" }, product), null);
  assert.equal(priceChangeRejectionFor({ change: "set_price", newValue: "900" }, product), "unchanged");
  assert.equal(priceChangeRejectionFor({ change: "set_price", newValue: "0.50" }, product), "out_of_bounds");
  assert.equal(priceChangeRejectionFor({ change: "set_discount", newValue: "20" }, product), null);
  assert.equal(priceChangeRejectionFor({ change: "set_discount", newValue: "10" }, product), "unchanged");
  assert.equal(priceChangeRejectionFor({ change: "set_discount", newValue: "101" }, product), "out_of_bounds");
  assert.equal(priceChangeRejectionFor({ change: "something_else", newValue: "10" }, product), "out_of_bounds");
});

test("priceUpdateDataFor stamps discountUpdatedAt only for set_discount", () => {
  const at = new Date("2026-09-18T12:00:00Z");
  assert.deepEqual(priceUpdateDataFor("set_price", "850", at), { price: "850" });
  assert.deepEqual(priceUpdateDataFor("set_discount", "20", at), { discount: "20", discountUpdatedAt: at });
});

const fakeRes = () => {
  const res = {};
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.set = () => res;
  return res;
};

test("requireVerifiedSeller passes verified sellers and answers audited 403 verification_required otherwise", async () => {
  const next = () => { nextCalled = true; };
  let nextCalled = false;

  const audited = [];
  const audit = async (event) => { audited.push(event); };
  const gate = requireVerifiedSeller({ audit });

  const verifiedReq = {
    requestId: "req-1",
    delegation: { sub: SELLER, role: "seller", clientId: "c", grantId: "g" },
    assistantAccount: { id: SELLER, isVerified: true },
  };
  await gate(verifiedReq, fakeRes(), next);
  assert.equal(nextCalled, true);
  assert.equal(audited.length, 0);

  nextCalled = false;
  const unverifiedReq = {
    requestId: "req-2",
    delegation: { sub: SELLER, role: "seller", clientId: "c", grantId: "g" },
    assistantAccount: { id: SELLER, isVerified: false },
  };
  const res = fakeRes();
  await gate(unverifiedReq, res, next);
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "verification_required");
  assert.equal(audited.length, 1);
  assert.equal(audited[0].operation, "proposals.priceChange");
  assert.equal(audited[0].authorizationOutcome, "denied");
  assert.equal(audited[0].outcome, "verification_required");
});

test("requireVerifiedSeller fails closed when the denial audit cannot be written", async () => {
  const gate = requireVerifiedSeller({ audit: async () => { throw new Error("audit down"); } });
  const req = {
    requestId: "req-3",
    delegation: { sub: SELLER, role: "seller", clientId: "c", grantId: "g" },
    assistantAccount: { id: SELLER, isVerified: false },
  };
  const res = fakeRes();
  await gate(req, res, () => { throw new Error("must not be called"); });
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, "audit_unavailable");
});
