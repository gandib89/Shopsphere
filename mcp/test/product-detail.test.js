import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { createMcpHttpServer as createRawMcpHttpServer } from "../src/httpServer.js";
import { ACCESS_TOKEN, ALL_FLAGS, fakeBackendClient } from "./support/fakeBackend.js";
import { close, listen } from "./support/httpServer.js";

const createMcpHttpServer = (options = {}) =>
  createRawMcpHttpServer({
    accessToken: ACCESS_TOKEN,
    backendClient: fakeBackendClient,
    ...options,
    flags: { ...ALL_FLAGS, ...options.flags },
  });

const PRODUCT_KEYS = ["availability", "category", "description", "id", "images", "name", "price", "variants"];
const REVIEW_KEYS = ["comment", "createdAt", "displayName", "rating"];

const connect = async (url) => {
  const client = new Client(
    { name: "shopsphere-product-detail-test", version: "1.0.0" },
    { versionNegotiation: { mode: "legacy" } },
  );
  await client.connect(new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { authorization: `Bearer ${ACCESS_TOKEN}` } },
  }));
  return client;
};

// Rejects (throws) or returns a tool error result — either proves strict rejection.
const expectToolError = async (client, params) => {
  try {
    const result = await client.callTool(params);
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /unrecognized|unknown|invalid|too_big|maximum|not found/i);
  } catch {
    // SDK-thrown McpError on invalid params also counts as rejection.
  }
};

const withClient = async (t, options, run) => {
  const server = createMcpHttpServer({ enabled: true, ...options });
  const url = await listen(server);
  t.after(() => close(server));

  const client = await connect(url);
  t.after(() => client.close());
  await run(client);
};

test("get_product exposes the discovery list and the public projection only", async (t) => {
  await withClient(t, undefined, async (client) => {
    const tools = await client.listTools();
    assert.ok(tools.tools.some(({ name }) => name === "get_product"));
    assert.ok(tools.tools.some(({ name }) => name === "get_product_reviews"));
    assert.ok(tools.tools.some(({ name }) => name === "get_recommendations"));

    const result = await client.callTool({
      name: "get_product",
      arguments: { productId: "prod_001" },
    });
    assert.equal(result.isError, undefined);
    const product = result.structuredContent;
    assert.deepEqual(Object.keys(product).sort(), PRODUCT_KEYS);
    assert.equal(product.id, "prod_001");
    assert.equal(product.name, "MacBook Air M2");
    assert.deepEqual(product.price, { amount: "129900.00", currency: "NPR" });
    assert.equal(product.availability, "In stock");
    assert.ok(product.description.length > 0);
    assert.deepEqual(Object.keys(product.variants).sort(), ["colors", "options", "storages"]);
    // Variants carry selectable values and public price deltas, never exact stock.
    // ("In stock" is the intended availability label, not a stock count.)
    const serialized = JSON.stringify(product);
    assert.doesNotMatch(serialized, /"sellerId"|"quantity"|"archived"|"inStock"|"userId"|"orderId"|"stock"/);
  });
});

test("get_product labels availability and hides archived or unknown products", async (t) => {
  await withClient(t, undefined, async (client) => {
    const soldOut = await client.callTool({
      name: "get_product",
      arguments: { productId: "prod_004" },
    });
    assert.equal(soldOut.isError, undefined);
    assert.equal(soldOut.structuredContent.availability, "Sold out");

    // Archived prod_009 and unknown ids share one generic not-found, no oracle.
    await expectToolError(client, { name: "get_product", arguments: { productId: "prod_009" } });
    await expectToolError(client, { name: "get_product", arguments: { productId: "nope" } });
  });
});

