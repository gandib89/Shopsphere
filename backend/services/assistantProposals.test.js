import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";

import { canonicalPayloadHash, getMyActionStatus, proposeCartChange, PROPOSAL_TTL_MS } from "./assistantProposals.js";
import {
  createProposalLimitStore,
  enforceProposalCreationLimits,
  MAX_PENDING_PROPOSALS,
  PROPOSALS_PER_MINUTE,
} from "./assistantProposalLimits.js";

const BUYER = "aaaaaaaaaaaaaaaaaaaaaaaa";
const RIVAL = "bbbbbbbbbbbbbbbbbbbbbbbb";
const GRANT = "grant-1";
const OTHER_GRANT = "grant-2";
const now = new Date("2026-09-18T10:00:00Z");

const principal = (subject = BUYER, grantId = GRANT) => ({
  subject,
  role: "user",
  clientId: "shopsphere-mcp-client",
  grantId,
});

const product = (overrides = {}) => ({
  id: "prod-1",
  name: "Headphones",
  price: "100.00",
  images: ["img-1"],
  category: "Audio",
  discount: "10.00",
  quantity: 5,
  isArchived: false,
  options: [{ kind: "color", value: "Black", priceDelta: "5.00" }],
  ...overrides,
});

const cartRow = (overrides = {}) => ({
  id: "item-1",
  productId: "prod-1",
  quantity: 2,
  variants: {},
  product: product(),
  ...overrides,
});

