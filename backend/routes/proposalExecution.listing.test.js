// First-party execution tests for the #26 listing proposal branches:
// cross-owner 404, unverified-seller 403, staleness on draft supersede and
// product change, concurrent exactly-once, no notification/draft writes
// (throwing guards), and delegated-token rejection. Mirrors the in-memory
// harness of proposalExecution.test.js with listing tables added.
import assert from "node:assert/strict";
import test from "node:test";
import express from "express";

import { createProposalExecutionRouter } from "./proposalExecutionRoute.js";
import { ASSISTANT_AUDIENCE, OAUTH_ISSUER } from "../utils/mcpOAuth.js";
import { listingProductVersionOf } from "../services/assistantListingProposals.js";

const SELLER = "aaaaaaaaaaaaaaaaaaaaaaaa";
const RIVAL = "bbbbbbbbbbbbbbbbbbbbbbbb";
const GRANT = "grant-1";
const DRAFT_ID = "d4f1a2b3c4d5e6f7a8b9c0d1";
const now = () => new Date();

const storedDescription = "Renewed copy.\n\nHighlights:\n- 18-hour battery";

const publishProposalRow = (overrides = {}) => ({
  id: "prop-lp-1",
  subjectId: SELLER,
  role: "seller",
  clientId: "shopsphere-mcp-client",
  grantId: GRANT,
  actionKind: "listing.publish_draft",
  targetType: "listing_draft",
  targetId: DRAFT_ID,
  canonicalPayload: {
    draftId: DRAFT_ID,
    title: "MacBook Air M2 — renewed",
    description: storedDescription,
    highlights: ["18-hour battery"],
    sourceProductId: null,
  },
  preview: { actionKind: "listing.publish_draft" },
  expectedVersion: 3,
  payloadHash: "a".repeat(64),
  status: "pending",
  expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  executedAt: null,
  executionReference: null,
  createdAt: new Date(Date.now() - 60 * 1000),
  updatedAt: new Date(Date.now() - 60 * 1000),
  ...overrides,
});

const contentProposalRow = (overrides = {}) => ({
  id: "prop-lc-1",
  subjectId: SELLER,
  role: "seller",
  clientId: "shopsphere-mcp-client",
  grantId: GRANT,
  actionKind: "listing.update_content",
  targetType: "product",
  targetId: "prod-1",
  canonicalPayload: { productId: "prod-1", content: { name: "Headphones (2026)", description: "New copy" } },
  preview: { actionKind: "listing.update_content" },
  expectedVersion: listingProductVersionOf(new Date("2026-09-19T09:00:00.000Z")),
  payloadHash: "b".repeat(64),
  status: "pending",
  expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  executedAt: null,
  executionReference: null,
  createdAt: new Date(Date.now() - 60 * 1000),
  updatedAt: new Date(Date.now() - 60 * 1000),
  ...overrides,
});

const draftRow = (overrides = {}) => ({
  id: DRAFT_ID,
  sellerId: SELLER,
  grantId: GRANT,
  status: "Draft",
  version: 3,
  ...overrides,
});

const productRow = (overrides = {}) => ({
  id: "prod-1",
  name: "Headphones",
  description: "Old copy",
  images: ["https://shop.example/img/1.jpg"],
  sellerId: SELLER,
  isArchived: false,
  price: "100.00",
  quantity: 5,
  updatedAt: new Date("2026-09-19T09:00:00.000Z"),
  ...overrides,
});

const createState = ({ verified = true } = {}) => ({
  users: new Map([[SELLER, { id: SELLER, role: "seller", email: "seller@example.com", isVerified: verified }]]),
  products: new Map(),
  drafts: new Map(),
  proposals: new Map(),
  outbox: [],
  productMutations: 0,
});

const seedPublish = (state, { proposal, draft } = {}) => {
  state.proposals.set(proposal?.id ?? "prop-lp-1", proposal ?? publishProposalRow());
  state.drafts.set(DRAFT_ID, draft ?? draftRow());
};

