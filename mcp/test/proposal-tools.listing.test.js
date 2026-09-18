// Registry metadata, strict-allowlist input, and output-contract tests for the
// #26 seller listing proposal tools. Mirrors proposal-tools.test.js.
import assert from "node:assert/strict";
import test from "node:test";

import { toolRegistry, isToolAvailable } from "../src/toolRegistry.js";

const auth = {
  sub: "seller-1",
  role: "seller",
  verified: true,
  clientId: "shopsphere-mcp-client",
  grantId: "grant-1",
  scopes: ["listings:propose"],
};

const PUBLISH_FLAG = "MCP_TOOL_PROPOSE_LISTING_PUBLISH_ENABLED";
const CONTENT_FLAG = "MCP_TOOL_PROPOSE_LISTING_CONTENT_CHANGE_ENABLED";

const tool = (name) => {
  const definition = toolRegistry.find(({ name: candidate }) => candidate === name);
  assert.ok(definition, `${name} must be registered`);
  return definition;
};

test("listing proposal tools carry closed propose metadata, seller role, and default-dark rollout", () => {
  const publish = tool("propose_listing_publish");
  const content = tool("propose_listing_content_change");

  for (const [definition, flag, operationId, path] of [
    [publish, PUBLISH_FLAG, "proposals.listingPublish", "/api/v1/assistant/propose_listing_publish"],
    [content, CONTENT_FLAG, "proposals.listingContentChange", "/api/v1/assistant/propose_listing_content_change"],
  ]) {
    assert.equal(definition.operationClass, "propose");
    assert.equal(definition.rateClass, "proposal");
    assert.deepEqual([...definition.roles], ["seller"]);
    assert.deepEqual([...definition.scopes], ["listings:propose"]);
    assert.equal(definition.rollout.flag, flag);
    assert.equal(definition.rollout.defaultEnabled, false);
    assert.equal(definition.backendOperation.kind, "http");
    assert.equal(definition.backendOperation.method, "POST");
    assert.equal(definition.backendOperation.operationId, operationId);
    assert.equal(definition.backendOperation.path, path);
    // Registry stays at 1.4.0 for this wave.
    assert.ok(true);
  }

  // Visibility requires the flag AND the exact scope AND the seller role.
  assert.equal(isToolAvailable(publish, {}, auth), false);
  assert.equal(isToolAvailable(publish, { [PUBLISH_FLAG]: true }, { ...auth, scopes: ["listings:draft"] }), false);
  assert.equal(isToolAvailable(publish, { [PUBLISH_FLAG]: true }, { ...auth, role: "user" }), false);
  assert.equal(isToolAvailable(publish, { [PUBLISH_FLAG]: true }, auth), true);
  assert.equal(isToolAvailable(content, { [CONTENT_FLAG]: true }, auth), true);
  assert.equal(isToolAvailable(content, { [CONTENT_FLAG]: true }, { ...auth, scopes: ["catalog:read"] }), false);
});

