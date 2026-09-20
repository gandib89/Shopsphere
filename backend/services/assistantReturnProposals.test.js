import assert from "node:assert/strict";
import test from "node:test";

import {
  approvedReturnWindow,
  isOrderReturnEligible,
  orderVersionProxy,
  proposeOrderReturn,
  RETURN_ACTION_KIND,
  RETURN_DISCLOSURES,
} from "./assistantReturnProposals.js";
import { canonicalPayloadHash, PROPOSAL_TTL_MS } from "./assistantProposals.js";
import { returnProposalAuditInput } from "../routes/assistantRoute.js";

const BUYER = "aaaaaaaaaaaaaaaaaaaaaaaa";
const RIVAL = "bbbbbbbbbbbbbbbbbbbbbbbb";
const GRANT = "grant-1";
const now = new Date("2026-09-18T10:00:00Z");

const principal = (subject = BUYER, grantId = GRANT) => ({
  subject,
  role: "user",
  clientId: "shopsphere-mcp-client",
  grantId,
});

// The approved returns policy answer served by services/assistantPolicy.js
// (faqs.json#0, cited as faqs.json#1), pinned here so the test fails if the
// window semantics drift without the service following.
const approvedPolicy = Object.freeze({
  topic: "returns",
  answer: "You can return any product within 7 days of delivery as long as it is unused and in its original packaging. Contact us at support@shopsphere.com to initiate a return.",
  sources: Object.freeze([{ sourceId: "faqs.json#1", sourceVersion: "1.0.0" }]),
});
const policySource = async () => approvedPolicy;

const deliveredOrder = (overrides = {}) => {
  const updatedAt = new Date("2026-09-15T09:30:00Z");
  return {
    id: "order-1",
    orderNumber: "ORD-2026-0042",
    status: "Delivered",
    totalPrice: "1299.00",
    deliveredAt: new Date("2026-09-15T12:00:00Z"), // 3 days before `now`
    returnRequestedAt: null,
    updatedAt,
    ...overrides,
  };
};

const input = { orderId: "order-1", reason: "The left earcup arrived cracked." };

// Fake client with a recording proposal/outbox surface and hard guards on every
// commerce/notification write: if the proposal path ever mutated live order
// state, created a notification, or touched payments/refunds, the test fails.
const createClient = ({ orderRow = deliveredOrder(), subject = BUYER } = {}) => {
  const calls = { orderReads: [], proposal: [], outbox: [] };
  const client = {
    calls,
    order: {
      findFirst: async (args) => {
        calls.orderReads.push(args);
        // Mirror the buyer-ownership predicate: only the caller's own rows exist.
        if (!orderRow || args.where?.userId !== subject || args.where?.id !== orderRow.id) return null;
        return orderRow;
      },
      update: async () => { throw new Error("proposal path must not update the order"); },
      updateMany: async () => { throw new Error("proposal path must not update the order"); },
      create: async () => { throw new Error("proposal path must not create orders"); },
    },
    notification: {
      create: async () => { throw new Error("proposal path must not create notifications"); },
      createMany: async () => { throw new Error("proposal path must not create notifications"); },
    },
    payment: {
      update: async () => { throw new Error("proposal path must not touch payments"); },
    },
    refund: {
      create: async () => { throw new Error("proposal path must not create refunds"); },
    },
    proposal: {
      create: async (args) => { calls.proposal.push(args.data); return args.data; },
      findFirst: async () => null,
      update: async () => { throw new Error("proposal path must not update proposals"); },
    },
    proposalOutboxEvent: {
      create: async (args) => { calls.outbox.push(args.data); return args.data; },
    },
  };
  return client;
};

test("propose persists exactly one canonical pending proposal row and nothing else", async () => {
  const client = createClient();
  const output = await proposeOrderReturn(input, { client, principal: principal(), policySource, now });

  assert.equal(client.calls.proposal.length, 1);
  assert.equal(client.calls.outbox.length, 1);
  assert.deepEqual(client.calls.outbox[0], {
    id: client.calls.outbox[0].id,
    proposalId: output.proposalId,
    eventType: "created",
    payloadHash: canonicalPayloadHash(input),
  });

  const data = client.calls.proposal[0];
  assert.equal(data.id, output.proposalId);
  assert.equal(data.subjectId, BUYER);
  assert.equal(data.role, "user");
  assert.equal(data.clientId, "shopsphere-mcp-client");
  assert.equal(data.grantId, GRANT);
  assert.equal(data.actionKind, RETURN_ACTION_KIND);
  assert.equal(data.targetType, "order");
  assert.equal(data.targetId, "order-1");
  assert.equal(data.status, "pending");
  assert.deepEqual(data.canonicalPayload, input);
  assert.equal(data.payloadHash, canonicalPayloadHash(input));
  assert.equal(data.expiresAt.getTime(), now.getTime() + PROPOSAL_TTL_MS); // exactly ten minutes
  assert.equal(output.status, "pending");
  assert.equal(output.expiresAt, data.expiresAt.toISOString());
});

test("the ownership predicate is the immutable buyer attribution only", async () => {
  const client = createClient();
  await proposeOrderReturn(input, { client, principal: principal(), policySource, now });

  assert.equal(client.calls.orderReads.length, 1);
  const where = client.calls.orderReads[0].where;
  // Exactly { id, userId } — no OR fallback, no email path, no seller join.
  assert.deepEqual(where, { id: "order-1", userId: BUYER });
  assert.ok(!("OR" in where));
  assert.ok(!("email" in where));
  assert.ok(!("sellerIdAtPurchase" in where));
});

