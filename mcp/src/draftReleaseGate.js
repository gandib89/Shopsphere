import { isToolAvailable, toolRegistry } from "./toolRegistry.js";

// Registry preflight only. Live identity, grants, sources, storage, and failures
// must be checked separately on the deployed artifact; this cannot release it.
export const draftToolDefinitions = Object.freeze(toolRegistry.filter(({ operationClass }) => operationClass === "draft"));
export const DRAFT_TOOL_NAMES = Object.freeze(draftToolDefinitions.map(({ name }) => name));
export const DRAFT_TOOL_COVERAGE = Object.freeze(draftToolDefinitions.map((tool) => Object.freeze({
  tool: tool.name,
  operation: tool.backendOperation.operationId,
  role: tool.roles[0],
  scope: tool.scopes[0],
  flag: tool.rollout.flag,
  path: tool.backendOperation.path,
  requiresVerifiedSeller: Boolean(tool.requiresVerifiedSeller),
})));
const byName = new Map(draftToolDefinitions.map((tool) => [tool.name, tool]));
const authFor = (tool, overrides = {}) => ({ role: tool.roles[0], verified: true, scopes: [...tool.scopes], ...overrides });
const disabledProposalFlags = Object.fromEntries(toolRegistry.filter(({ operationClass }) => operationClass === "propose").map((tool) => [tool.rollout.flag, false]));

export const buildDraftAuthorizationMatrix = () => draftToolDefinitions.flatMap((tool) => {
  const enabled = { ...disabledProposalFlags, [tool.rollout.flag]: true };
  const cases = [
    { scenario: "allowed_with_proposals_disabled", expected: "allow", flags: enabled, auth: authFor(tool) },
    { scenario: "unauthenticated", expected: "deny", flags: enabled, auth: null },
    ...["user", "seller", "admin"].filter((role) => !tool.roles.includes(role)).map((role) => ({ scenario: `wrong_role:${role}`, expected: "deny", flags: enabled, auth: authFor(tool, { role }) })),
    { scenario: "missing_scope", expected: "deny", flags: enabled, auth: authFor(tool, { scopes: [] }) },
    { scenario: "substituted_scope", expected: "deny", flags: enabled, auth: authFor(tool, { scopes: ["unrelated:read"] }) },
    ...tool.scopes.map((scope) => ({ scenario: `missing_exact_scope:${scope}`, expected: "deny", flags: enabled, auth: authFor(tool, { scopes: tool.scopes.filter((entry) => entry !== scope) }) })),
    { scenario: "disabled", expected: "deny", flags: { ...enabled, [tool.rollout.flag]: false }, auth: authFor(tool) },
    { scenario: "default_disabled", expected: "deny", flags: {}, auth: authFor(tool) },
  ];
  if (tool.roles.includes("seller")) cases.push({ scenario: "unverified_seller", expected: tool.requiresVerifiedSeller ? "deny" : "allow", flags: enabled, auth: authFor(tool, { verified: false }) });
  return cases.map((row) => ({ tool: tool.name, ...row }));
});
export const evaluateDraftRegistryMatrix = () => buildDraftAuthorizationMatrix().map((row) => {
  const actual = isToolAvailable(byName.get(row.tool), row.flags, row.auth);
  return { tool: row.tool, scenario: row.scenario, expected: row.expected, actual, passed: actual === (row.expected === "allow") };
});

export const DRAFT_RUNTIME_SCENARIOS = Object.freeze([
  "mcp_and_direct_express_exact_scope", "live_role_downgrade", "stale_verification", "revoked_grant", "missing_account", "unapproved_cohort", "insufficient_consent", "forged_discovery_and_dispatch", "disabled_flag",
  "authorized_bounded_sources", "source_owner_substitution", "strict_input_and_output_limits", "privacy_and_encoded_injection", "session_and_cache_isolation", "subject_quota_client_and_grant_rotation", "rate_concurrency_response_size_timeout", "denial_reason_and_audit_correlation", "issuer_redis_backend_database_audit_failure_recovery", "repeated_retry_non_execution", "proposal_flags_stay_disabled",
]);
export const draftReleaseMatrixEvidence = () => {
  const registryChecks = evaluateDraftRegistryMatrix();
  const registryOutcome = registryChecks.every(({ passed }) => passed) ? "pass" : "fail";
  return {
    schemaVersion: "1.0.0", issue: 34, generatedAt: new Date().toISOString(),
    tools: DRAFT_TOOL_NAMES, toolCoverage: DRAFT_TOOL_COVERAGE, registryChecks, registryOutcome,
    runtimeChecks: draftToolDefinitions.flatMap((tool) => [
      ...DRAFT_RUNTIME_SCENARIOS,
      ...(tool.name.includes("listing_draft") ? ["stored_draft_owner_grant_rls"] : ["source_rls"]),
      ...(tool.name === "save_listing_draft" ? ["version_race_and_atomic_audit"] : []),
    ].map((scenario) => ({ tool: tool.name, scenario, outcome: "pending_runtime" }))),
    provider: { implementation: "deterministic_templates", externalModelCalls: false, providerTokenCostBudget: "not_applicable_to_current_implementation", evidence: "code_preflight_only" },
    releaseRequired: ["exact_merged_image_provenance", "fresh_initial_disabled", "predeclared_observation_and_rollback", "draft_only_hosted_gate", "monitoring_and_issue_specific_owner_decisions", "completed_observation", "rollback_and_fresh_final_disabled", "unchanged_commerce_privacy_cleanup_and_stopped_vm"],
    outcome: registryOutcome === "pass" ? "pending_runtime" : "fail",
  };
};
