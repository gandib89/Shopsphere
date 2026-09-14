const OPERATIONS = Object.freeze({
  get_store_policy: "/api/v1/assistant/get_store_policy",
  search_products: "/api/v1/assistant/search_products",
  compare_products: "/api/v1/assistant/compare_products",
  get_product: "/api/v1/assistant/get_product",
  get_product_reviews: "/api/v1/assistant/get_product_reviews",
  get_recommendations: "/api/v1/assistant/get_recommendations",
});

export const createBackendClient = ({ origin, token, timeoutMs = 10_000, fetchImpl = fetch }) => {
  if (!origin || !token) throw new Error("MCP backend origin and token are required");
  const base = new URL(origin);
  if (!/^https:$/.test(base.protocol) && base.hostname !== "127.0.0.1" && base.hostname !== "localhost" && base.hostname !== "backend") {
    throw new Error("MCP backend origin must use HTTPS outside the private local network");
  }

  return Object.freeze({
    async call(name, input, context = {}) {
      const path = OPERATIONS[name];
      if (!path) throw new Error("Unknown backend operation");
      const response = await fetchImpl(new URL(path, base), {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          authorization: `Bearer ${token}`,
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
