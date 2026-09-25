import assert from "node:assert/strict";
import test from "node:test";

import {
  BUYER_RUNTIME_CASES,
  BUYER_TOOL_NAMES,
  buildBuyerAuthorizationMatrix,
  evaluateRegistryMatrix,
} from "../src/buyerReleaseGate.js";

test("buyer release matrix is generated for every #31 tool and denial class", () => {
  assert.deepEqual(BUYER_TOOL_NAMES, [
    "get_my_profile_summary",
    "list_my_notifications",
    "get_my_cart",
    "validate_promo_code",
    "preview_checkout",
    "list_my_orders",
    "get_my_order",
    "track_my_order",
    "get_my_bill_summary",
    "get_my_payment_status",
  ]);

  const matrix = buildBuyerAuthorizationMatrix();
  assert.equal(matrix.length, BUYER_TOOL_NAMES.length * 7);
  for (const tool of BUYER_TOOL_NAMES) {
    const rows = matrix.filter((row) => row.tool === tool);
    assert.deepEqual(rows.map(({ scenario }) => scenario), [
      "allowed",
      "unauthenticated",
      "wrong_role",
      "missing_scope",
      "wrong_scope",
      "disabled",
      "malformed_input",
    ]);
  }
  assert.deepEqual(BUYER_RUNTIME_CASES, ["revoked", "missing_account", "foreign_buyer"]);
});

test("registry matrix allows only the exact enabled buyer grant", () => {
  const results = evaluateRegistryMatrix();
  assert.equal(results.length, BUYER_TOOL_NAMES.length * 6);
  assert.ok(results.every(({ passed }) => passed));
  assert.ok(results.filter(({ scenario }) => scenario === "allowed").every(({ actual }) => actual));
  assert.ok(results.filter(({ scenario }) => scenario !== "allowed").every(({ actual }) => !actual));
});