// Fake client with a recording proposal/outbox surface and cart/cartItem write
// guards that fail the test if the proposal path ever mutates commerce state.
const createClient = ({ cart = null, productRow = product() } = {}) => {
  const calls = { proposal: [], outbox: [], cartReads: 0 };
  const client = {
    calls,
    cart: {
      findFirst: async () => {
        calls.cartReads += 1;
        return cart;
      },
      update: async () => { throw new Error("proposal path must not update the cart"); },
      create: async () => { throw new Error("proposal path must not create the cart"); },
    },
    cartItem: {
      update: async () => { throw new Error("proposal path must not update cart items"); },
      create: async () => { throw new Error("proposal path must not create cart items"); },
      delete: async () => { throw new Error("proposal path must not delete cart items"); },
      deleteMany: async () => { throw new Error("proposal path must not delete cart items"); },
    },
    product: {
      findUnique: async (args) => (args.where.id === productRow.id ? productRow : null),
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

const addInput = { action: "add_item", productId: "prod-1", quantity: 3 };

test("propose persists exactly one canonical pending proposal and never mutates the cart", async () => {
  const client = createClient({
    cart: { id: "cart-1", userId: BUYER, version: 3, items: [cartRow()] },
  });
  const output = await proposeCartChange(addInput, { client, principal: principal(), now });

  assert.equal(client.calls.proposal.length, 1);
  assert.equal(client.calls.outbox.length, 1);
  assert.deepEqual(client.calls.outbox[0], {
    id: client.calls.outbox[0].id,
    proposalId: output.proposalId,
    eventType: "created",
    payloadHash: canonicalPayloadHash(addInput),
  });

  const data = client.calls.proposal[0];
  assert.equal(data.id, output.proposalId);
  assert.equal(data.subjectId, BUYER);
  assert.equal(data.role, "user");
  assert.equal(data.clientId, "shopsphere-mcp-client");
  assert.equal(data.grantId, GRANT);
  assert.equal(data.actionKind, "cart.add_item");
  assert.equal(data.targetType, "cart");
  assert.equal(data.targetId, null);
  assert.equal(data.expectedVersion, 3);
  assert.equal(data.status, "pending");
  assert.deepEqual(data.canonicalPayload, addInput);
  assert.equal(data.payloadHash, crypto.createHash("sha256").update(JSON.stringify(addInput)).digest("hex"));
  assert.equal(data.expiresAt.getTime(), now.getTime() + PROPOSAL_TTL_MS); // exactly ten minutes
  assert.equal(output.status, "pending");
  assert.equal(output.expiresAt, data.expiresAt.toISOString());
});

test("preview uses exact integer-paisa math for before and after", async () => {
  const client = createClient({
    cart: { id: "cart-1", userId: BUYER, version: 3, items: [cartRow()] },
  });
  const output = await proposeCartChange(addInput, { client, principal: principal(), now });

  // Existing line (100.00 base, 10% discount) merges with 3 more units.
  assert.deepEqual(output.preview, {
    actionKind: "cart.add_item",
    currency: "NPR",
    productName: "Headphones",
    availability: "In stock",
    before: { quantity: 2, unitPrice: { amount: "90", currency: "NPR" }, lineTotal: { amount: "180", currency: "NPR" }, cartSubtotal: { amount: "180", currency: "NPR" } },
    after: { quantity: 5, unitPrice: { amount: "90", currency: "NPR" }, lineTotal: { amount: "450", currency: "NPR" }, cartSubtotal: { amount: "450", currency: "NPR" } },
  });
});

test("option price deltas move the previewed unit price through the shared pricing helpers", async () => {
  const input = { action: "add_item", productId: "prod-1", options: { color: "Black" }, quantity: 1 };
  const client = createClient({
    cart: { id: "cart-1", userId: BUYER, version: 0, items: [cartRow()] },
  });
  const output = await proposeCartChange(input, { client, principal: principal(), now });

  // 100.00 + 5.00 delta = 105.00 list, 10% off -> 94.50; new line, no merge.
  assert.equal(output.preview.before.quantity, null);
  assert.equal(output.preview.before.lineTotal, null);
  assert.deepEqual(output.preview.after.unitPrice, { amount: "94.5", currency: "NPR" });
  assert.deepEqual(output.preview.after.lineTotal, { amount: "94.5", currency: "NPR" });
  assert.deepEqual(output.preview.after.cartSubtotal, { amount: "274.5", currency: "NPR" });
  assert.deepEqual(output.preview.before.cartSubtotal, { amount: "180", currency: "NPR" });
});

test("unknown products are 404, archived and sold-out products propose with honest availability", async () => {
  const unknown = createClient({ cart: { id: "cart-1", userId: BUYER, version: 0, items: [] } });
  await assert.rejects(
    proposeCartChange({ action: "add_item", productId: "prod-x", quantity: 1 }, { client: unknown, principal: principal(), now }),
    { statusCode: 404 },
  );

  const archived = createClient({
    cart: { id: "cart-1", userId: BUYER, version: 0, items: [] },
    productRow: product({ isArchived: true }),
  });
  const archivedOutput = await proposeCartChange(
    { action: "add_item", productId: "prod-1", quantity: 1 },
    { client: archived, principal: principal(), now },
  );
  assert.equal(archivedOutput.preview.availability, "Unavailable");
  assert.deepEqual(archivedOutput.preview.after.unitPrice, { amount: "0", currency: "NPR" });

  const soldOut = createClient({
    cart: { id: "cart-1", userId: BUYER, version: 0, items: [] },
    productRow: product({ quantity: 0 }),
  });
  const soldOutOutput = await proposeCartChange(
    { action: "add_item", productId: "prod-1", quantity: 1 },
    { client: soldOut, principal: principal(), now },
  );
  assert.equal(soldOutOutput.preview.availability, "Sold out");
});

test("update_quantity and remove_item target owned cart lines and reject foreign ones", async () => {
  const base = { id: "cart-1", userId: BUYER, version: 2, items: [cartRow()] };

  const update = createClient({ cart: base });
  const updateOutput = await proposeCartChange(
    { action: "update_quantity", cartItemId: "item-1", quantity: 5 },
    { client: update, principal: principal(), now },
  );
  assert.equal(updateOutput.preview.actionKind, "cart.update_quantity");
  assert.deepEqual(updateOutput.preview.before, { quantity: 2, unitPrice: { amount: "90", currency: "NPR" }, lineTotal: { amount: "180", currency: "NPR" }, cartSubtotal: { amount: "180", currency: "NPR" } });
  assert.deepEqual(updateOutput.preview.after, { quantity: 5, unitPrice: { amount: "90", currency: "NPR" }, lineTotal: { amount: "450", currency: "NPR" }, cartSubtotal: { amount: "450", currency: "NPR" } });
  assert.equal(update.calls.proposal[0].targetType, "cart_item");
  assert.equal(update.calls.proposal[0].targetId, "item-1");

  const remove = createClient({ cart: base });
  const removeOutput = await proposeCartChange(
    { action: "remove_item", cartItemId: "item-1" },
    { client: remove, principal: principal(), now },
  );
  assert.equal(removeOutput.preview.actionKind, "cart.remove_item");
  assert.equal(removeOutput.preview.after.quantity, null);
  assert.equal(removeOutput.preview.after.lineTotal, null);
  assert.deepEqual(removeOutput.preview.after.cartSubtotal, { amount: "0", currency: "NPR" });

  const foreign = createClient({ cart: base });
  await assert.rejects(
    proposeCartChange({ action: "remove_item", cartItemId: "item-other" }, { client: foreign, principal: principal(), now }),
    { statusCode: 404 },
  );
  await assert.rejects(
    proposeCartChange({ action: "update_quantity", cartItemId: "item-other", quantity: 1 }, { client: foreign, principal: principal(), now }),
    { statusCode: 404 },
  );
});

test("the stored canonical payload is the exact validated input, never a rebuilt or caller-swapped one", async () => {
  const input = { action: "add_item", productId: "prod-1", options: { color: "Black", storage: "256GB" }, quantity: 2 };
  const client = createClient({ cart: { id: "cart-1", userId: BUYER, version: 1, items: [] } });
  await proposeCartChange(input, { client, principal: principal(), now });
  const data = client.calls.proposal[0];
  // Key-for-key identical to the strict zod output; the hash is over exactly this JSON.
  assert.deepEqual(data.canonicalPayload, input);
  assert.deepEqual(Object.keys(data.canonicalPayload), ["action", "productId", "options", "quantity"]);
  assert.equal(data.payloadHash, canonicalPayloadHash(data.canonicalPayload));
});

test("action status answers only the owner's bounded current state", async () => {
  const row = {
    id: "prop-1",
    actionKind: "cart.update_quantity",
    status: "pending",
    createdAt: new Date("2026-09-18T09:55:00Z"),
    expiresAt: new Date("2026-09-18T10:05:00Z"),
    executedAt: null,
  };
  const owned = {
    proposal: {
      findFirst: async (args) => {
        if (args.where.id === "prop-1" && args.where.subjectId === BUYER && args.where.grantId === GRANT) return row;
        return null;
      },
    },
  };
  const output = await getMyActionStatus({ proposalId: "prop-1" }, { client: owned, principal: principal(), now });
  assert.deepEqual(Object.keys(output), ["proposalId", "actionKind", "status", "createdAt", "expiresAt", "executedAt", "outcomeReason"]);
  assert.equal(output.status, "pending");
  assert.equal(output.outcomeReason, null);
  assert.equal(output.createdAt, "2026-09-18T09:55:00.000Z");
  assert.ok(!JSON.stringify(output).includes("canonicalPayload"));
  assert.ok(!JSON.stringify(output).includes("preview"));
  assert.ok(!JSON.stringify(output).includes("executionReference"));

  // Cross-subject and cross-grant reads are the identical 404.
  await assert.rejects(
    getMyActionStatus({ proposalId: "prop-1" }, { client: owned, principal: principal(RIVAL), now }),
    { statusCode: 404 },
  );
  await assert.rejects(
    getMyActionStatus({ proposalId: "prop-1" }, { client: owned, principal: principal(BUYER, OTHER_GRANT), now }),
    { statusCode: 404 },
  );
  await assert.rejects(
    getMyActionStatus({ proposalId: "missing" }, { client: owned, principal: principal(), now }),
    { statusCode: 404 },
  );
});

test("status derives expiry for pending rows and classifies terminal reasons", async () => {
  const row = (overrides = {}) => ({
    id: "prop-1",
    actionKind: "cart.add_item",
    status: "pending",
    createdAt: new Date("2026-09-18T09:55:00Z"),
    expiresAt: new Date("2026-09-18T10:05:00Z"),
    executedAt: null,
    ...overrides,
  });
  const client = {
    proposal: { findFirst: async () => row() },
  };
  const expired = await getMyActionStatus(
    { proposalId: "prop-1" },
    { client, principal: principal(), now: new Date("2026-09-18T10:06:00Z") },
  );
  assert.equal(expired.status, "expired");
  assert.equal(expired.outcomeReason, "expired");

  const stale = await getMyActionStatus(
    { proposalId: "prop-1" },
    { client: { proposal: { findFirst: async () => row({ status: "stale" }) } }, principal: principal(), now },
  );
  assert.equal(stale.status, "stale");
  assert.equal(stale.outcomeReason, "cart_version_changed");

  const executed = await getMyActionStatus(
    { proposalId: "prop-1" },
    { client: { proposal: { findFirst: async () => row({ status: "executed", executedAt: new Date("2026-09-18T10:01:00Z") }) } }, principal: principal(), now },
  );
  assert.equal(executed.status, "executed");
  assert.equal(executed.executedAt, "2026-09-18T10:01:00.000Z");
  assert.equal(executed.outcomeReason, null);
});

// --- proposal-class rate limits ---

const fakeRedis = (cap = Infinity) => {
  const counters = new Map();
  return {
    isReady: true,
    counters,
    eval: async (_lua, { keys }) => {
      const key = keys[0];
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return [next > cap ? 0 : 1, 60_000];
    },
  };
};

const actorClient = (pendingCount) => {
  const client = {
    $executeRaw: async () => 0,
    proposal: { count: async () => pendingCount },
  };
  client.$transaction = async (fn) => fn(client);
  return client;
};

const resStub = () => {
  const out = { statusCode: 0, body: null, headers: {} };
  out.set = (key, value) => { out.headers[key] = value; return out; };
  out.status = (code) => { out.statusCode = code; return out; };
  out.json = (body) => { out.body = body; return out; };
  return out;
};

const runMiddleware = (middleware, reqOverrides = {}) => new Promise((resolve) => {
  const req = { delegation: { sub: BUYER, role: "user", clientId: "shopsphere-mcp-client" }, ...reqOverrides };
  const res = resStub();
  middleware(req, res, () => resolve({ nextCalled: true, res }));
  // The middleware is async; settle on the microtask queue.
  setImmediate(() => resolve({ nextCalled: false, res }));
});

test("proposal limits allow up to the per-minute cap per subject+client and deny beyond it", async () => {
  const store = createProposalLimitStore({ redis: fakeRedis(PROPOSALS_PER_MINUTE) });
  for (let index = 0; index < PROPOSALS_PER_MINUTE; index += 1) {
    assert.equal((await store.consume({ subject: BUYER, clientId: "shopsphere-mcp-client" })).allowed, true);
  }
  assert.equal((await store.consume({ subject: BUYER, clientId: "shopsphere-mcp-client" })).allowed, false);
  // Another subject+client pair has its own buckets.
  assert.equal((await store.consume({ subject: RIVAL, clientId: "other-client" })).allowed, true);
});

test("proposal limit middleware fails closed on Redis outage and enforces caps", async () => {
  const failingLoader = async () => { throw new Error("Redis down"); };
  const outage = await runMiddleware(enforceProposalCreationLimits({ redisLoader: failingLoader }));
  assert.equal(outage.nextCalled, false);
  assert.equal(outage.res.statusCode, 503);
  assert.equal(outage.res.body.code, "limit_unavailable");

  const rateLimited = await runMiddleware(enforceProposalCreationLimits({
    redisLoader: async () => fakeRedis(0),
  }));
  assert.equal(rateLimited.nextCalled, false);
  assert.equal(rateLimited.res.statusCode, 429);
  assert.equal(rateLimited.res.body.code, "rate_limited");

  const pendingFull = await runMiddleware(enforceProposalCreationLimits({
    redisLoader: async () => fakeRedis(),
    client: actorClient(MAX_PENDING_PROPOSALS),
  }));
  assert.equal(pendingFull.nextCalled, false);
  assert.equal(pendingFull.res.statusCode, 429);
  assert.equal(pendingFull.res.body.code, "rate_limited");

  const allowed = await runMiddleware(enforceProposalCreationLimits({
    redisLoader: async () => fakeRedis(),
    client: actorClient(MAX_PENDING_PROPOSALS - 1),
  }));
  assert.equal(allowed.nextCalled, true);
});