test("foreign and missing orders are the identical generic 404", async () => {
  const foreign = createClient({ subject: RIVAL });
  const missing = createClient({ orderRow: null });
  for (const client of [foreign, missing]) {
    await assert.rejects(
      proposeOrderReturn(input, { client, principal: principal(), policySource, now }),
      (error) => {
        assert.equal(error.statusCode, 404);
        assert.equal(error.code, "not_found");
        assert.equal(error.message, "Resource not found");
        return true;
      },
    );
    assert.equal(client.calls.proposal.length, 0);
    assert.equal(client.calls.outbox.length, 0);
  }
});

test("ineligible owned orders are a deterministic 409 not_return_eligible with no proposal row", async () => {
  const cases = [
    deliveredOrder({ status: "Shipped" }), // not delivered yet
    deliveredOrder({ status: "Return Requested" }), // already in the return lifecycle
    deliveredOrder({ returnRequestedAt: new Date("2026-09-16T08:00:00Z") }), // request already exists
    deliveredOrder({ deliveredAt: null }), // window cannot be established
    deliveredOrder({ deliveredAt: new Date("2026-09-10T23:00:00Z") }), // 7 days + 1 hour ago
  ];
  for (const orderRow of cases) {
    const client = createClient({ orderRow });
    await assert.rejects(
      proposeOrderReturn(input, { client, principal: principal(), policySource, now }),
      (error) => {
        assert.equal(error.statusCode, 409);
        assert.equal(error.code, "not_return_eligible");
        return true;
      },
    );
    assert.equal(client.calls.proposal.length, 0, `no proposal for status ${orderRow.status}`);
    assert.equal(client.calls.outbox.length, 0);
  }
});

test("the preview math honors the policy window: eligible within it, boundary inclusive", async () => {
  // Exactly 7 days after delivery is still inside ("within 7 days").
  const atBoundary = new Date(deliveredOrder().deliveredAt.getTime() + 7 * 24 * 60 * 60 * 1000);
  const client = createClient();
  const output = await proposeOrderReturn(input, { client, principal: principal(), policySource, now: atBoundary });
  assert.equal(output.preview.returnEligible, true);
  assert.equal(client.calls.proposal.length, 1);
});

test("the preview carries the exact server-computed order facts and policy citations", async () => {
  const client = createClient();
  const output = await proposeOrderReturn(input, { client, principal: principal(), policySource, now });

  assert.deepEqual(output.preview, {
    orderId: "order-1",
    orderNumber: "ORD-2026-0042",
    currentStatus: "Delivered", // exact stored storefront string
    returnEligible: true,
    orderTotal: { amount: "1299", currency: "NPR" }, // exact money contract, no floats
    policyBasis: [{ sourceId: "faqs.json#1", sourceVersion: "1.0.0" }],
    disclosedConsequences: [...RETURN_DISCLOSURES],
  });
  // The stored preview is the identical server-computed object.
  assert.deepEqual(client.calls.proposal[0].preview, output.preview);
  assert.equal(client.calls.proposal[0].expectedVersion, orderVersionProxy(deliveredOrder()));
});

test("an ungrounded policy fails closed with 503 and no proposal row", async () => {
  const client = createClient();
  await assert.rejects(
    proposeOrderReturn(input, {
      client,
      principal: principal(),
      policySource: async () => ({ topic: "returns", answer: "Ask support.", sources: [] }),
      now,
    }),
    (error) => {
      assert.equal(error.statusCode, 503);
      return true;
    },
  );
  assert.equal(client.calls.proposal.length, 0);
});

test("no evidence URL, image, attachment, or confirmation field exists anywhere", async () => {
  const client = createClient();
  const output = await proposeOrderReturn(input, { client, principal: principal(), policySource, now });

  const serialized = JSON.stringify({ output, stored: client.calls.proposal[0] });
  for (const banned of ["evidenceUrl", "imageUrl", "image", "attachment", "returnImage", "confirm", "executeNow"]) {
    assert.ok(!serialized.includes(banned), `unexpected field: ${banned}`);
  }
  assert.deepEqual(Object.keys(output), ["proposalId", "status", "expiresAt", "preview"]);
});

test("isOrderReturnEligible enforces the approved window semantics exactly", async () => {
  const delivered = deliveredOrder();
  const windowDays = approvedReturnWindow(approvedPolicy).windowDays;
  assert.equal(windowDays, 7);
  const at = (days) => new Date(delivered.deliveredAt.getTime() + days * 24 * 60 * 60 * 1000);
  assert.equal(isOrderReturnEligible(delivered, { now: at(0), windowDays }), true);
  assert.equal(isOrderReturnEligible(delivered, { now: at(6.999), windowDays }), true);
  assert.equal(isOrderReturnEligible(delivered, { now: at(7), windowDays }), true);
  assert.equal(isOrderReturnEligible(delivered, { now: at(7.001), windowDays }), false);
  assert.equal(isOrderReturnEligible(deliveredOrder({ status: "Delivered", returnRequestedAt: at(1) }), { now: at(2), windowDays }), false);
  assert.equal(isOrderReturnEligible(deliveredOrder({ status: "Return Requested" }), { now: at(1), windowDays }), false);
  assert.equal(isOrderReturnEligible(deliveredOrder({ deliveredAt: null }), { now: at(1), windowDays }), false);
});

test("the audited input projects the free-text reason out of every audit row", async () => {
  // Exactly what assistantRoute.js passes to recordAssistantAudit as `input`.
  assert.deepEqual(returnProposalAuditInput(input), { orderId: "order-1" });
  assert.deepEqual(Object.keys(returnProposalAuditInput(input)), ["orderId"]);
  assert.equal(!("reason" in returnProposalAuditInput(input)), true);
});
