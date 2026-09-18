import crypto from "node:crypto";
import express from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";

import {
  comparePublicProducts,
  getPublicProduct,
  getPublicProductReviews,
  getPublicRecommendations,
  searchPublicProducts,
} from "../services/assistantPublicCatalog.js";
import { getApprovedPolicy, POLICY_TOPICS } from "../services/assistantPolicy.js";
import { ASSISTANT_POLICY_VERSION } from "../services/assistantPublicCatalog.js";
import { listMyNotifications } from "../services/assistantNotifications.js";
import { getMyCart, previewCheckout, validatePromoCode } from "../services/assistantCart.js";
import {
  getMyBillSummary,
  getMyOrder,
  getMyPaymentStatus,
  listMyOrders,
  trackMyOrder,
} from "../services/assistantBuyerOrders.js";
import {
  getMyInventorySummary,
  getMyProduct,
  listMyProducts,
} from "../services/assistantSellerCatalog.js";
import {
  getMySale,
  getMyRevenueSummary,
  listMySales,
} from "../services/assistantSellerOrders.js";
import {
  getOrderExceptionDetail,
  listOrderExceptionQueue,
  listReturnQueue,
  orderExceptionDetailObserve,
} from "../services/assistantAdminQueues.js";
import { auditContext, recordAssistantAudit } from "../services/assistantAudit.js";
import { withAssistantActor } from "../database/assistantTransaction.js";
import {
  authenticateAssistantDelegation,
  authenticateAssistantWorkload,
  authorizeAssistantOperation,
  enforceAssistantDistributedLimit,
} from "../middlewares/assistantDelegation.js";

const router = express.Router();
const decimal = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/);
const productId = z.string().min(1).max(100);
const orderId = z.string().min(1).max(100);
const cursor = z.string().min(1).max(2048).optional();
const notificationInput = z.object({
  cursor,
  limit: z.number().int().min(1).max(50).optional(),
}).strict();
const remoteAuditInput = z.object({
  traceId: z.string().min(1).max(100).optional(),
  subjectId: z.string().max(24).nullable().optional(),
  role: z.string().max(20).nullable().optional(),
  clientId: z.string().max(200).nullable().optional(),
  workloadId: z.string().max(200).nullable().optional(),
  grantId: z.string().max(200).nullable().optional(),
  policyVersion: z.string().min(1).max(50).optional(),
  tool: z.string().max(100).nullable().optional(),
  operation: z.string().min(1).max(100),
  authorizationOutcome: z.enum(["allowed", "denied"]),
  outcome: z.string().min(1).max(50),
  returnedFields: z.array(z.string().max(100)).max(100).optional(),
  resourceIds: z.array(z.string().max(100)).max(50).optional(),
  responseDigest: z.string().max(100).nullable().optional(),
  responseBytes: z.number().int().nonnegative().max(65_536).nullable().optional(),
  rowCount: z.number().int().nonnegative().max(50).nullable().optional(),
  latencyMs: z.number().int().nonnegative().max(120_000),
  failureReason: z.string().max(100).nullable().optional(),
}).strict();

const schemas = {
  get_store_policy: z.object({ topic: z.enum(POLICY_TOPICS) }).strict(),
  search_products: z
    .object({
      q: z.string().min(1).max(200).optional(),
      category: z.string().min(1).max(100).optional(),
      minPrice: decimal.optional(),
      maxPrice: decimal.optional(),
      sort: z.enum(["price-asc", "price-desc", "name-asc", "name-desc"]).optional(),
      cursor,
      limit: z.number().int().min(1).max(50).optional(),
    })
    .strict()
    .refine(
      ({ minPrice, maxPrice }) =>
        minPrice === undefined || maxPrice === undefined || Number(minPrice) <= Number(maxPrice),
      "minPrice must not exceed maxPrice",
    ),
  compare_products: z.object({ productIds: z.array(productId).min(1).max(5) }).strict(),
  get_product: z.object({ productId }).strict(),
  get_product_reviews: z
    .object({ productId, cursor, limit: z.number().int().min(1).max(50).optional() })
    .strict(),
  get_recommendations: z
    .object({ productId, limit: z.number().int().min(1).max(20).optional() })
    .strict(),
};

