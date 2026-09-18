import assert from "node:assert/strict";
import test from "node:test";
import express from "express";

import assistantRouter, { sendProfileSummary } from "./assistantRoute.js";

const token = "assistant-test-token-123456789012345";

const listen = async () => {
  process.env.ASSISTANT_API_TOKEN = token;
  const app = express();
  app.use(express.json());
  app.use("/api/v1/assistant", assistantRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  return server;
};

const close = (server) => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

test("assistant operations require the private service token", async (t) => {
  const server = await listen();
  t.after(() => close(server));
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/api/v1/assistant/not-an-operation`;
  const unauthorized = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(unauthorized.status, 401);
  const authenticated = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(authenticated.status, 404);
});

test("assistant policy accepts only allowlisted topics and returns every source", async (t) => {
  const server = await listen();
  t.after(() => close(server));
  const { port } = server.address();
  const call = (operation, body) => fetch(`http://127.0.0.1:${port}/api/v1/assistant/${operation}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const invalid = await call("get_store_policy", { topic: "arbitrary-url", url: "https://evil.test" });
  assert.equal(invalid.status, 400);

  const payment = await call("get_store_policy", { topic: "payment" });
  assert.equal(payment.status, 200);
  const output = await payment.json();
  assert.equal(output.sources.length, 3);
  assert.ok(output.sources.every(({ sourceId, sourceVersion }) => sourceId.startsWith("faqs.json#") && sourceVersion === "1.0.0"));

  const invertedRange = await call("search_products", { minPrice: "20.00", maxPrice: "10.00" });
  assert.equal(invertedRange.status, 400);
});

test("buyer and seller private reads mount behind workload authentication", async (t) => {
  const server = await listen();
  t.after(() => close(server));
  const { port } = server.address();
  const paths = [
    "get_my_cart",
    "validate_promo_code",
    "preview_checkout",
    "list_my_orders",
    "get_my_order",
    "track_my_order",
    "get_my_bill_summary",
    "get_my_payment_status",
    "list_my_products",
    "get_my_product",
    "get_my_inventory_summary",
    "list_my_seller_orders",
    "get_my_seller_order",
    "get_my_revenue_summary",
  ];
  for (const path of paths) {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/assistant/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(response.status, 401, path);
  }
});

test("profile summary exposes only display name, current role, and verification", () => {
  let output;
  sendProfileSummary({
    assistantAccount: {
      id: "user-1",
      firstName: "Ada",
      lastName: "Buyer",
      role: "user",
      isVerified: true,
      email: "private@example.com",
      password: "secret",
    },
  }, { json: (body) => { output = body; } });
  assert.deepEqual(output, { displayName: "Ada Buyer", role: "user", verified: true });
});
