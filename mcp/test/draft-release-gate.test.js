import assert from "node:assert/strict";
import test from "node:test";
import { toolRegistry } from "../src/toolRegistry.js";
import { DRAFT_TOOL_NAMES, DRAFT_TOOL_COVERAGE, buildDraftAuthorizationMatrix, evaluateDraftRegistryMatrix, draftReleaseMatrixEvidence } from "../src/draftReleaseGate.js";

test("draft coverage contains exactly the eight implemented draft contracts", () => {
  assert.deepEqual(DRAFT_TOOL_NAMES, ["draft_listing_copy", "save_listing_draft", "list_my_listing_drafts", "get_my_listing_draft", "draft_support_message", "draft_seller_review_recommendation", "draft_return_review_recommendation", "draft_promotion_recommendation"]);
  assert.deepEqual(DRAFT_TOOL_NAMES, toolRegistry.filter(({ operationClass }) => operationClass === "draft").map(({ name }) => name));
  for (const coverage of DRAFT_TOOL_COVERAGE) {
    const definition = toolRegistry.find(({ name }) => name === coverage.tool);
    assert.equal(coverage.operation, definition.backendOperation.operationId);
    assert.equal(coverage.scope, definition.scopes[0]);
    assert.equal(coverage.role, definition.roles[0]);
    assert.equal(coverage.path, definition.backendOperation.path);
    assert.equal(coverage.flag, definition.rollout.flag);
  }
});
test("registry preflight enforces exact scope, all wrong roles, and independent draft flags", () => {
  const matrix = buildDraftAuthorizationMatrix();
  assert.ok(evaluateDraftRegistryMatrix().every(({ passed }) => passed));
  const proposals = toolRegistry.filter(({ operationClass }) => operationClass === "propose");
  for (const name of DRAFT_TOOL_NAMES) {
    const allowed = matrix.find((row) => row.tool === name && row.scenario === "allowed_with_proposals_disabled");
    assert.ok(proposals.every(({ rollout }) => allowed.flags[rollout.flag] === false));
    assert.ok(matrix.some((row) => row.tool === name && row.scenario.startsWith("missing_exact_scope:")));
  }
  assert.ok(evaluateDraftRegistryMatrix().filter(({ scenario }) => scenario === "unverified_seller").every(({ actual }) => actual === true));
});
test("registry evidence never claims live grants, RLS, outages, observation, or release passed", () => {
  const evidence = draftReleaseMatrixEvidence();
  assert.equal(evidence.registryOutcome, "pass");
  assert.equal(evidence.outcome, "pending_runtime");
  assert.ok(evidence.runtimeChecks.every(({ outcome }) => outcome === "pending_runtime"));
  for (const scenario of ["revoked_grant", "stale_verification", "unapproved_cohort", "live_role_downgrade"]) assert.ok(evidence.runtimeChecks.some((row) => row.scenario === scenario));
  assert.equal(evidence.provider.evidence, "code_preflight_only");
  assert.ok(evidence.runtimeChecks.some(({ scenario }) => scenario === "stored_draft_owner_grant_rls"));
});