const operations = {
  get_store_policy: (input) => getApprovedPolicy(input.topic),
  search_products: (input) =>
    searchPublicProducts(input, { cursorSecret: process.env.ASSISTANT_CURSOR_SECRET }),
  compare_products: (input) => comparePublicProducts(input),
  get_product: (input) => getPublicProduct(input),
  get_product_reviews: (input) =>
    getPublicProductReviews(input, { cursorSecret: process.env.ASSISTANT_CURSOR_SECRET }),
  get_recommendations: (input) => getPublicRecommendations(input),
};

const safeEqual = (left, right) => {
  const a = Buffer.from(left || "");
  const b = Buffer.from(right || "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const authenticatePublicWorkload = (req, res, next) => {
  const expected = process.env.ASSISTANT_API_TOKEN;
  const authorization = req.get("authorization") || "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!expected || !safeEqual(supplied, expected)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
};

router.use(
  rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) =>
      crypto.createHash("sha256").update(req.get("authorization") || req.ip).digest("base64url"),
  }),
);

const authenticatedContext = [
  authenticateAssistantWorkload,
  authenticateAssistantDelegation,
  enforceAssistantDistributedLimit(),
  authorizeAssistantOperation(),
];

const auditedJson = async (req, res, { operation, tool, input = {}, output, startedAt, resourceIds, rowCount }) => {
  try {
    await recordAssistantAudit(auditContext(req, {
      policyVersion: ASSISTANT_POLICY_VERSION,
      operation,
      tool,
      input,
      response: output,
      rowCount: rowCount ?? (Array.isArray(output?.notifications) ? output.notifications.length : null),
      resourceIds: resourceIds ?? output?.notifications?.map(({ id }) => id) ?? [],
      authorizationOutcome: "allowed",
      outcome: "success",
      latencyMs: Date.now() - startedAt,
    }));
    return res.json(output);
  } catch {
    return res.status(503).json({ code: "audit_unavailable", message: "Audit service is unavailable" });
  }
};

const auditedError = async (req, res, { operation, tool, input = {}, status, code, startedAt }) => {
  try {
    await recordAssistantAudit(auditContext(req, {
      policyVersion: ASSISTANT_POLICY_VERSION,
      operation,
      tool,
      input,
      authorizationOutcome: status === 400 ? "allowed" : "denied",
      outcome: code,
      failureReason: code,
      latencyMs: Date.now() - startedAt,
    }));
    return res.status(status).json({
      code,
      message: status === 404
        ? "Resource not found"
        : status === 400
          ? "Invalid operation input"
          : "Assistant operation is unavailable",
    });
  } catch {
    return res.status(503).json({ code: "audit_unavailable", message: "Audit service is unavailable" });
  }
};

export const sendAuthorizationContext = async (req, res) => {
  const startedAt = Date.now();
  const output = {
    subject: req.assistantAccount.id,
    role: req.assistantAccount.role,
    verified: Boolean(req.assistantAccount.isVerified),
    scopes: req.delegation.scopes,
    grantId: req.delegation.grantId,
  };
  return auditedJson(req, res, { operation: "authorization.resolve", tool: "tools/list", output, startedAt });
};

export const profileSummary = (req) => ({
  displayName: `${req.assistantAccount.firstName} ${req.assistantAccount.lastName}`.trim(),
  role: req.assistantAccount.role,
  verified: Boolean(req.assistantAccount.isVerified),
});

export const sendProfileSummary = (req, res) => res.json(profileSummary(req));

router.post("/audit", authenticateAssistantWorkload, async (req, res) => {
  const parsed = remoteAuditInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ code: "invalid_audit", message: "Invalid audit event" });
  try {
    await recordAssistantAudit({ ...parsed.data, layer: "mcp", input: {} });
    return res.status(204).end();
  } catch {
    return res.status(503).json({ code: "audit_unavailable", message: "Audit service is unavailable" });
  }
});

