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
  oauthIssuer: environment.MCP_OAUTH_ISSUER,
  oauthJwksUri: environment.MCP_OAUTH_JWKS_URI,
  oauthTokenEndpoint: environment.MCP_OAUTH_TOKEN_ENDPOINT,
  oauthIntrospectionEndpoint: environment.MCP_OAUTH_INTROSPECTION_ENDPOINT,
  oauthAudience: environment.MCP_OAUTH_AUDIENCE ?? "shopsphere-mcp",
  resourceUrl: environment.MCP_RESOURCE_URL,
  oauthClientId: environment.MCP_WORKLOAD_CLIENT_ID ?? "shopsphere-mcp-workload",
  oauthClientSecret: environment.MCP_WORKLOAD_CLIENT_SECRET,
  assistantAudience: environment.ASSISTANT_AUDIENCE ?? "shopsphere-assistant-api",
  trustedClients: (environment.MCP_OAUTH_CLIENTS ?? "shopsphere-mcp-client")
    .split(",")
    .map((client) => client.trim())
    .filter(Boolean),
  backendOrigin: environment.MCP_BACKEND_ORIGIN ?? "http://127.0.0.1:4000",
  redisUrl: environment.REDIS_URL,
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
    MCP_TOOL_GET_MY_PROFILE_SUMMARY_ENABLED: parseBoolean(
      environment.MCP_TOOL_GET_MY_PROFILE_SUMMARY_ENABLED,
      false,
    ),
    MCP_TOOL_LIST_MY_NOTIFICATIONS_ENABLED: parseBoolean(
      environment.MCP_TOOL_LIST_MY_NOTIFICATIONS_ENABLED,
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
    MCP_TOOL_GET_MY_CART_ENABLED: parseBoolean(
      environment.MCP_TOOL_GET_MY_CART_ENABLED,
      false,
    ),
    MCP_TOOL_VALIDATE_PROMO_CODE_ENABLED: parseBoolean(
      environment.MCP_TOOL_VALIDATE_PROMO_CODE_ENABLED,
      false,
    ),
    MCP_TOOL_PREVIEW_CHECKOUT_ENABLED: parseBoolean(
      environment.MCP_TOOL_PREVIEW_CHECKOUT_ENABLED,
      false,
    ),
    MCP_TOOL_LIST_MY_ORDERS_ENABLED: parseBoolean(
      environment.MCP_TOOL_LIST_MY_ORDERS_ENABLED,
      false,
    ),
    MCP_TOOL_GET_MY_ORDER_ENABLED: parseBoolean(
      environment.MCP_TOOL_GET_MY_ORDER_ENABLED,
      false,
    ),
    MCP_TOOL_TRACK_MY_ORDER_ENABLED: parseBoolean(
      environment.MCP_TOOL_TRACK_MY_ORDER_ENABLED,
      false,
    ),
    MCP_TOOL_GET_MY_BILL_SUMMARY_ENABLED: parseBoolean(
      environment.MCP_TOOL_GET_MY_BILL_SUMMARY_ENABLED,
      false,
    ),
    MCP_TOOL_GET_MY_PAYMENT_STATUS_ENABLED: parseBoolean(
      environment.MCP_TOOL_GET_MY_PAYMENT_STATUS_ENABLED,
      false,
    ),
    MCP_TOOL_LIST_MY_PRODUCTS_ENABLED: parseBoolean(
      environment.MCP_TOOL_LIST_MY_PRODUCTS_ENABLED,
      false,
    ),
    MCP_TOOL_GET_MY_PRODUCT_ENABLED: parseBoolean(
      environment.MCP_TOOL_GET_MY_PRODUCT_ENABLED,
      false,
    ),
    MCP_TOOL_GET_MY_INVENTORY_SUMMARY_ENABLED: parseBoolean(
      environment.MCP_TOOL_GET_MY_INVENTORY_SUMMARY_ENABLED,
      false,
    ),
    MCP_TOOL_LIST_MY_SELLER_ORDERS_ENABLED: parseBoolean(
      environment.MCP_TOOL_LIST_MY_SELLER_ORDERS_ENABLED,
      false,
    ),
    MCP_TOOL_GET_MY_SELLER_ORDER_ENABLED: parseBoolean(
      environment.MCP_TOOL_GET_MY_SELLER_ORDER_ENABLED,
      false,
    ),
    MCP_TOOL_GET_MY_REVENUE_SUMMARY_ENABLED: parseBoolean(
      environment.MCP_TOOL_GET_MY_REVENUE_SUMMARY_ENABLED,
      false,
    ),
    MCP_TOOL_GET_PLATFORM_REVENUE_SUMMARY_ENABLED: parseBoolean(
      environment.MCP_TOOL_GET_PLATFORM_REVENUE_SUMMARY_ENABLED,
      false,
    ),
    MCP_TOOL_LIST_SELLER_APPLICATIONS_ENABLED: parseBoolean(
      environment.MCP_TOOL_LIST_SELLER_APPLICATIONS_ENABLED,
      false,
    ),
    MCP_TOOL_DRAFT_LISTING_COPY_ENABLED: parseBoolean(
      environment.MCP_TOOL_DRAFT_LISTING_COPY_ENABLED,
      false,
    ),
    MCP_TOOL_SAVE_LISTING_DRAFT_ENABLED: parseBoolean(
      environment.MCP_TOOL_SAVE_LISTING_DRAFT_ENABLED,
      false,
    ),
    MCP_TOOL_LIST_MY_LISTING_DRAFTS_ENABLED: parseBoolean(
      environment.MCP_TOOL_LIST_MY_LISTING_DRAFTS_ENABLED,
      false,
    ),
    MCP_TOOL_GET_MY_LISTING_DRAFT_ENABLED: parseBoolean(
      environment.MCP_TOOL_GET_MY_LISTING_DRAFT_ENABLED,
      false,
    ),
    MCP_TOOL_PROPOSE_CART_CHANGE_ENABLED: parseBoolean(
      environment.MCP_TOOL_PROPOSE_CART_CHANGE_ENABLED,
      false,
    ),
    MCP_TOOL_PROPOSE_ORDER_RETURN_ENABLED: parseBoolean(
      environment.MCP_TOOL_PROPOSE_ORDER_RETURN_ENABLED,
      false,
    ),
    MCP_TOOL_GET_MY_ACTION_STATUS_ENABLED: parseBoolean(
      environment.MCP_TOOL_GET_MY_ACTION_STATUS_ENABLED,
      false,
    ),
    MCP_TOOL_PROPOSE_ORDER_CANCELLATION_ENABLED: parseBoolean(
      environment.MCP_TOOL_PROPOSE_ORDER_CANCELLATION_ENABLED,
      false,
    ),
    MCP_TOOL_PROPOSE_LISTING_PUBLISH_ENABLED: parseBoolean(
      environment.MCP_TOOL_PROPOSE_LISTING_PUBLISH_ENABLED,
      false,
    ),
    MCP_TOOL_PROPOSE_LISTING_CONTENT_CHANGE_ENABLED: parseBoolean(
      environment.MCP_TOOL_PROPOSE_LISTING_CONTENT_CHANGE_ENABLED,
      false,
    ),
    MCP_TOOL_PROPOSE_PRICE_CHANGE_ENABLED: parseBoolean(
      environment.MCP_TOOL_PROPOSE_PRICE_CHANGE_ENABLED,
      false,
    ),
    MCP_TOOL_LIST_ORDER_EXCEPTION_QUEUE_ENABLED: parseBoolean(
      environment.MCP_TOOL_LIST_ORDER_EXCEPTION_QUEUE_ENABLED,
      false,
    ),
    MCP_TOOL_GET_ORDER_EXCEPTION_DETAIL_ENABLED: parseBoolean(
      environment.MCP_TOOL_GET_ORDER_EXCEPTION_DETAIL_ENABLED,
      false,
    ),
    MCP_TOOL_LIST_RETURN_QUEUE_ENABLED: parseBoolean(
      environment.MCP_TOOL_LIST_RETURN_QUEUE_ENABLED,
      false,
    ),
    MCP_TOOL_DRAFT_SUPPORT_MESSAGE_ENABLED: parseBoolean(
      environment.MCP_TOOL_DRAFT_SUPPORT_MESSAGE_ENABLED,
      false,
    ),
    MCP_TOOL_LIST_PROMOTION_CONFIGURATION_ENABLED: parseBoolean(
      environment.MCP_TOOL_LIST_PROMOTION_CONFIGURATION_ENABLED,
      false,
    ),
    MCP_TOOL_GET_PROMOTION_USAGE_SUMMARY_ENABLED: parseBoolean(
      environment.MCP_TOOL_GET_PROMOTION_USAGE_SUMMARY_ENABLED,
      false,
    ),
    MCP_TOOL_DRAFT_SELLER_REVIEW_RECOMMENDATION_ENABLED: parseBoolean(
      environment.MCP_TOOL_DRAFT_SELLER_REVIEW_RECOMMENDATION_ENABLED,
      false,
    ),
    MCP_TOOL_DRAFT_RETURN_REVIEW_RECOMMENDATION_ENABLED: parseBoolean(
      environment.MCP_TOOL_DRAFT_RETURN_REVIEW_RECOMMENDATION_ENABLED,
      false,
    ),
    MCP_TOOL_DRAFT_PROMOTION_RECOMMENDATION_ENABLED: parseBoolean(
      environment.MCP_TOOL_DRAFT_PROMOTION_RECOMMENDATION_ENABLED,
      false,
    ),
  },
});
