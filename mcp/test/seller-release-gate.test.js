import assert from "node:assert/strict";
import test from "node:test";
import { isToolAvailable, toolRegistry } from "../src/toolRegistry.js";

import {
  SELLER_TOOL_NAMES,
  SELLER_RUNTIME_PROOF_CHECKS,
  buildSellerAuthorizationMatrix,
  evaluateSellerRegistryMatrix,
  sellerReleaseMatrixEvidence,
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

test("registry-only evidence remains pending until runtime release proofs exist", () => {
  const evidence = sellerReleaseMatrixEvidence();
  assert.equal(evidence.registryOutcome, "pass");
  assert.equal(evidence.outcome, "pending_runtime");
  assert.ok(evidence.runtimeRequired.includes("per_tool_rollback"));
});

test("final seller matrix requires complete, distinct runtime proofs and observation", () => {
  const proof = (mode, names, disabledTool = null) => ({
    issue: 32, mode, outcome: "pass", tools: SELLER_TOOL_NAMES,
    disabledTool, checks: names.map((name) => ({ name, outcome: "pass" })),
  });
  const proofs = {
    hosted: proof("enabled", SELLER_RUNTIME_PROOF_CHECKS.hosted),
    postgres: proof("postgres", SELLER_RUNTIME_PROOF_CHECKS.postgres),
    redis: proof("redis", SELLER_RUNTIME_PROOF_CHECKS.redis),
    flags: SELLER_TOOL_NAMES.map((name) => proof("flag", [
      "mcp_discovery", `mcp_flag_denial:${name}`, `express_flag_denial:${name}`,
    ], name)),
    initialDisabled: proof("disabled", ["mcp_disabled", "express_disabled"]),
    finalDisabled: proof("disabled", ["mcp_disabled", "express_disabled"]),
    observation: {
      outcome: "pass", startedAt: "2026-09-28T00:00:00Z", finishedAt: "2026-09-28T00:10:00Z",
      privacyScan: "pass", commerceSnapshot: "unchanged", unauthorizedReads: 0, forbiddenMutations: 0,
    },
  };
  assert.equal(sellerReleaseMatrixEvidence(proofs).outcome, "pass");
  proofs.hosted.checks.pop();
  assert.equal(sellerReleaseMatrixEvidence(proofs).outcome, "pending_runtime");
  proofs.hosted.checks.push({ name: SELLER_RUNTIME_PROOF_CHECKS.hosted.at(-1), outcome: "pass" });
  proofs.flags[1] = proofs.flags[0];
  assert.equal(sellerReleaseMatrixEvidence(proofs).outcome, "pending_runtime");
});

test("unverified seller retains listing-draft access", () => {
  const draft = toolRegistry.find(({ name }) => name === "draft_listing_copy");
  const auth = { role: "seller", verified: false, scopes: ["listings:draft"] };
  assert.equal(isToolAvailable(draft, { [draft.rollout.flag]: true }, auth), true);
});