router.post("/authorization-context", ...authenticatedContext, sendAuthorizationContext);

router.post(
  "/get_my_profile_summary",
  authenticateAssistantWorkload,
  authenticateAssistantDelegation,
  enforceAssistantDistributedLimit(),
  authorizeAssistantOperation({
    operation: "profile.getMySummary",
    scope: "profile:read",
    rolloutFlag: "MCP_TOOL_GET_MY_PROFILE_SUMMARY_ENABLED",
  }),
  async (req, res) => auditedJson(req, res, {
    operation: "profile.getMySummary",
    tool: "get_my_profile_summary",
    output: profileSummary(req),
    startedAt: Date.now(),
  }),
);

router.post(
  "/list_my_notifications",
  authenticateAssistantWorkload,
  authenticateAssistantDelegation,
  enforceAssistantDistributedLimit(),
  authorizeAssistantOperation({
    operation: "notifications.listMine",
    scope: "notifications:read",
    rolloutFlag: "MCP_TOOL_LIST_MY_NOTIFICATIONS_ENABLED",
  }),
  async (req, res) => {
    const startedAt = Date.now();
    const parsed = notificationInput.safeParse(req.body);
    if (!parsed.success) return auditedError(req, res, {
      operation: "notifications.listMine",
      tool: "list_my_notifications",
      input: {},
      status: 400,
      code: "invalid_input",
      startedAt,
    });
    try {
      const output = await withAssistantActor({
        actorId: req.delegation.sub,
        role: req.delegation.role,
        operation: "notifications.listMine",
        signal: req.assistantSignal,
      }, (tx) => listMyNotifications(parsed.data, {
        client: tx,
        principal: {
          subject: req.delegation.sub,
          role: req.delegation.role,
          clientId: req.delegation.clientId,
          grantId: req.delegation.grantId,
        },
        cursorSecret: process.env.ASSISTANT_CURSOR_SECRET,
      }));
      return auditedJson(req, res, {
        operation: "notifications.listMine",
        tool: "list_my_notifications",
        input: parsed.data,
        output,
        startedAt,
      });
    } catch (error) {
      const status = error?.statusCode === 404 ? 404 : error?.statusCode === 503 ? 503 : 500;
      return auditedError(req, res, {
        operation: "notifications.listMine",
        tool: "list_my_notifications",
        input: parsed.data,
        status,
        code: status === 404 ? "not_found" : "operation_unavailable",
        startedAt,
      });
    }
  },
);

// Shared private-operation seam for buyer/seller reads (#12/#13/#14) and
// admin support queues (#17).
// Every operation crosses the same chain: workload authentication, delegated
// credential verification (no browser-JWT fallback), distributed limits,
// and per-call role/scope/rollout authorization. Inputs are strict schemas
// (unknown fields rejected, no caller totals/identity/owner fields); reads run
// inside a transaction-local actor context; success and failure both audit.
const privateOperation = ({ path, tool, operation, roles, scope, rolloutFlag, inputSchema, run, observe }) => {
  router.post(
    path,
    authenticateAssistantWorkload,
    authenticateAssistantDelegation,
    enforceAssistantDistributedLimit(),
    authorizeAssistantOperation({ operation, roles, scope, rolloutFlag }),
    async (req, res) => {
      const startedAt = Date.now();
      const parsed = inputSchema.safeParse(req.body);
      if (!parsed.success) return auditedError(req, res, {
        operation,
        tool,
        input: {},
        status: 400,
        code: "invalid_input",
        startedAt,
      });
      try {
        const output = await withAssistantActor({
          actorId: req.delegation.sub,
          role: req.delegation.role,
          operation,
          signal: req.assistantSignal,
        }, (tx) => run(parsed.data, {
          client: tx,
          principal: {
            subject: req.delegation.sub,
            role: req.delegation.role,
            clientId: req.delegation.clientId,
            grantId: req.delegation.grantId,
          },
          cursorSecret: process.env.ASSISTANT_CURSOR_SECRET,
          now: new Date(),
        }));
        const observed = observe?.(output, parsed.data) ?? {};
        const { resourceIds = [], rowCount = null, auditMetadata = null } = observed;
        // Observe-provided audit metadata (e.g. the detail tool's support
        // purpose) rides through the established audited-input path, so it
        // lands in the durable event's redacted input after sanitization.
        return auditedJson(req, res, {
          operation,
          tool,
          input: auditMetadata ? { ...parsed.data, ...auditMetadata } : parsed.data,
          output,
          startedAt,
          resourceIds,
          rowCount,
        });
      } catch (error) {
        const status = error?.statusCode === 404 ? 404 : error?.statusCode === 400 ? 400 : error?.statusCode === 503 ? 503 : 500;
        return auditedError(req, res, {
          operation,
          tool,
          input: parsed.data,
          status,
          code: status === 404 ? "not_found" : status === 400 ? "invalid_input" : "operation_unavailable",
          startedAt,
        });
      }
    },
  );
};