const seedContent = (state, { proposal, product } = {}) => {
  state.proposals.set(proposal?.id ?? "prop-lc-1", proposal ?? contentProposalRow());
  state.products.set("prod-1", product ?? productRow());
};

const createFakeClient = (state, { casFails = false } = {}) => {
  const forbidden = (table, method) => async () => {
    throw new Error(`forbidden write during execution: ${table}.${method}`);
  };
  const tx = {
    user: {
      findUnique: async ({ where }) => { console.error('DEBUG_USER', where.id, JSON.stringify(state.users.get(where.id))); return state.users.get(where.id) ?? null; },
      findMany: forbidden("user", "findMany"),
    },
    notification: {
      create: forbidden("notification", "create"),
      createMany: forbidden("notification", "createMany"),
    },
    listingDraft: {
      findFirst: async ({ where }) => {
        const draft = state.drafts.get(where.id) ?? null;
        if (!draft) return null;
        if (where.sellerId !== undefined && draft.sellerId !== where.sellerId) return null;
        if (where.grantId !== undefined && draft.grantId !== where.grantId) return null;
        return draft;
      },
      // A publish execution must never mutate the draft (status stays Draft).
      update: forbidden("listingDraft", "update"),
      updateMany: forbidden("listingDraft", "updateMany"),
      create: forbidden("listingDraft", "create"),
    },
    product: {
      findFirst: async ({ where }) => {
        const product = state.products.get(where.id) ?? null;
        if (!product) return null;
        if (where.sellerId !== undefined && product.sellerId !== where.sellerId) return null;
        return product;
      },
      findUnique: forbidden("product", "findUnique"),
      create: async ({ data }) => {
        const row = { updatedAt: now(), ...data };
        state.products.set(row.id, row);
        state.productMutations += 1;
        return row;
      },
      // Compare-and-swap on the exact updatedAt the recheck saw; any mutation
      // bumps updatedAt exactly like Prisma's @updatedAt would.
      updateMany: async ({ where, data }) => {
        const product = state.products.get(where.id);
        if (!product) return { count: 0 };
        if (where.sellerId !== undefined && product.sellerId !== where.sellerId) return { count: 0 };
        if (where.updatedAt && product.updatedAt.getTime() !== where.updatedAt.getTime()) return { count: 0 };
        if (casFails) return { count: 0 };
        Object.assign(product, data);
        product.updatedAt = new Date(product.updatedAt.getTime() + 1000);
        state.productMutations += 1;
        return { count: 1 };
      },
      update: forbidden("product", "update"),
      delete: forbidden("product", "delete"),
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
  return {
    state,
    ...tx,
    $transaction: (fn) => {
      const run = chain.then(() => fn(tx));
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
const post = (server, path, headers = {}) =>
  fetch(`${baseUrl(server)}${path}`, { method: "POST", headers, body: "{}" });

const b64url = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const delegatedShapeToken = [
  b64url({ alg: "RS256", typ: "JWT" }),
  b64url({ iss: OAUTH_ISSUER, aud: ASSISTANT_AUDIENCE, sub: SELLER, sid: GRANT, shopsphere_user_id: SELLER, shopsphere_role: "seller", shopsphere_verified: true, exp: 9999999999 }),
  "not-a-real-signature",
].join(".");

test("publish execution creates the live product from the exact stored content, once", async (t) => {
  const client = createFakeClient(createState());
  seedPublish(client.state);
  const server = await listen(client);
  t.after(() => close(server));

  const response = await post(server, "/prop-lp-1/execute");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "executed");
  assert.equal(body.executionReference, "proposal-exec-prop-lp-1");
  // Listing outcomes have no cart version.
  assert.equal("cartVersion" in body, false);

  const created = [...client.state.products.values()][0];
  assert.ok(created);
  assert.equal(created.name, "MacBook Air M2 — renewed");
  assert.equal(created.description, storedDescription);
  assert.equal(created.price, 0);
  assert.equal(created.quantity, 0);
  assert.deepEqual(created.images, []);
  assert.equal(created.category, "Uncategorized");
  assert.equal(created.isArchived, false);
  assert.equal(created.sellerId, SELLER);
  assert.equal(client.state.productMutations, 1);
  assert.equal(client.state.outbox.length, 1);
  assert.equal(client.state.outbox[0].eventType, "executed");
  // The draft itself was never touched.
  assert.equal(client.state.drafts.get(DRAFT_ID).status, "Draft");
  assert.equal(client.state.drafts.get(DRAFT_ID).version, 3);
  assert.equal(client.state.proposals.get("prop-lp-1").status, "executed");

  // Deterministic repeat: identical outcome, no second product.
  const retry = await post(server, "/prop-lp-1/execute");
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), body);
  assert.equal(client.state.productMutations, 1);
  assert.equal(client.state.outbox.length, 1);
});

test("publish execution goes stale (409, no mutation) when the draft was superseded, re-versioned, or lost", async (t) => {
  for (const draft of [
    draftRow({ status: "Superseded" }), // superseded by a later save
    draftRow({ version: 4 }), // saved again: version moved past the pinned one
    draftRow({ sellerId: RIVAL }), // ownership changed
  ]) {
    const client = createFakeClient(createState());
    seedPublish(client.state, { draft });
    const server = await listen(client);
    try {
      const response = await post(server, "/prop-lp-1/execute");
      assert.equal(response.status, 409);
      assert.equal((await response.json()).reason, "stale");
      assert.equal(client.state.productMutations, 0);
      assert.equal(client.state.outbox.length, 1);
      assert.equal(client.state.outbox[0].eventType, "stale");
      assert.equal(client.state.proposals.get("prop-lp-1").status, "stale");
    } finally {
      await close(server);
    }
  }
});

test("content-change execution applies exactly the stored allowlisted fields via the updatedAt CAS", async (t) => {
  const client = createFakeClient(createState());
  seedContent(client.state);
  const server = await listen(client);
  t.after(() => close(server));

  const response = await post(server, "/prop-lc-1/execute");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { status: "executed", executionReference: "proposal-exec-prop-lc-1" });

  const product = client.state.products.get("prod-1");
  assert.equal(product.name, "Headphones (2026)");
  assert.equal(product.description, "New copy");
  // Non-allowlisted state untouched: price, stock, images, archived flag.
  assert.equal(product.price, "100.00");
  assert.equal(product.quantity, 5);
  assert.deepEqual(product.images, ["https://shop.example/img/1.jpg"]);
  assert.equal(product.isArchived, false);
  assert.equal(client.state.productMutations, 1);
  assert.equal(client.state.outbox[0].eventType, "executed");

  const retry = await post(server, "/prop-lc-1/execute");
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), body);
  assert.equal(client.state.productMutations, 1);
});

