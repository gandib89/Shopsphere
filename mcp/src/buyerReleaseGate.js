import { isToolAvailable, toolRegistry } from "./toolRegistry.js";

const BUYER_SCOPE_ORDER = Object.freeze([
  "profile:read",
  "notifications:read",
  "cart:read",
  "orders:read",
]);

export const BUYER_TOOL_NAMES = Object.freeze([
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

export const BUYER_RUNTIME_CASES = Object.freeze([
  "revoked",
  "missing_account",
  "unapproved_account",
  "foreign_buyer",
]);

const definitionsByName = new Map(toolRegistry.map((tool) => [tool.name, tool]));

export const buyerToolDefinitions = Object.freeze(BUYER_TOOL_NAMES.map((name) => {
  const definition = definitionsByName.get(name);
  if (!definition) throw new Error(`Missing #31 buyer tool: ${name}`);
  if (!definition.roles.includes("user") || definition.operationClass !== "read") {
    throw new Error(`Invalid #31 buyer tool contract: ${name}`);
  }
  return definition;
}));

const authFor = (definition, overrides = {}) => ({
  sub: "matrix-buyer",
  role: "user",
  verified: true,
  clientId: "shopsphere-mcp-client",
  grantId: "matrix-grant",
  scopes: [...definition.scopes],
  ...overrides,
});

export const buildBuyerAuthorizationMatrix = () => buyerToolDefinitions.flatMap((definition) => {
  const enabled = { [definition.rollout.flag]: true };
  const wrongRole = ["seller", "admin", "user", "public"]
    .find((role) => !definition.roles.includes(role));
  return [
    { tool: definition.name, scenario: "allowed", boundary: "mcp_and_express", expected: "allow", flags: enabled, auth: authFor(definition) },
    { tool: definition.name, scenario: "unauthenticated", boundary: "mcp_and_express", expected: "deny", flags: enabled, auth: null },
    { tool: definition.name, scenario: "wrong_role", boundary: "mcp_and_express", expected: "deny", flags: enabled, auth: authFor(definition, { role: wrongRole }) },
    { tool: definition.name, scenario: "missing_scope", boundary: "mcp_and_express", expected: "deny", flags: enabled, auth: authFor(definition, { scopes: [] }) },
    { tool: definition.name, scenario: "wrong_scope", boundary: "mcp_and_express", expected: "deny", flags: enabled, auth: authFor(definition, { scopes: [BUYER_SCOPE_ORDER.find((scope) => !definition.scopes.includes(scope))] }) },
    { tool: definition.name, scenario: "disabled", boundary: "mcp_and_express", expected: "deny", flags: { [definition.rollout.flag]: false }, auth: authFor(definition) },
    { tool: definition.name, scenario: "malformed_input", boundary: "mcp_and_express", expected: "deny", runtimeOnly: true },
  ];
});

export const evaluateRegistryMatrix = () => buildBuyerAuthorizationMatrix()
  .filter(({ runtimeOnly }) => !runtimeOnly)
  .map((row) => {
    const definition = definitionsByName.get(row.tool);
    const actual = isToolAvailable(definition, row.flags, row.auth);
    return {
      tool: row.tool,
      scenario: row.scenario,
      expected: row.expected,
      actual,
      passed: actual === (row.expected === "allow"),
    };
  });

export const buyerReleaseMatrixEvidence = () => ({
  schemaVersion: "1.0.0",
  generatedAt: new Date().toISOString(),
  clientId: "shopsphere-mcp-client",
  tools: BUYER_TOOL_NAMES,
  registryChecks: evaluateRegistryMatrix(),
  runtimeRequired: BUYER_RUNTIME_CASES,
});
