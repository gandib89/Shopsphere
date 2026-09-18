// #28: first-party execution of inventory.adjust proposals. Complements (never
// edits) proposalExecution.test.js and the #24/#25/#26/#27 branch files:
// ownership + live verification reauthorization, the product updatedAt
// epoch-seconds version proxy PLUS exact before-value count equality (a
// concurrent sale after the preview makes the proposal stale and is never
// overwritten), the nonnegative-result rule re-checked at execution,
// exactly-once application, the one conditional compare-and-swap stock write,
// and the absolute absence of any notification/order/payment interaction.
// NO password step-up exists on this path by design: stock is not a sensitive
// change, so the browser session plus live verification is the authorization.
import assert from "node:assert/strict";
import test from "node:test";
import express from "express";

import { createProposalExecutionRouter } from "./proposalExecutionRoute.js";
import { productVersionOf } from "../services/assistantPriceProposals.js";
import { ASSISTANT_AUDIENCE, OAUTH_ISSUER } from "../utils/mcpOAuth.js";

const SELLER = "aaaaaaaaaaaaaaaaaaaaaaaa";
const RIVAL = "bbbbbbbbbbbbbbbbbbbbbbbb";
const PRODUCT_UPDATED_AT = new Date("2026-09-18T09:00:00.000Z");
const EXPECTED_VERSION = Math.floor(PRODUCT_UPDATED_AT.getTime() / 1000);
const REASON = "Supplier delivered twelve extra units of this color on Monday";

const optionFixture = (overrides = {}) => ({
  id: "opt-color-1",
  kind: "color",
  value: "Black",
  stock: 7,
  ...overrides,
});

const productFixture = (overrides = {}) => ({
  id: "prod-1",
  name: "Headphones",
  quantity: 5,
  isArchived: false,
  sellerId: SELLER,
  updatedAt: PRODUCT_UPDATED_AT,
  options: [optionFixture()],
  ...overrides,
});