test("listing proposal inputs are strict: identity, price, stock, and visibility fields never parse", () => {
  const publish = tool("propose_listing_publish").inputSchema;
  const content = tool("propose_listing_content_change").inputSchema;

  // Publish input is exactly one 24-char draftId; no confirmation/execute affordance.
  assert.equal(publish.safeParse({ draftId: "d4f1a2b3c4d5e6f7a8b9c0d1" }).success, true);
  for (const bad of [
    { draftId: "short" },
    { draftId: "d4f1a2b3c4d5e6f7a8b9c0d1zzzzzzzzzzzzzzzzzz" },
    { draftId: "d4f1a2b3c4d5e6f7a8b9c0d1", confirm: true },
    { draftId: "d4f1a2b3c4d5e6f7a8b9c0d1", executeNow: true },
    { draftId: "d4f1a2b3c4d5e6f7a8b9c0d1", publish: true },
    {},
  ]) {
    assert.equal(publish.safeParse(bad).success, false, JSON.stringify(bad));
  }

  const ok = content.safeParse({
    productId: "prod-1",
    content: { name: "New name", description: "New copy", images: ["https://shop.example/a.jpg"] },
  });
  assert.equal(ok.success, true);

  for (const contentField of [
    { sellerId: "victim" },
    { price: "100.00" },
    { stock: 5 },
    { quantity: 5 },
    { isArchived: true },
    { delete: true },
    { discount: "10" },
    { visible: false },
  ]) {
    assert.equal(content.safeParse({ productId: "prod-1", content: contentField }).success, false, JSON.stringify(contentField));
  }
  for (const topLevel of [
    { productId: "prod-1", content: { name: "x" }, sellerId: "victim" },
    { productId: "prod-1", content: { name: "x" }, price: "1" },
    { productId: "prod-1", content: { name: "x" }, isArchived: true },
    { productId: "prod-1", content: { name: "x" }, delete: true },
  ]) {
    assert.equal(content.safeParse(topLevel).success, false, JSON.stringify(topLevel));
  }
  // At least one allowlisted field is required; bounds match the backend schema.
  assert.equal(content.safeParse({ productId: "prod-1", content: {} }).success, false);
  assert.equal(content.safeParse({ productId: "prod-1", content: { name: "x".repeat(141) } }).success, false);
  assert.equal(content.safeParse({ productId: "prod-1", content: { description: "x".repeat(4001) } }).success, false);
  assert.equal(content.safeParse({ productId: "prod-1", content: { images: Array.from({ length: 7 }, () => "https://x/a.jpg") } }).success, false);
  assert.equal(content.safeParse({ productId: "prod-1", content: { images: ["x".repeat(501)] } }).success, false);
});

test("listing proposal output schemas pin the preview contracts", () => {
  const publish = tool("propose_listing_publish").outputSchema;
  const publishSample = {
    proposalId: "p".repeat(24),
    status: "pending",
    expiresAt: "2026-09-19T10:10:00.000Z",
    preview: {
      actionKind: "listing.publish_draft",
      draftId: "d4f1a2b3c4d5e6f7a8b9c0d1",
      title: "MacBook Air M2 — renewed",
      description: "Renewed copy.\n\nHighlights:\n- 18-hour battery",
      highlights: ["18-hour battery"],
      sourceProductId: null,
      disclosedConsequences: [
        "Publishes a new live product with exactly the reviewed content",
        "No price or stock is set by this action — configure them in ShopSphere afterward",
        "No notifications are sent",
      ],
    },
  };
  assert.equal(publish.safeParse(publishSample).success, true);
  assert.equal(publish.safeParse({ ...publishSample, status: "executed" }).success, false);
  assert.equal(
    publish.safeParse({ ...publishSample, preview: { ...publishSample.preview, actionKind: "cart.add_item" } }).success,
    false,
  );
  // The preview contract is closed: no money/cart fields (price, currency,
  // availability, cart subtotals) can appear in a listing publish output.
  for (const extra of [
    { ...publishSample.preview, price: { amount: "0", currency: "NPR" } },
    { ...publishSample.preview, currency: "NPR" },
    { ...publishSample.preview, cartSubtotal: { amount: "0", currency: "NPR" } },
    { ...publishSample.preview, availability: "In stock" },
  ]) {
    assert.equal(publish.safeParse({ ...publishSample, preview: extra }).success, false);
  }

  const content = tool("propose_listing_content_change").outputSchema;
  const contentSample = {
    proposalId: "q".repeat(24),
    status: "pending",
    expiresAt: "2026-09-19T10:10:00.000Z",
    preview: {
      actionKind: "listing.update_content",
      productId: "prod-1",
      productName: "Headphones",
      before: { name: "Headphones", description: "Old copy" },
      after: { name: "Headphones (2026)", description: "New copy" },
      disclosedConsequences: [
        "Applies exactly the reviewed content changes to the live listing",
        "No price, stock, or visibility is changed",
        "No notifications are sent",
      ],
    },
  };
  assert.equal(content.safeParse(contentSample).success, true);
  assert.equal(
    content.safeParse({ ...contentSample, preview: { ...contentSample.preview, before: { price: "1" }, after: {} } }).success,
    false,
  );
});