const isoDateTime = z.string().min(1).max(100).optional();
const orderStatus = z.enum(["Pending", "Confirmed", "Processing", "Shipped", "Delivered", "Cancelled", "ReturnRequested", "Returned"]).optional();
const sellerSaleStatus = z.enum(["Pending", "Confirmed", "Processing", "Shipped", "Delivered", "Cancelled", "ReturnRequested", "Returned", "Refund Released"]).optional();

privateOperation({
  path: "/get_my_cart",
  tool: "get_my_cart",
  operation: "cart.getMine",
  roles: ["user"],
  scope: "cart:read",
  rolloutFlag: "MCP_TOOL_GET_MY_CART_ENABLED",
  inputSchema: z.object({}).strict(),
  run: (input, ctx) => getMyCart(input, ctx),
  observe: (output) => ({ resourceIds: output.items.map(({ productId }) => productId), rowCount: output.items.length }),
});

privateOperation({
  path: "/validate_promo_code",
  tool: "validate_promo_code",
  operation: "cart.validatePromo",
  roles: ["user"],
  scope: "cart:read",
  rolloutFlag: "MCP_TOOL_VALIDATE_PROMO_CODE_ENABLED",
  inputSchema: z.object({ code: z.string().min(1).max(50) }).strict(),
  run: (input, ctx) => validatePromoCode(input, ctx),
  observe: (output) => ({ resourceIds: output.code ? [output.code] : [], rowCount: output.valid ? 1 : 0 }),
});

privateOperation({
  path: "/preview_checkout",
  tool: "preview_checkout",
  operation: "cart.previewCheckout",
  roles: ["user"],
  scope: "cart:read",
  rolloutFlag: "MCP_TOOL_PREVIEW_CHECKOUT_ENABLED",
  inputSchema: z.object({ promoCode: z.string().min(1).max(50).optional() }).strict(),
  run: (input, ctx) => previewCheckout(input, ctx),
  observe: (output) => ({ resourceIds: output.items.map(({ productId }) => productId), rowCount: output.items.length }),
});

privateOperation({
  path: "/list_my_orders",
  tool: "list_my_orders",
  operation: "orders.listMine",
  roles: ["user"],
  scope: "orders:read",
  rolloutFlag: "MCP_TOOL_LIST_MY_ORDERS_ENABLED",
  inputSchema: z.object({ status: orderStatus, from: isoDateTime, to: isoDateTime, cursor, limit: z.number().int().min(1).max(50).optional() }).strict(),
  run: (input, ctx) => listMyOrders(input, ctx),
  observe: (output) => ({ resourceIds: output.orders.map(({ id }) => id), rowCount: output.orders.length }),
});

privateOperation({
  path: "/get_my_order",
  tool: "get_my_order",
  operation: "orders.getMine",
  roles: ["user"],
  scope: "orders:read",
  rolloutFlag: "MCP_TOOL_GET_MY_ORDER_ENABLED",
  inputSchema: z.object({ orderId }).strict(),
  run: (input, ctx) => getMyOrder(input, ctx),
  observe: (output) => ({ resourceIds: [output.order.id, ...output.groupOrders.map(({ id }) => id)], rowCount: 1 + output.groupOrders.length }),
});

