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

export const sellerReleaseMatrixEvidence = () => {
  const registryChecks = evaluateSellerRegistryMatrix();
  return {
    schemaVersion: "1.0.0",
    issue: 32,
    generatedAt: new Date().toISOString(),
    clientId: "shopsphere-mcp-client",
    tools: SELLER_TOOL_NAMES,
    registryChecks,
    runtimeRequired: ["revoked", "missing_account", "unapproved_account", "foreign_seller", "historical_sale_attribution", "privacy", "per_tool_rollback"],
    outcome: registryChecks.every(({ passed }) => passed) ? "pass" : "fail",
  };
};
