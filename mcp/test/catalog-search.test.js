import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { createMcpHttpServer } from "../src/httpServer.js";

const PUBLIC_KEYS = ["availability", "category", "id", "images", "name", "price"];

const listen = async (server) => {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return new URL(`http://127.0.0.1:${address.port}/mcp`);
};

const close = async (server) => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
};

const connect = async (url) => {
  const client = new Client(
    { name: "shopsphere-catalog-test", version: "1.0.0" },
    { versionNegotiation: { mode: "legacy" } },
  );
  await client.connect(new StreamableHTTPClientTransport(url));
  return client;
};

// Rejects (throws) or returns a tool error result — either proves strict rejection.
const expectToolError = async (client, params) => {
  try {
    const result = await client.callTool(params);
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /unrecognized|unknown|invalid|too_big|maximum/i);
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

test("search_products exposes the discovery list and the public projection only", async (t) => {
  await withClient(t, undefined, async (client) => {
    const tools = await client.listTools();
    assert.ok(tools.tools.some(({ name }) => name === "search_products"));
    assert.ok(tools.tools.some(({ name }) => name === "compare_products"));

    const result = await client.callTool({ name: "search_products", arguments: { q: "macbook" } });
    assert.equal(result.isError, undefined);
    const { items, total, page, pageSize } = result.structuredContent;
    // The archived "MacBook Air M2 Refurbished" (prod_009) must not surface.
    assert.deepEqual(items.map(({ id }) => id), ["prod_001", "prod_002"]);
    assert.equal(total, 2);
    assert.equal(page, 1);
    assert.equal(pageSize, 20);
    for (const item of items) {
      assert.deepEqual(Object.keys(item).sort(), PUBLIC_KEYS);
    }
  });
});

test("search_products filters by category, price, and sort with capped pages", async (t) => {
  await withClient(t, undefined, async (client) => {
    const byCategory = await client.callTool({
      name: "search_products",
      arguments: { category: "iPhone", sort: "price-asc" },
    });
    assert.equal(byCategory.isError, undefined);
    assert.deepEqual(
      byCategory.structuredContent.items.map(({ name }) => name),
      ["iPhone 14", "iPhone 15"],
    );
    // Out-of-stock rows stay listed with a label, never an exact count.
    assert.deepEqual(
      byCategory.structuredContent.items.map(({ availability }) => availability),
      ["Sold out", "In stock"],
    );

    const byPrice = await client.callTool({
      name: "search_products",
      arguments: { minPrice: 90000, maxPrice: 100000 },
    });
    assert.equal(byPrice.isError, undefined);
    assert.ok(byPrice.structuredContent.items.length > 0);
    for (const item of byPrice.structuredContent.items) {
      assert.ok(item.price >= 90000 && item.price <= 100000);
    }

    const paged = await client.callTool({
      name: "search_products",
      arguments: { limit: 1, page: 2, sort: "price-desc" },
    });
    assert.equal(paged.isError, undefined);
    assert.equal(paged.structuredContent.items.length, 1);
    assert.equal(paged.structuredContent.page, 2);
    assert.equal(paged.structuredContent.pageSize, 1);

    await expectToolError(client, {
      name: "search_products",
      arguments: { limit: 51 },
    });
  });
});

test("compare_products returns the same public projection and drops hidden ids", async (t) => {
  await withClient(t, undefined, async (client) => {
    const result = await client.callTool({
      name: "compare_products",
      arguments: { productIds: ["prod_001", "prod_009", "nope", "prod_003"] },
    });
    assert.equal(result.isError, undefined);
    // Archived prod_009 and unknown ids vanish without an existence oracle.
    assert.deepEqual(
      result.structuredContent.products.map(({ id }) => id),
      ["prod_001", "prod_003"],
    );
    for (const product of result.structuredContent.products) {
      assert.deepEqual(Object.keys(product).sort(), PUBLIC_KEYS);
    }
  });
});

test("compare_products caps comparisons at 5 products", async (t) => {
  await withClient(t, undefined, async (client) => {
    await expectToolError(client, {
      name: "compare_products",
      arguments: { productIds: ["prod_001", "prod_002", "prod_003", "prod_004", "prod_005", "prod_006"] },
    });
    await expectToolError(client, {
      name: "compare_products",
      arguments: { productIds: [] },
    });
  });
});

test("catalog tools reject unknown keys and dynamic database filters", async (t) => {
  await withClient(t, undefined, async (client) => {
    await expectToolError(client, {
      name: "search_products",
      arguments: { q: "macbook", where: { isArchived: true } },
    });
    await expectToolError(client, {
      name: "search_products",
      arguments: { q: "macbook", select: { sellerId: true } },
    });
    await expectToolError(client, {
      name: "search_products",
      arguments: { q: "macbook", include: { seller: true } },
    });
    await expectToolError(client, {
      name: "search_products",
      arguments: { q: "macbook", sql: "SELECT * FROM \"Product\"" },
    });
    await expectToolError(client, {
      name: "compare_products",
      arguments: { productIds: ["prod_001"], include: { reviews: true } },
    });
    await expectToolError(client, {
      name: "compare_products",
      arguments: { productIds: ["prod_001"], where: { price: { gt: 0 } } },
    });
  });
});

test("catalog rollout flags remove discovery and dispatch", async (t) => {
  const server = createMcpHttpServer({
    enabled: true,
    flags: { MCP_TOOL_SEARCH_PRODUCTS_ENABLED: false, MCP_TOOL_COMPARE_PRODUCTS_ENABLED: false },
  });
  const url = await listen(server);
  t.after(() => close(server));

  const client = await connect(url);
  t.after(() => client.close());

  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map(({ name }) => name), [
    "get_capabilities",
    "get_store_policy",
  ]);
  await expectToolError(client, { name: "search_products", arguments: {} });
  await expectToolError(client, {
    name: "compare_products",
    arguments: { productIds: ["prod_001"] },
  });
});
