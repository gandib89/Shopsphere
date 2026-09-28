import { isToolAvailable, toolRegistry } from "./toolRegistry.js";

const SELLER_SCOPES = ["catalog:read", "sales:read", "revenue:read"];

export const SELLER_TOOL_NAMES = Object.freeze([
  "list_my_products",
  "get_my_product",
  "get_my_inventory_summary",
  "list_my_seller_orders",
  "get_my_seller_order",
  "get_my_revenue_summary",
]);

const definitionsByName = new Map(toolRegistry.map((tool) => [tool.name, tool]));

export const sellerToolDefinitions = Object.freeze(SELLER_TOOL_NAMES.map((name) => {
  const definition = definitionsByName.get(name);
  if (!definition || definition.operationClass !== "read"
    || !definition.roles.includes("seller") || !definition.requiresVerifiedSeller) {
    throw new Error(`Invalid #32 seller read contract: ${name}`);
  }
  return definition;
}));

const authFor = (definition, overrides = {}) => ({
  sub: "matrix-seller",
  role: "seller",
  verified: true,
  clientId: "shopsphere-mcp-client",
  grantId: "matrix-grant",
  scopes: [...definition.scopes],
  ...overrides,
});

export const buildSellerAuthorizationMatrix = () => sellerToolDefinitions.flatMap((definition) => {
  const enabled = { [definition.rollout.flag]: true };
  return [
    { tool: definition.name, scenario: "allowed", expected: "allow", flags: enabled, auth: authFor(definition) },
    { tool: definition.name, scenario: "unverified_seller", expected: "deny", flags: enabled, auth: authFor(definition, { verified: false }) },
    { tool: definition.name, scenario: "unauthenticated", expected: "deny", flags: enabled, auth: null },
    { tool: definition.name, scenario: "wrong_role", expected: "deny", flags: enabled, auth: authFor(definition, { role: "user" }) },
    { tool: definition.name, scenario: "missing_scope", expected: "deny", flags: enabled, auth: authFor(definition, { scopes: [] }) },
    { tool: definition.name, scenario: "wrong_scope", expected: "deny", flags: enabled, auth: authFor(definition, { scopes: [SELLER_SCOPES.find((scope) => !definition.scopes.includes(scope))] }) },
    { tool: definition.name, scenario: "disabled", expected: "deny", flags: { [definition.rollout.flag]: false }, auth: authFor(definition) },
    { tool: definition.name, scenario: "malformed_input", expected: "deny", runtimeOnly: true },
  ];
});

export const evaluateSellerRegistryMatrix = () => buildSellerAuthorizationMatrix()
  .filter(({ runtimeOnly }) => !runtimeOnly)
  .map((row) => {
    const actual = isToolAvailable(definitionsByName.get(row.tool), row.flags, row.auth);
    return {
      tool: row.tool,
      scenario: row.scenario,
      expected: row.expected,
      actual,
      passed: actual === (row.expected === "allow"),
    };
  });

const hostedChecks = [
  ...SELLER_TOOL_NAMES.map((name) => `mcp_call:${name}`),
  "express_valid_seller", "mcp_denial:unverified_seller", "express_denial:unverified_seller",
  "mcp_denial:stale_verification", "express_denial:stale_verification",
  "mcp_denial:wrong_role", "express_denial:wrong_role",
  "mcp_denial:wrong_scope", "express_denial:wrong_scope",
  "mcp_denial:revoked", "express_denial:revoked",
  "mcp_denial:missing_account", "express_denial:missing_account",
  "mcp_denial:unapproved_account", "express_denial:unapproved_account",
  "mcp_foreign:get_my_product", "mcp_foreign:get_my_seller_order",
  "express_foreign:get_my_product", "express_foreign:get_my_seller_order",
];
const postgresChecks = [
  "verified_and_unverified_fixture", "archived_and_foreign_catalog", "private_stock_and_inventory",
  "historical_and_grouped_sales", "revenue_and_refunds", "cursor_binding",
  "negative_rls_and_read_purity", "pooled_cleanup",
];
const redisChecks = ["seller_session_isolation"];
export const SELLER_RUNTIME_PROOF_CHECKS = Object.freeze({
  hosted: Object.freeze(hostedChecks),
  postgres: Object.freeze(postgresChecks),
  redis: Object.freeze(redisChecks),
});

