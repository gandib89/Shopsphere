import {
  DEFAULT_MAX_REQUEST_BYTES,
  DEFAULT_MAX_RESPONSE_BYTES,
} from "./toolRegistry.js";

const parseBoolean = (value, fallback) => {
  if (value === undefined) return fallback;
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
  enabled: parseBoolean(environment.MCP_ENABLED, true),
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
      true,
    ),
    MCP_TOOL_SEARCH_PRODUCTS_ENABLED: parseBoolean(
      environment.MCP_TOOL_SEARCH_PRODUCTS_ENABLED,
      true,
    ),
    MCP_TOOL_COMPARE_PRODUCTS_ENABLED: parseBoolean(
      environment.MCP_TOOL_COMPARE_PRODUCTS_ENABLED,
      true,
    ),
  },
});