privateOperation({
  path: "/track_my_order",
  tool: "track_my_order",
  operation: "orders.trackMine",
  roles: ["user"],
  scope: "orders:read",
  rolloutFlag: "MCP_TOOL_TRACK_MY_ORDER_ENABLED",
  inputSchema: z.object({ orderId }).strict(),
  run: (input, ctx) => trackMyOrder(input, ctx),
  observe: (output) => ({ resourceIds: [output.orderId], rowCount: output.timeline.length }),
});

privateOperation({
  path: "/get_my_bill_summary",
  tool: "get_my_bill_summary",
  operation: "orders.getMyBillSummary",
  roles: ["user"],
  scope: "orders:read",
  rolloutFlag: "MCP_TOOL_GET_MY_BILL_SUMMARY_ENABLED",
  inputSchema: z.object({ orderId }).strict(),
  run: (input, ctx) => getMyBillSummary(input, ctx),
  observe: (output) => ({ resourceIds: [output.billNumber, output.orderId], rowCount: 1 }),
});

privateOperation({
  path: "/get_my_payment_status",
  tool: "get_my_payment_status",
  operation: "orders.getMyPaymentStatus",
  roles: ["user"],
  scope: "orders:read",
  rolloutFlag: "MCP_TOOL_GET_MY_PAYMENT_STATUS_ENABLED",
  inputSchema: z.object({ orderId }).strict(),
  run: (input, ctx) => getMyPaymentStatus(input, ctx),
  observe: (output) => ({ resourceIds: [output.orderId], rowCount: output.payments.length + output.refunds.length }),
});

privateOperation({
  path: "/list_my_products",
  tool: "list_my_products",
  operation: "products.listMine",
  roles: ["seller"],
  scope: "catalog:read",
  rolloutFlag: "MCP_TOOL_LIST_MY_PRODUCTS_ENABLED",
  inputSchema: z.object({ cursor, limit: z.number().int().min(1).max(50).optional() }).strict(),
  run: (input, ctx) => listMyProducts(input, ctx),
  observe: (output) => ({ resourceIds: output.products.map(({ id }) => id), rowCount: output.products.length }),
});

privateOperation({
  path: "/get_my_product",
  tool: "get_my_product",
  operation: "products.getMine",
  roles: ["seller"],
  scope: "catalog:read",
  rolloutFlag: "MCP_TOOL_GET_MY_PRODUCT_ENABLED",
  inputSchema: z.object({ productId }).strict(),
  run: (input, ctx) => getMyProduct(input, ctx),
  observe: (output) => ({ resourceIds: [output.id], rowCount: 1 }),
});

privateOperation({
  path: "/get_my_inventory_summary",
  tool: "get_my_inventory_summary",
  operation: "products.getMyInventorySummary",
  roles: ["seller"],
  scope: "catalog:read",
  rolloutFlag: "MCP_TOOL_GET_MY_INVENTORY_SUMMARY_ENABLED",
  inputSchema: z.object({ threshold: z.number().int().min(1).max(50).optional() }).strict(),
  run: (input, ctx) => getMyInventorySummary(input, ctx),
  observe: (output) => ({ resourceIds: output.lowStock.map(({ productId }) => productId), rowCount: output.lowStockCount }),
});

// Seller sale lines and revenue (#15). Sale-line authorization is the immutable
// seller-at-purchase attribution resolved server-side from the delegated token;
// no sellerId input field exists. Revenue buckets are fixed month/year ledger
// aggregates with explicit refund semantics.
privateOperation({
  path: "/list_my_seller_orders",
  tool: "list_my_seller_orders",
  operation: "sales.listMine",
  roles: ["seller"],
  scope: "sales:read",
  rolloutFlag: "MCP_TOOL_LIST_MY_SELLER_ORDERS_ENABLED",
  inputSchema: z.object({ status: sellerSaleStatus, from: isoDateTime, to: isoDateTime, cursor, limit: z.number().int().min(1).max(50).optional() }).strict(),
  run: (input, ctx) => listMySales(input, ctx),
  observe: (output) => ({ resourceIds: output.sales.map(({ id }) => id), rowCount: output.sales.length }),
});

