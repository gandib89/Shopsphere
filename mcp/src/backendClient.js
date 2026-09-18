const OPERATIONS = Object.freeze({
  get_store_policy: "/api/v1/assistant/get_store_policy",
  search_products: "/api/v1/assistant/search_products",
  compare_products: "/api/v1/assistant/compare_products",
  get_product: "/api/v1/assistant/get_product",
  get_product_reviews: "/api/v1/assistant/get_product_reviews",
  get_recommendations: "/api/v1/assistant/get_recommendations",
  get_my_profile_summary: "/api/v1/assistant/get_my_profile_summary",
  list_my_notifications: "/api/v1/assistant/list_my_notifications",
  get_my_cart: "/api/v1/assistant/get_my_cart",
  validate_promo_code: "/api/v1/assistant/validate_promo_code",
  preview_checkout: "/api/v1/assistant/preview_checkout",
  list_my_orders: "/api/v1/assistant/list_my_orders",
  get_my_order: "/api/v1/assistant/get_my_order",
  track_my_order: "/api/v1/assistant/track_my_order",
  get_my_bill_summary: "/api/v1/assistant/get_my_bill_summary",
  get_my_payment_status: "/api/v1/assistant/get_my_payment_status",
  list_my_products: "/api/v1/assistant/list_my_products",
  get_my_product: "/api/v1/assistant/get_my_product",
  get_my_inventory_summary: "/api/v1/assistant/get_my_inventory_summary",
  list_my_seller_orders: "/api/v1/assistant/list_my_seller_orders",
  get_my_seller_order: "/api/v1/assistant/get_my_seller_order",
  get_my_revenue_summary: "/api/v1/assistant/get_my_revenue_summary",
  draft_listing_copy: "/api/v1/assistant/draft_listing_copy",
  save_listing_draft: "/api/v1/assistant/save_listing_draft",
  list_my_listing_drafts: "/api/v1/assistant/list_my_listing_drafts",
  get_my_listing_draft: "/api/v1/assistant/get_my_listing_draft",
});

const PRIVATE_SCOPES = Object.freeze({
  get_my_profile_summary: Object.freeze(["profile:read"]),
  list_my_notifications: Object.freeze(["notifications:read"]),
  get_my_cart: Object.freeze(["cart:read"]),
  validate_promo_code: Object.freeze(["cart:read"]),
  preview_checkout: Object.freeze(["cart:read"]),
  list_my_orders: Object.freeze(["orders:read"]),
  get_my_order: Object.freeze(["orders:read"]),
  track_my_order: Object.freeze(["orders:read"]),
  get_my_bill_summary: Object.freeze(["orders:read"]),
  get_my_payment_status: Object.freeze(["orders:read"]),
  list_my_products: Object.freeze(["catalog:read"]),
  get_my_product: Object.freeze(["catalog:read"]),
  get_my_inventory_summary: Object.freeze(["catalog:read"]),
  list_my_seller_orders: Object.freeze(["sales:read"]),
  get_my_seller_order: Object.freeze(["sales:read"]),
  get_my_revenue_summary: Object.freeze(["revenue:read"]),
  draft_listing_copy: Object.freeze(["listings:draft"]),
  save_listing_draft: Object.freeze(["listings:draft"]),
  list_my_listing_drafts: Object.freeze(["listings:draft"]),
  get_my_listing_draft: Object.freeze(["listings:draft"]),
});

export const createBackendClient = ({ origin, token, exchangeToken, timeoutMs = 10_000, fetchImpl = fetch }) => {
  if (!origin || !token) throw new Error("MCP backend origin and token are required");
  const base = new URL(origin);
  if (!/^https:$/.test(base.protocol) && base.hostname !== "127.0.0.1" && base.hostname !== "localhost" && base.hostname !== "backend") {
    throw new Error("MCP backend origin must use HTTPS outside the private local network");
  }

  return Object.freeze({
    async recordAudit(event, context = {}) {
      const response = await fetchImpl(new URL("/api/v1/assistant/audit", base), {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          "x-assistant-api-token": token,
          "content-type": "application/json",
          ...(context.requestId ? { "x-request-id": context.requestId } : {}),
        },
        body: JSON.stringify(event),
      });
      if (!response.ok) throw Object.assign(new Error("Durable audit unavailable"), { statusCode: 503 });
    },
    async resolveAuthorization(context) {
      if (!exchangeToken || !context?.subjectToken || !context?.auth) {
        throw Object.assign(new Error("Delegated authorization is unavailable"), { statusCode: 401 });
      }
      const delegatedToken = await exchangeToken(context.subjectToken, context.auth.scopes);
      const response = await fetchImpl(new URL("/api/v1/assistant/authorization-context", base), {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          authorization: `Bearer ${delegatedToken}`,
          "x-assistant-api-token": token,
          "content-type": "application/json",
          ...(context.requestId ? { "x-request-id": context.requestId } : {}),
        },
        body: "{}",
      });
      if (!response.ok) {
        throw Object.assign(new Error("Delegated authorization failed"), { statusCode: response.status });
      }
      const live = await response.json();
      return { ...context, auth: { ...context.auth, ...live } };
    },
    async call(name, input, context = {}) {
      const path = OPERATIONS[name];
      if (!path) throw new Error("Unknown backend operation");
      const privateScopes = PRIVATE_SCOPES[name];
      const delegatedToken = privateScopes
        ? await exchangeToken?.(context.subjectToken, privateScopes)
        : null;
      if (privateScopes && !delegatedToken) throw Object.assign(new Error("Delegated credential required"), { statusCode: 401 });
      const response = await fetchImpl(new URL(path, base), {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          authorization: `Bearer ${delegatedToken ?? token}`,
          ...(delegatedToken ? { "x-assistant-api-token": token } : {}),
          "content-type": "application/json",
          ...(context.requestId ? { "x-request-id": context.requestId } : {}),
        },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const error = new Error(response.status === 404 ? "Resource not found" : "Backend operation failed");
        error.statusCode = response.status;
        throw error;
      }
      return response.json();
    },
  });
};