test("content-change execution goes stale when the product changed after the preview", async (t) => {
  const client = createFakeClient(createState());
  // Concurrent storefront mutation moved updatedAt past the previewed version.
  seedContent(client.state, { product: productRow({ updatedAt: new Date("2026-09-19T09:30:00.000Z") }) });
  const server = await listen(client);
  t.after(() => close(server));

  const response = await post(server, "/prop-lc-1/execute");
  assert.equal(response.status, 409);
  assert.equal((await response.json()).reason, "stale");
  assert.equal(client.state.productMutations, 0);
  assert.equal(client.state.outbox[0].eventType, "stale");
  assert.equal(client.state.proposals.get("prop-lc-1").status, "stale");
  // The concurrent mutation stands untouched.
  assert.equal(client.state.products.get("prod-1").name, "Headphones");
});

test("a lost compare-and-swap (concurrent mutation between recheck and write) leaves the proposal stale and the product untouched", async (t) => {
  const client = createFakeClient(createState(), { casFails: true });
  seedContent(client.state);
  const server = await listen(client);
  t.after(() => close(server));

  const response = await post(server, "/prop-lc-1/execute");
  assert.equal(response.status, 409);
  assert.equal((await response.json()).reason, "stale");
  assert.equal(client.state.productMutations, 0);
  assert.equal(client.state.proposals.get("prop-lc-1").status, "stale");
});