test("get_product_reviews exposes display-safe fields with an untrusted-content label", async (t) => {
  await withClient(t, undefined, async (client) => {
    const result = await client.callTool({
      name: "get_product_reviews",
      arguments: { productId: "prod_001" },
    });
    assert.equal(result.isError, undefined);
    const { productId, reviews, total, nextCursor, contentNotice } = result.structuredContent;
    assert.equal(productId, "prod_001");
    assert.equal(total, 2);
    assert.equal(nextCursor, null);
    assert.match(contentNotice, /untrusted/i);
    for (const review of reviews) {
      assert.deepEqual(Object.keys(review).sort(), REVIEW_KEYS);
    }
    // Private linkage never leaves the module, even though rows carry it.
    assert.doesNotMatch(JSON.stringify(reviews), /userId|orderId|contact|@example|\+977/i);
    // Injected instruction text is returned as data, labeled untrusted.
    assert.ok(reviews.some(({ comment }) => comment.includes("SYSTEM:")));

    const firstPage = await client.callTool({
      name: "get_product_reviews",
      arguments: { productId: "prod_001", limit: 1 },
    });
    const paged = await client.callTool({
      name: "get_product_reviews",
      arguments: { productId: "prod_001", limit: 1, cursor: firstPage.structuredContent.nextCursor },
    });
    assert.equal(paged.isError, undefined);
    assert.equal(paged.structuredContent.reviews.length, 1);

    const empty = await client.callTool({
      name: "get_product_reviews",
      arguments: { productId: "prod_005" },
    });
    assert.equal(empty.isError, undefined);
    assert.deepEqual(empty.structuredContent.reviews, []);
    assert.equal(empty.structuredContent.total, 0);

    await expectToolError(client, {
      name: "get_product_reviews",
      arguments: { productId: "prod_001", limit: 51 },
    });
    await expectToolError(client, {
      name: "get_product_reviews",
      arguments: { productId: "prod_009" },
    });
    await expectToolError(client, {
      name: "get_product_reviews",
      arguments: { productId: "nope" },
    });
  });
});

test("get_recommendations re-filters archived, unavailable, and unknown ids", async (t) => {
  await withClient(t, undefined, async (client) => {
    const result = await client.callTool({
      name: "get_recommendations",
      arguments: { productId: "prod_001" },
    });
    assert.equal(result.isError, undefined);
    const { productId, recommendations } = result.structuredContent;
    assert.equal(productId, "prod_001");
    // prod_009 (archived), "nope" (unknown), and prod_004 (sold out) are dropped.
    assert.ok(recommendations.length > 0);
    assert.ok(!recommendations.some(({ id }) => ["prod_004", "prod_009", "nope"].includes(id)));
    for (const product of recommendations) {
      assert.deepEqual(Object.keys(product).sort(), ["availability", "category", "id", "images", "name", "price"]);
      assert.equal(product.availability, "In stock");
    }

    const limited = await client.callTool({
      name: "get_recommendations",
      arguments: { productId: "prod_008", limit: 1 },
    });
    assert.equal(limited.isError, undefined);
    assert.equal(limited.structuredContent.recommendations.length, 1);

    await expectToolError(client, {
      name: "get_recommendations",
      arguments: { productId: "prod_001", limit: 21 },
    });
    await expectToolError(client, {
      name: "get_recommendations",
      arguments: { productId: "prod_009" },
    });
    await expectToolError(client, {
      name: "get_recommendations",
      arguments: { productId: "nope" },
    });
  });
});

test("product detail tools reject unknown keys and dynamic database filters", async (t) => {
  await withClient(t, undefined, async (client) => {
    await expectToolError(client, {
      name: "get_product",
      arguments: { productId: "prod_001", where: { isArchived: true } },
    });
    await expectToolError(client, {
      name: "get_product",
      arguments: { productId: "prod_001", select: { sellerId: true } },
    });
    await expectToolError(client, {
      name: "get_product_reviews",
      arguments: { productId: "prod_001", include: { user: true } },
    });
    await expectToolError(client, {
      name: "get_product_reviews",
      arguments: { productId: "prod_001", sql: "SELECT * FROM \"ProductReview\"" },
    });
    await expectToolError(client, {
      name: "get_recommendations",
      arguments: { productId: "prod_001", where: { price: { gt: 0 } } },
    });
    await expectToolError(client, {
      name: "get_recommendations",
      arguments: { productId: "prod_001", include: { seller: true } },
    });
  });
});

test("product detail rollout flags remove discovery and dispatch", async (t) => {
  const server = createMcpHttpServer({
    enabled: true,
    flags: {
      MCP_TOOL_GET_PRODUCT_ENABLED: false,
      MCP_TOOL_GET_PRODUCT_REVIEWS_ENABLED: false,
      MCP_TOOL_GET_RECOMMENDATIONS_ENABLED: false,
    },
  });
  const url = await listen(server);
  t.after(() => close(server));

  const client = await connect(url);
  t.after(() => client.close());

  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map(({ name }) => name), [
    "get_capabilities",
    "get_store_policy",
    "search_products",
    "compare_products",
  ]);
  await expectToolError(client, { name: "get_product", arguments: { productId: "prod_001" } });
  await expectToolError(client, {
    name: "get_product_reviews",
    arguments: { productId: "prod_001" },
  });
  await expectToolError(client, {
    name: "get_recommendations",
    arguments: { productId: "prod_001" },
  });
});
