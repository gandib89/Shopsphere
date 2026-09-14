import {
  DEFAULT_MAX_REQUEST_BYTES,
  DEFAULT_MAX_RESPONSE_BYTES,
} from "./toolRegistry.js";

const parseBoolean = (value, fallback) => {
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  return value.toLowerCase() === "true";
};

const parsePositiveInteger = (value, fallback, name) => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
};

export const readConfig = (environment = process.env) => ({
  host: environment.MCP_HOST ?? "127.0.0.1",
  port: parsePositiveInteger(environment.MCP_PORT, 4100, "MCP_PORT"),
  enabled: parseBoolean(environment.MCP_ENABLED, false),
  accessToken: environment.MCP_ACCESS_TOKEN,
  backendOrigin: environment.MCP_BACKEND_ORIGIN ?? "http://127.0.0.1:4000",
  backendToken: environment.ASSISTANT_API_TOKEN,
  backendTimeoutMs: parsePositiveInteger(
    environment.MCP_BACKEND_TIMEOUT_MS,
    10_000,
    "MCP_BACKEND_TIMEOUT_MS",
  ),
  requestsPerMinute: parsePositiveInteger(
    environment.MCP_REQUESTS_PER_MINUTE,
    60,
    "MCP_REQUESTS_PER_MINUTE",
  ),
  maxConcurrency: parsePositiveInteger(
    environment.MCP_MAX_CONCURRENCY,
    4,
    "MCP_MAX_CONCURRENCY",
  ),
  allowedOrigins: (environment.MCP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  maxRequestBytes: parsePositiveInteger(
    environment.MCP_MAX_REQUEST_BYTES,
    DEFAULT_MAX_REQUEST_BYTES,
    "MCP_MAX_REQUEST_BYTES",
  ),
  maxResponseBytes: parsePositiveInteger(
    environment.MCP_MAX_RESPONSE_BYTES,
    DEFAULT_MAX_RESPONSE_BYTES,
    "MCP_MAX_RESPONSE_BYTES",
  ),
  flags: {
    MCP_TOOL_GET_CAPABILITIES_ENABLED: parseBoolean(
      environment.MCP_TOOL_GET_CAPABILITIES_ENABLED,
      false,
    ),
    MCP_TOOL_GET_STORE_POLICY_ENABLED: parseBoolean(
      environment.MCP_TOOL_GET_STORE_POLICY_ENABLED,
      false,
    ),
    MCP_TOOL_SEARCH_PRODUCTS_ENABLED: parseBoolean(
      environment.MCP_TOOL_SEARCH_PRODUCTS_ENABLED,
      false,
    ),
    MCP_TOOL_COMPARE_PRODUCTS_ENABLED: parseBoolean(
      environment.MCP_TOOL_COMPARE_PRODUCTS_ENABLED,
      false,
    ),
    MCP_TOOL_GET_PRODUCT_ENABLED: parseBoolean(
      environment.MCP_TOOL_GET_PRODUCT_ENABLED,
      false,
    ),
    MCP_TOOL_GET_PRODUCT_REVIEWS_ENABLED: parseBoolean(
      environment.MCP_TOOL_GET_PRODUCT_REVIEWS_ENABLED,
      false,
    ),
    MCP_TOOL_GET_RECOMMENDATIONS_ENABLED: parseBoolean(
      environment.MCP_TOOL_GET_RECOMMENDATIONS_ENABLED,
      false,
    ),
  },
});