test("concurrent confirmations apply the exact content exactly once", async (t) => {
  const client = createFakeClient(createState());
  seedContent(client.state);
  const server = await listen(client);
  t.after(() => close(server));

  const [first, second] = await Promise.all([post(server, "/prop-lc-1/execute"), post(server, "/prop-lc-1/execute")]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), await first.json());
  assert.equal(client.state.productMutations, 1);
  assert.equal(client.state.outbox.filter((event) => event.eventType === "executed").length, 1);
  assert.equal(client.state.proposals.get("prop-lc-1").status, "executed");
  assert.equal(client.state.products.get("prod-1").name, "Headphones (2026)");
});

test("an unverified seller is answered 403 verification_required and the proposal stays pending", async (t) => {
  for (const actionKind of ["publish", "content"]) {
    const client = createFakeClient(createState({ verified: false }));
    if (actionKind === "publish") seedPublish(client.state); else seedContent(client.state);
    const proposalId = actionKind === "publish" ? "prop-lp-1" : "prop-lc-1";
    const server = await listen(client);
    try {
      const response = await post(server, `/${proposalId}/execute`);
      assert.equal(response.status, 403);
      const body = await response.json();
      assert.equal(body.code, "verification_required");
      assert.equal(client.state.productMutations, 0);
      assert.equal(client.state.outbox.length, 0);
      assert.equal(client.state.proposals.get(proposalId).status, "pending");
    } finally {
      await close(server);
    }
  }
});

test("cross-owner execution is the identical generic 404 with no mutation and no transition", async (t) => {
  const client = createFakeClient(createState());
  seedPublish(client.state);
  seedContent(client.state);
  const server = await listen(client, { userId: RIVAL });
  t.after(() => close(server));

  for (const proposalId of ["prop-lp-1", "prop-lc-1"]) {
    const response = await post(server, `/${proposalId}/execute`);
    assert.equal(response.status, 404);
  }
  assert.equal(client.state.productMutations, 0);
  assert.equal(client.state.outbox.length, 0);
  assert.equal(client.state.proposals.get("prop-lp-1").status, "pending");
  assert.equal(client.state.proposals.get("prop-lc-1").status, "pending");
});

test("delegated MCP tokens are rejected on listing review and execution", async (t) => {
  const client = createFakeClient(createState());
  seedPublish(client.state);
  const server = await listen(client);
  t.after(() => close(server));

  const headers = { authorization: `Bearer ${delegatedShapeToken}` };
  const review = await fetch(`${baseUrl(server)}/prop-lp-1`, { headers });
  assert.equal(review.status, 403);
  assert.equal((await review.json()).code, "delegated_not_allowed");
  const execute = await post(server, "/prop-lp-1/execute", headers);
  assert.equal(execute.status, 403);
  assert.equal(client.state.productMutations, 0);
});

test("listing review exposes the stored preview and the fixed side-effect disclosures", async (t) => {
  const client = createFakeClient(createState());
  seedPublish(client.state);
  seedContent(client.state);
  const server = await listen(client);
  t.after(() => close(server));

  const publish = await (await fetch(`${baseUrl(server)}/prop-lp-1`)).json();
  assert.deepEqual(publish.proposal.disclosures, [
    "Publishes a new live product with exactly the reviewed content",
    "No price or stock is set by this action — configure them in ShopSphere afterward",
    "No notifications are sent",
  ]);
  const content = await (await fetch(`${baseUrl(server)}/prop-lc-1`)).json();
  assert.deepEqual(content.proposal.disclosures, [
    "Applies exactly the reviewed content changes to the live listing",
    "No price, stock, or visibility is changed",
    "No notifications are sent",
  ]);
});
