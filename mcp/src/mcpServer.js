import { McpServer } from "@modelcontextprotocol/server";
import crypto from "node:crypto";

import {
  REGISTRY_VERSION,
  describeCapabilities,
  isToolAvailable,
  toolRegistry,
} from "./toolRegistry.js";

export const createShopSphereMcpServer = ({
  flags = {},
  maxRequestBytes,
  maxResponseBytes,
  backendClient,
  authContext,
  audit = () => {},
}) => {
  const server = new McpServer({
    name: "shopsphere-mcp",
    version: "1.0.0",
  });

  // Per-tool handlers keyed by registry name. Other issue agents add their own
  // entry here; unknown registry names are skipped so tools register idempotently.
  const handlers = {
    get_capabilities: () =>
      describeCapabilities({ flags, maxRequestBytes, maxResponseBytes, auth: authContext }),
    get_my_profile_summary: (args, requestId) => backendClient.call("get_my_profile_summary", args, requestId),
    list_my_notifications: (args, requestId) => backendClient.call("list_my_notifications", args, requestId),
    get_my_cart: (args, requestId) => backendClient.call("get_my_cart", args, requestId),
    validate_promo_code: (args, requestId) => backendClient.call("validate_promo_code", args, requestId),
    preview_checkout: (args, requestId) => backendClient.call("preview_checkout", args, requestId),
    list_my_orders: (args, requestId) => backendClient.call("list_my_orders", args, requestId),
    get_my_order: (args, requestId) => backendClient.call("get_my_order", args, requestId),
    track_my_order: (args, requestId) => backendClient.call("track_my_order", args, requestId),
    get_my_bill_summary: (args, requestId) => backendClient.call("get_my_bill_summary", args, requestId),
    get_my_payment_status: (args, requestId) => backendClient.call("get_my_payment_status", args, requestId),
    list_my_products: (args, requestId) => backendClient.call("list_my_products", args, requestId),
    get_my_product: (args, requestId) => backendClient.call("get_my_product", args, requestId),
    get_my_inventory_summary: (args, requestId) => backendClient.call("get_my_inventory_summary", args, requestId),
    list_my_seller_orders: (args, requestId) => backendClient.call("list_my_seller_orders", args, requestId),
    get_my_seller_order: (args, requestId) => backendClient.call("get_my_seller_order", args, requestId),
    get_my_revenue_summary: (args, requestId) => backendClient.call("get_my_revenue_summary", args, requestId),
    propose_cart_change: (args, requestId) => backendClient.call("propose_cart_change", args, requestId),
    get_my_action_status: (args, requestId) => backendClient.call("get_my_action_status", args, requestId),
    get_store_policy: (args, requestId) => backendClient.call("get_store_policy", args, requestId),
    search_products: (args, requestId) => backendClient.call("search_products", args, requestId),
    compare_products: (args, requestId) => backendClient.call("compare_products", args, requestId),
    get_product: (args, requestId) => backendClient.call("get_product", args, requestId),
    get_product_reviews: (args, requestId) => backendClient.call("get_product_reviews", args, requestId),
    get_recommendations: (args, requestId) => backendClient.call("get_recommendations", args, requestId),
  };

  for (const tool of toolRegistry.filter((definition) => isToolAvailable(definition, flags, authContext))) {
    const handle = handlers[tool.name];
    if (!handle) continue;

    // propose-class tools create durable records, so they must not advertise
    // themselves as read-only (clients may auto-approve on that hint).
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        annotations: { readOnlyHint: tool.operationClass === "read" },
      },
      async (args, extra) => {
        const startedAt = Date.now();
        const requestId = extra?.requestInfo?.headers?.get("x-request-id");
        try {
          const output = await handle(args, requestId);
          const serialized = JSON.stringify(output);
          await audit({
            requestId,
            tool: tool.name,
            registryVersion: REGISTRY_VERSION,
            operation: tool.backendOperation.operationId,
            outcome: "success",
            durationMs: Date.now() - startedAt,
            responseBytes: Buffer.byteLength(serialized),
            responseDigest: crypto.createHash("sha256").update(serialized).digest("base64url"),
            fields: Object.keys(output),
          });
          return {
            content: [{ type: "text", text: serialized }],
            structuredContent: output,
          };
        } catch (error) {
          const reason = error?.statusCode === 404 ? "not_found" : "backend_error";
          await audit({
            requestId,
            tool: tool.name,
            registryVersion: REGISTRY_VERSION,
            operation: tool.backendOperation.operationId,
            outcome: "error",
            reason,
            durationMs: Date.now() - startedAt,
          });
          throw Object.assign(
            new Error(reason === "not_found" ? "Resource not found" : "ShopSphere operation unavailable"),
            { statusCode: error?.statusCode },
          );
        }
      },
    );
  }

  return server;
};
