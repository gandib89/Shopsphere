const OPERATIONS = Object.freeze({
  get_store_policy: "/api/v1/assistant/get_store_policy",
  search_products: "/api/v1/assistant/search_products",
  compare_products: "/api/v1/assistant/compare_products",
  get_product: "/api/v1/assistant/get_product",
  get_product_reviews: "/api/v1/assistant/get_product_reviews",
  get_recommendations: "/api/v1/assistant/get_recommendations",
  get_my_profile_summary: "/api/v1/assistant/get_my_profile_summary",
});

const PRIVATE_SCOPES = Object.freeze({
  get_my_profile_summary: Object.freeze(["profile:read"]),
});

export const createBackendClient = ({ origin, token, exchangeToken, timeoutMs = 10_000, fetchImpl = fetch }) => {
  if (!origin || !token) throw new Error("MCP backend origin and token are required");
  const base = new URL(origin);
  if (!/^https:$/.test(base.protocol) && base.hostname !== "127.0.0.1" && base.hostname !== "localhost" && base.hostname !== "backend") {
    throw new Error("MCP backend origin must use HTTPS outside the private local network");
  }

  return Object.freeze({
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
