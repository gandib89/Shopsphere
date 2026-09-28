import assert from "node:assert/strict";
import test from "node:test";
import { isToolAvailable, toolRegistry } from "../src/toolRegistry.js";

import {
  SELLER_TOOL_NAMES,
  buildSellerAuthorizationMatrix,
  evaluateSellerRegistryMatrix,
} from "../src/sellerReleaseGate.js";

test("seller matrix covers every private read and verification denial", () => {
  assert.deepEqual(SELLER_TOOL_NAMES, [
    "list_my_products",
    "get_my_product",
    "get_my_inventory_summary",
    "list_my_seller_orders",
    "get_my_seller_order",
    "get_my_revenue_summary",
  ]);
  const matrix = buildSellerAuthorizationMatrix();
  assert.equal(matrix.length, 6 * 8);
  for (const name of SELLER_TOOL_NAMES) {
    assert.deepEqual(matrix.filter(({ tool }) => tool === name).map(({ scenario }) => scenario), [
      "allowed", "unverified_seller", "unauthenticated", "wrong_role",
      "missing_scope", "wrong_scope", "disabled", "malformed_input",
    ]);
  }
});

test("registry matrix denies unverified seller for every seller read", () => {
  const checks = evaluateSellerRegistryMatrix();
  assert.equal(checks.length, 6 * 7);
  assert.ok(checks.every(({ passed }) => passed));
  assert.ok(checks.filter(({ scenario }) => scenario === "unverified_seller").every(({ actual }) => actual === false));
});

test("unverified seller retains listing-draft access", () => {
  const draft = toolRegistry.find(({ name }) => name === "draft_listing_copy");
  const auth = { role: "seller", verified: false, scopes: ["listings:draft"] };
  assert.equal(isToolAvailable(draft, { [draft.rollout.flag]: true }, auth), true);
});