privateOperation({
  path: "/get_my_seller_order",
  tool: "get_my_seller_order",
  operation: "sales.getMine",
  roles: ["seller"],
  scope: "sales:read",
  rolloutFlag: "MCP_TOOL_GET_MY_SELLER_ORDER_ENABLED",
  inputSchema: z.object({ orderId }).strict(),
  run: (input, ctx) => getMySale(input, ctx),
  observe: (output) => ({ resourceIds: [output.sale.id, ...output.groupSales.map(({ id }) => id)], rowCount: 1 + output.groupSales.length }),
});

privateOperation({
  path: "/get_my_revenue_summary",
  tool: "get_my_revenue_summary",
  operation: "sales.revenueSummary",
  roles: ["seller"],
  scope: "revenue:read",
  rolloutFlag: "MCP_TOOL_GET_MY_REVENUE_SUMMARY_ENABLED",
  inputSchema: z.object({ year: z.number().int().min(2000).max(2100).optional() }).strict(),
  run: (input, ctx) => getMyRevenueSummary(input, ctx),
  observe: (output) => ({ resourceIds: [], rowCount: output.buckets.length }),
});

// Admin support queues (#17). Membership is the fixed server rule encoded in
// the service — exact stored exception/return status strings plus failed
// refunds inside a rolling 90-day window — with no caller-supplied filters.
// The detail view requires an explicit bounded purpose, which observe() threads
// into the durable audit metadata; foreign, missing, non-queued, and
// quarantined rows all resolve to the identical generic 404.
privateOperation({
  path: "/list_order_exception_queue",
  tool: "list_order_exception_queue",
  operation: "support.orderExceptionQueue",
  roles: ["admin"],
  scope: "support:read",
  rolloutFlag: "MCP_TOOL_LIST_ORDER_EXCEPTION_QUEUE_ENABLED",
  inputSchema: z.object({ cursor, limit: z.number().int().min(1).max(50).optional() }).strict(),
  run: (input, ctx) => listOrderExceptionQueue(input, ctx),
  observe: (output) => ({ resourceIds: output.orders.map(({ orderId }) => orderId), rowCount: output.orders.length }),
});

privateOperation({
  path: "/get_order_exception_detail",
  tool: "get_order_exception_detail",
  operation: "support.orderExceptionDetail",
  roles: ["admin"],
  scope: "support:read",
  rolloutFlag: "MCP_TOOL_GET_ORDER_EXCEPTION_DETAIL_ENABLED",
  inputSchema: z.object({ orderId, purpose: z.string().min(10).max(500) }).strict(),
  run: (input, ctx) => getOrderExceptionDetail(input, ctx),
  observe: (output, input) => orderExceptionDetailObserve(output, input),
});

privateOperation({
  path: "/list_return_queue",
  tool: "list_return_queue",
  operation: "support.returnQueue",
  roles: ["admin"],
  scope: "support:read",
  rolloutFlag: "MCP_TOOL_LIST_RETURN_QUEUE_ENABLED",
  inputSchema: z.object({ cursor, limit: z.number().int().min(1).max(50).optional() }).strict(),
  run: (input, ctx) => listReturnQueue(input, ctx),
  observe: (output) => ({ resourceIds: output.returns.map(({ orderId }) => orderId), rowCount: output.returns.length }),
});

router.use(authenticatePublicWorkload);

router.post("/:operation", async (req, res, next) => {
  const schema = schemas[req.params.operation];
  const operation = operations[req.params.operation];
  if (!schema || !operation) return res.status(404).json({ error: "Unknown operation" });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid operation input" });
  try {
    return res.json(await operation(parsed.data));
  } catch (error) {
    return next(error);
  }
});

export default router;