const validProof = (proof, mode, requiredChecks) => {
  if (!proof || proof.issue !== 32 || proof.mode !== mode || proof.outcome !== "pass"
    || !Array.isArray(proof.checks) || !Array.isArray(proof.tools)
    || proof.tools.length !== SELLER_TOOL_NAMES.length
    || SELLER_TOOL_NAMES.some((name) => !proof.tools.includes(name))) return false;
  const names = proof.checks.map(({ name }) => name);
  return names.length === new Set(names).size
    && proof.checks.every(({ outcome }) => outcome === "pass")
    && requiredChecks.every((name) => names.includes(name));
};

export const sellerReleaseMatrixEvidence = (proofs = {}) => {
  const registryChecks = evaluateSellerRegistryMatrix();
  const hosted = validProof(proofs.hosted, "enabled", hostedChecks);
  const postgres = validProof(proofs.postgres, "postgres", postgresChecks);
  const redis = validProof(proofs.redis, "redis", redisChecks);
  const flags = Array.isArray(proofs.flags) && proofs.flags.length === SELLER_TOOL_NAMES.length
    && SELLER_TOOL_NAMES.every((name) => proofs.flags.some((proof) => proof?.disabledTool === name
      && validProof(proof, "flag", ["mcp_discovery", `mcp_flag_denial:${name}`, `express_flag_denial:${name}`])));
  const disabled = validProof(proofs.initialDisabled, "disabled", ["mcp_disabled", "express_disabled"])
    && validProof(proofs.finalDisabled, "disabled", ["mcp_disabled", "express_disabled"]);
  const observed = proofs.observation?.outcome === "pass"
    && Number.isFinite(Date.parse(proofs.observation.startedAt))
    && Number.isFinite(Date.parse(proofs.observation.finishedAt))
    && Date.parse(proofs.observation.finishedAt) - Date.parse(proofs.observation.startedAt) >= 600_000
    && proofs.observation.privacyScan === "pass"
    && proofs.observation.commerceSnapshot === "unchanged"
    && proofs.observation.unauthorizedReads === 0
    && proofs.observation.forbiddenMutations === 0;
  const runtimeChecks = [
    { scenario: "hosted_authorization_and_reads", passed: hosted },
    { scenario: "postgres_ownership_privacy_and_purity", passed: postgres },
    { scenario: "redis_seller_session_isolation", passed: redis },
    { scenario: "six_individual_kill_switches", passed: flags },
    { scenario: "global_disabled_preflight_and_rollback", passed: disabled },
    { scenario: "ten_minute_observation", passed: observed },
  ];
  const registryOutcome = registryChecks.every(({ passed }) => passed) ? "pass" : "fail";
  return {
    schemaVersion: "1.0.0",
    issue: 32,
    generatedAt: new Date().toISOString(),
    clientId: "shopsphere-mcp-client",
    tools: SELLER_TOOL_NAMES,
    registryChecks,
    runtimeChecks,
    runtimeRequired: [
      "verified_seller", "unverified_seller", "stale_verification", "wrong_role", "wrong_scope",
      "revoked_grant", "missing_account", "unapproved_account", "foreign_ownership",
      "owned_active_and_archived_catalog", "private_stock", "bounded_inventory",
      "historical_sale_attribution", "mixed_seller_group", "revenue_and_refunds",
      "cursor_binding", "session_and_redis_isolation", "privacy_and_read_only",
      "direct_express", "per_tool_rollback", "global_rollback", "observation",
    ],
    registryOutcome,
    outcome: registryOutcome === "fail" ? "fail"
      : runtimeChecks.every(({ passed }) => passed) ? "pass" : "pending_runtime",
  };
};