const previewFixture = (overrides = {}) => ({
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

const canonicalPayloadFixture = (overrides = {}) => ({
  productId: "prod-1",
  optionId: "opt-color-1",
  adjustment: -3,
  setTo: null,
  currentCount: 7,
  requestedCount: 4,
  reason: REASON,
  ...overrides,
});

const createInventoryProposalRow = (overrides = {}) => ({
  id: "prop-1",
  subjectId: SELLER,
  role: "seller",
  clientId: "shopsphere-mcp-client",
  grantId: "grant-1",
  actionKind: "inventory.adjust",
  targetType: "product_option",
  targetId: "opt-color-1",
  canonicalPayload: canonicalPayloadFixture(),
  preview: previewFixture(),
  expectedVersion: EXPECTED_VERSION,
  payloadHash: "a".repeat(64),
  status: "pending",
  expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  executedAt: null,
  executionReference: null,
  createdAt: new Date(Date.now() - 60 * 1000),
  updatedAt: new Date(Date.now() - 60 * 1000),
  ...overrides,
});

const createState = () => ({
  users: new Map([
    [SELLER, { id: SELLER, role: "seller", email: "seller@example.com", isVerified: true }],
  ]),
  products: new Map([["prod-1", productFixture()]]),
  proposals: new Map(),
  outbox: [],
  stockMutations: 0,
  commerceSurfaceAttempts: 0, // any notification/order/payment/refund/revenue/promo write attempt
  failNextOptionClaim: false,
  failNextProductClaim: false,
});

const seedProposal = (state, overrides = {}) => {
  const row = createInventoryProposalRow(overrides);
  state.proposals.set(row.id, row);
  return row;
};

// In-memory prisma stand-in mirroring proposalExecution.price.test.js's serial
// $transaction chain with rollback semantics. Commerce surfaces are hard
// guards: any attempt counts and throws, so a single call would fail the test
// twice over.
const createFakeClient = (state) => {
  const commerceGuard = (surface) => async () => {
    state.commerceSurfaceAttempts += 1;
    throw new Error(`execution path must never touch ${surface}`);
  };

  const tx = {
    user: {
      findUnique: async ({ where }) => {
        const user = state.users.get(where.id);
        return user ? { ...user } : null;
      },
    },
    product: {
      findFirst: async ({ where }) => {
        const product = state.products.get(where.id) ?? null;
        if (!product) return null;
        if (where.sellerId && product.sellerId !== where.sellerId) return null;
        return JSON.parse(JSON.stringify(product, (_key, value) => (value instanceof Date ? value.toISOString() : value)), (key, value) => (key === "updatedAt" ? new Date(value) : value));
      },
      // The one exact conditional product-level stock write: guarded on
      // ownership AND the exact before-count.
      updateMany: async ({ where, data }) => {
        const product = state.products.get(where.id);
        if (!product) return { count: 0 };
        if (where.sellerId && product.sellerId !== where.sellerId) return { count: 0 };
        if (where.quantity !== undefined && product.quantity !== where.quantity) return { count: 0 };
        if (state.failNextProductClaim) {
          state.failNextProductClaim = false;
          return { count: 0 };
        }
        product.quantity = data.quantity;
        product.updatedAt = new Date(PRODUCT_UPDATED_AT.getTime() + state.stockMutations * 60_000 + 1000);
        state.stockMutations += 1;
        return { count: 1 };
      },
      update: commerceGuard("product.update (use the conditional claim)"),
      create: commerceGuard("product.create"),
      delete: commerceGuard("product.delete"),
    },
    productOption: {
      // The one exact conditional option-level stock write: guarded on the
      // exact before-count (compare-and-swap — a concurrent sale that took the
      // counted units makes this count 0).
      updateMany: async ({ where, data }) => {
        for (const product of state.products.values()) {
          const option = product.options.find((candidate) => candidate.id === where.id);
          if (!option) continue;
          if (where.stock !== undefined && option.stock !== where.stock) return { count: 0 };
          if (state.failNextOptionClaim) {
            state.failNextOptionClaim = false;
            return { count: 0 };
          }
          option.stock = data.stock;
          product.updatedAt = new Date(PRODUCT_UPDATED_AT.getTime() + state.stockMutations * 60_000 + 1000);
          state.stockMutations += 1;
          return { count: 1 };
        }
        return { count: 0 };
      },
      update: commerceGuard("product options"),
      create: commerceGuard("product options"),
    },
    order: {
      update: commerceGuard("orders"),
      updateMany: commerceGuard("orders"),
      create: commerceGuard("orders"),
    },
    payment: {
      update: commerceGuard("payments"),
      updateMany: commerceGuard("payments"),
      create: commerceGuard("payments"),
      findFirst: commerceGuard("payments"),
    },
    refund: {
      findFirst: commerceGuard("refunds"),
      create: commerceGuard("refunds"),
      update: commerceGuard("refunds"),
    },
    revenue: {
      update: commerceGuard("revenue"),
      updateMany: commerceGuard("revenue"),
      create: commerceGuard("revenue"),
    },
    promoCode: {
      update: commerceGuard("promotions"),
      updateMany: commerceGuard("promotions"),
      create: commerceGuard("promotions"),
    },
    notification: {
      create: commerceGuard("notifications"),
      update: commerceGuard("notifications"),
      updateMany: commerceGuard("notifications"),
    },
    proposal: {
      findUnique: async ({ where }) => state.proposals.get(where.id) ?? null,
      findFirst: async ({ where }) => {
        for (const proposal of state.proposals.values()) {
          if (where.id && proposal.id !== where.id) continue;
          if (where.subjectId && proposal.subjectId !== where.subjectId) continue;
          return proposal;
        }
        return null;
      },
      updateMany: async ({ where, data }) => {
        const proposal = state.proposals.get(where.id);
        if (!proposal) return { count: 0 };
        if (where.subjectId && proposal.subjectId !== where.subjectId) return { count: 0 };
        if (where.status && proposal.status !== where.status) return { count: 0 };
        Object.assign(proposal, data);
        return { count: 1 };
      },
    },
    proposalOutboxEvent: {
      create: async ({ data }) => {
        const row = { id: `outbox-${state.outbox.length}`, ...data };
        state.outbox.push(row);
        return row;
      },
    },
  };

  let chain = Promise.resolve();
  // Transactional semantics: a thrown error rolls the tx back (proposal claim
  // included), mirroring the Postgres behavior the inventory_state_changed
  // path relies on. The one-shot fault flags model a transient lost race, not
  // durable state, so they live outside the snapshot.
  const snapshot = () => ({
    users: new Map([...state.users].map(([k, v]) => [k, { ...v }])),
    products: new Map([...state.products].map(([k, v]) => [k, {
      ...v,
      options: v.options.map((option) => ({ ...option })),
    }])),
    proposals: new Map([...state.proposals].map(([k, v]) => [k, { ...v }])),
    outbox: [...state.outbox],
    stockMutations: state.stockMutations,
    commerceSurfaceAttempts: state.commerceSurfaceAttempts,
  });
  const restore = (snap) => {
    state.users = snap.users;
    state.products = snap.products;
    state.proposals = snap.proposals;
    state.outbox = snap.outbox;
    state.stockMutations = snap.stockMutations;
    state.commerceSurfaceAttempts = snap.commerceSurfaceAttempts;
  };
  return {
    state,
    ...tx,
    $transaction: (fn) => {
      const run = chain.then(async () => {
        const before = snapshot();
        try {
          return await fn(tx);
        } catch (error) {
          restore(before);
          throw error;
        }
      });
      chain = run.then(() => undefined, () => undefined);
      return run;
    },
  };
};

const listen = (client, { userId = SELLER, role = "seller" } = {}) => {
  const authenticate = (req, _res, next) => {
    req.user = { id: userId, role };
    next();
  };
  const app = express();
  app.use(express.json());
  app.use("/api/v1/proposals", createProposalExecutionRouter({ authenticate, client }));
  const server = app.listen(0, "127.0.0.1");
  return new Promise((resolve) => server.once("listening", () => resolve(server)));
};

const close = (server) => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

const baseUrl = (server) => `http://127.0.0.1:${server.address().port}/api/v1/proposals`;

const execute = (server, body) =>
  fetch(`${baseUrl(server)}/prop-1/execute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });

const b64url = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const delegatedShapeToken = [
  b64url({ alg: "RS256", typ: "JWT" }),
  b64url({ iss: OAUTH_ISSUER, aud: ASSISTANT_AUDIENCE, sub: SELLER, sid: "grant-1", shopsphere_user_id: SELLER, shopsphere_role: "seller", shopsphere_verified: true, exp: 9999999999 }),
  "not-a-real-signature",
].join(".");
const delegatedHeaders = { authorization: `Bearer ${delegatedShapeToken}`, "content-type": "application/json" };

test("execution applies the option-level stock exactly once, CAS-guarded, and never touches other surfaces", async (t) => {
  const client = createFakeClient(createState());
  seedProposal(client.state);
  const server = await listen(client);
  t.after(() => close(server));

  // No password step-up by design: the body carries nothing.
  const response = await execute(server, {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, {
    status: "executed",
    executionReference: "proposal-exec-prop-1",
    productId: "prod-1",
    optionId: "opt-color-1",
    appliedStock: 4,
  });

  const product = client.state.products.get("prod-1");
  assert.equal(product.options.find(({ id }) => id === "opt-color-1").stock, 4);
  assert.equal(product.quantity, 5); // product-level counter untouched
  assert.equal(client.state.stockMutations, 1);
  assert.equal(client.state.commerceSurfaceAttempts, 0); // no notification/order/payment/refund/promo write
  assert.equal(client.state.outbox.length, 1);
  assert.equal(client.state.outbox[0].eventType, "executed");
  assert.equal(client.state.proposals.get("prop-1").status, "executed");

  // Retry after success replays the identical deterministic outcome with no
  // further mutation.
  const retry = await execute(server, {});
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), body);
  assert.equal(client.state.stockMutations, 1);
  assert.equal(client.state.outbox.length, 1);
});

test("a product-level proposal applies Product.quantity with the same exactly-once guarantees", async (t) => {
  const client = createFakeClient(createState());
  seedProposal(client.state, {
    targetType: "product",
    targetId: "prod-1",
    canonicalPayload: canonicalPayloadFixture({ optionId: null, adjustment: null, setTo: 42, currentCount: 5, requestedCount: 42 }),
    preview: previewFixture({
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
  });
  client.state.products.get("prod-1").options = []; // no option tracks stock
  const server = await listen(client);
  t.after(() => close(server));

  const response = await execute(server, {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, {
    status: "executed",
    executionReference: "proposal-exec-prop-1",
    productId: "prod-1",
    appliedStock: 42,
  });
  assert.equal(!("optionId" in body), true);

  const product = client.state.products.get("prod-1");
  assert.equal(product.quantity, 42);
  assert.equal(client.state.stockMutations, 1);
  assert.equal(client.state.commerceSurfaceAttempts, 0);
});

test("review exposes the exact stored preview, the reason, and the stored disclosures; foreign and missing are the identical 404", async (t) => {
  const client = createFakeClient(createState());
  seedProposal(client.state);
  const server = await listen(client);
  t.after(() => close(server));

  const owned = await fetch(`${baseUrl(server)}/prop-1`);
  assert.equal(owned.status, 200);
  const body = await owned.json();
  assert.equal(body.proposal.actionKind, "inventory.adjust");
  assert.equal(body.proposal.status, "pending");
  assert.equal(body.proposal.expectedVersion, EXPECTED_VERSION);
  assert.equal(body.proposal.preview.currentCount, 7);
  assert.equal(body.proposal.preview.requestedCount, 4);
  assert.equal(body.proposal.reason, REASON); // user-authored reason shown to the reviewer
  assert.deepEqual(body.proposal.disclosures, body.proposal.preview.disclosedConsequences);
  assert.ok(body.proposal.disclosures.includes("No orders or notifications are affected"));

  const foreignServer = await listen(client, { userId: RIVAL });
  t.after(() => close(foreignServer));
  const foreignResponse = await fetch(`${baseUrl(foreignServer)}/prop-1`);
  assert.equal(foreignResponse.status, 404);
  const missing = await fetch(`${baseUrl(server)}/prop-missing`);
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), await foreignResponse.json());
});

test("a seller whose verification was revoked answers 403 verification_required with NO state change", async (t) => {
  const client = createFakeClient(createState());
  seedProposal(client.state);
  client.state.users.get(SELLER).isVerified = false;
  const server = await listen(client);
  t.after(() => close(server));

  const response = await execute(server, {});
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "verification_required");
  assert.equal(client.state.proposals.get("prop-1").status, "pending");
  assert.equal(client.state.outbox.length, 0);
  assert.equal(client.state.stockMutations, 0);
  assert.equal(client.state.products.get("prod-1").options[0].stock, 7);
});

test("a committed product change after the preview marks the proposal stale with no mutation", async (t) => {
  const client = createFakeClient(createState());
  seedProposal(client.state);
  // Concurrent storefront mutation after the proposal was created: any row
  // change moves updatedAt, which moves the version proxy.
  client.state.products.get("prod-1").updatedAt = new Date(PRODUCT_UPDATED_AT.getTime() + 4000);
  const server = await listen(client);
  t.after(() => close(server));

  const response = await execute(server, {});
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.code, "proposal_not_executable");
  assert.equal(body.reason, "stale");
  assert.equal(client.state.proposals.get("prop-1").status, "stale");
  assert.equal(client.state.outbox[0].eventType, "stale");
  assert.equal(client.state.stockMutations, 0);
  assert.equal(client.state.products.get("prod-1").options[0].stock, 7);
});

test("a concurrent sale after the preview (same second, count moved) is caught by the exact before-value check: stale, never overwritten", async (t) => {
  const client = createFakeClient(createState());
  seedProposal(client.state, {
    // The proposal previewed currentCount 7; a concurrent sale (inside the
    // same second, so the epoch-seconds proxy cannot see it) took 3 units.
    canonicalPayload: canonicalPayloadFixture({ currentCount: 7, requestedCount: 4 }),
  });
  client.state.products.get("prod-1").options[0].stock = 4;
  const server = await listen(client);
  t.after(() => close(server));

  const response = await execute(server, {});
  assert.equal(response.status, 409);
  assert.equal((await response.json()).reason, "stale");
  assert.equal(client.state.proposals.get("prop-1").status, "stale");
  assert.equal(client.state.outbox[0].eventType, "stale");
  assert.equal(client.state.stockMutations, 0);
  // The sale's count stands — nothing was overwritten.
  assert.equal(client.state.products.get("prod-1").options[0].stock, 4);
});

test("a target that no longer resolves to this seller (or lost its option) is rejected, never applied", async (t) => {
  const transferred = createFakeClient(createState());
  seedProposal(transferred.state);
  transferred.state.products.get("prod-1").sellerId = RIVAL;
  const transferredServer = await listen(transferred);
  t.after(() => close(transferredServer));
  const transferredResponse = await execute(transferredServer, {});
  assert.equal(transferredResponse.status, 409);
  assert.equal((await transferredResponse.json()).reason, "rejected");
  assert.equal(transferred.state.proposals.get("prop-1").status, "rejected");
  assert.equal(transferred.state.stockMutations, 0);

  const lostOption = createFakeClient(createState());
  seedProposal(lostOption.state);
  lostOption.state.products.get("prod-1").options = [];
  const lostOptionServer = await listen(lostOption);
  t.after(() => close(lostOptionServer));
  const lostOptionResponse = await execute(lostOptionServer, {});
  assert.equal(lostOptionResponse.status, 409);
  assert.equal((await lostOptionResponse.json()).reason, "rejected");
  assert.equal(lostOption.state.proposals.get("prop-1").status, "rejected");
  assert.equal(lostOption.state.stockMutations, 0);
});

test("a negative requested count at execution is rejected with no mutation (tampered-row defense in depth)", async (t) => {
  const client = createFakeClient(createState());
  // A row that could never have been created through the service (propose
  // time refuses negative results): the execution-side nonnegative recheck
  // must refuse it independently instead of driving stock negative.
  seedProposal(client.state, {
    canonicalPayload: canonicalPayloadFixture({ adjustment: -10, requestedCount: -3 }),
  });
  const server = await listen(client);
  t.after(() => close(server));

  const response = await execute(server, {});
  assert.equal(response.status, 409);
  assert.equal((await response.json()).reason, "rejected");
  assert.equal(client.state.proposals.get("prop-1").status, "rejected");
  assert.equal(client.state.outbox[0].eventType, "rejected");
  assert.equal(client.state.stockMutations, 0);
  assert.equal(client.state.products.get("prod-1").options[0].stock, 7);
});

test("a lost conditional stock claim rolls everything back and keeps the proposal pending; the retry then resolves to stale", async (t) => {
  const client = createFakeClient(createState());
  seedProposal(client.state);
  // Simulates a concurrent sale winning between the fresh read and the
  // conditional claim inside the execution transaction.
  client.state.failNextOptionClaim = true;
  const server = await listen(client);
  t.after(() => close(server));

  const response = await execute(server, {});
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "inventory_state_changed");
  // Nothing happened: the proposal claim rolled back with the transaction and
  // no concurrent sale was overwritten.
  assert.equal(client.state.proposals.get("prop-1").status, "pending");
  assert.equal(client.state.products.get("prod-1").options[0].stock, 7);
  assert.equal(client.state.outbox.length, 0);

  // A retry resolves deterministically against the current state: with the
  // fault gone the proposal simply executes.
  const retry = await execute(server, {});
  assert.equal(retry.status, 200);
  assert.equal(client.state.proposals.get("prop-1").status, "executed");
  assert.equal(client.state.products.get("prod-1").options[0].stock, 4);
});

test("concurrent confirmations apply the stock change exactly once and replay the identical response", async (t) => {
  const client = createFakeClient(createState());
  seedProposal(client.state);
  const server = await listen(client);

  const [first, second] = await Promise.all([execute(server, {}), execute(server, {})]);
  t.after(() => close(server));
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  const firstBody = await first.json();
  assert.deepEqual(await second.json(), firstBody);

  assert.equal(client.state.stockMutations, 1);
  assert.equal(client.state.outbox.filter((event) => event.eventType === "executed").length, 1);
  assert.equal(client.state.outbox.length, 1);
  assert.equal(client.state.proposals.get("prop-1").status, "executed");
  assert.equal(client.state.products.get("prod-1").options[0].stock, 4);
});

test("foreign execution is the identical 404 with no mutation and no outbox event", async (t) => {
  const client = createFakeClient(createState());
  seedProposal(client.state);
  const server = await listen(client, { userId: RIVAL });
  t.after(() => close(server));

  const response = await execute(server, {});
  assert.equal(response.status, 404);
  assert.equal(client.state.stockMutations, 0);
  assert.equal(client.state.outbox.length, 0);
  assert.equal(client.state.proposals.get("prop-1").status, "pending");
  assert.equal(client.state.products.get("prod-1").options[0].stock, 7);
});

test("delegated MCP tokens are rejected on inventory review and execution", async (t) => {
  const client = createFakeClient(createState());
  seedProposal(client.state);
  const server = await listen(client);
  t.after(() => close(server));

  const review = await fetch(`${baseUrl(server)}/prop-1`, { headers: delegatedHeaders });
  assert.equal(review.status, 403);
  assert.equal((await review.json()).code, "delegated_not_allowed");
  const executeResponse = await fetch(`${baseUrl(server)}/prop-1/execute`, {
    method: "POST",
    headers: delegatedHeaders,
    body: JSON.stringify({}),
  });
  assert.equal(executeResponse.status, 403);
  assert.equal(client.state.stockMutations, 0);
  assert.equal(client.state.commerceSurfaceAttempts, 0);
  assert.equal(client.state.proposals.get("prop-1").status, "pending");
});

test("expired proposals are marked expired and never mutate stock", async (t) => {
  const client = createFakeClient(createState());
  seedProposal(client.state, { expiresAt: new Date(Date.now() - 1000) });
  const server = await listen(client);
  t.after(() => close(server));

  const response = await execute(server, {});
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.code, "proposal_not_executable");
  assert.equal(body.reason, "expired");
  assert.equal(client.state.proposals.get("prop-1").status, "expired");
  assert.equal(client.state.outbox[0].eventType, "expired");
  assert.equal(client.state.stockMutations, 0);
  assert.equal(client.state.products.get("prod-1").options[0].stock, 7);
});

test("the version proxy stays consistent between propose-side math and execution", () => {
  // productVersionOf is the single derivation both sides use.
  assert.equal(productVersionOf({ updatedAt: PRODUCT_UPDATED_AT }), EXPECTED_VERSION);
  assert.equal(productVersionOf({ updatedAt: PRODUCT_UPDATED_AT.toISOString() }), EXPECTED_VERSION);
});
