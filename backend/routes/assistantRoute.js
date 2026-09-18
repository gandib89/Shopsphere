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
  getPlatformRevenueSummary,
  listSellerApplications,
} from "../services/assistantAdminReads.js";
import {
  draftListingCopy,
  getMyListingDraft,
  listMyListingDrafts,
  saveListingDraft,
} from "../services/assistantListingDrafts.js";
import { enforceListingDraftLimit } from "../services/assistantListingDraftLimits.js";
import { getMyActionStatus, proposeCartChange } from "../services/assistantProposals.js";
import { enforceProposalCreationLimits } from "../services/assistantProposalLimits.js";
import { proposeOrderReturn } from "../services/assistantReturnProposals.js";
import {
  getOrderExceptionDetail,
  listOrderExceptionQueue,
  listReturnQueue,
  orderExceptionDetailObserve,
} from "../services/assistantAdminQueues.js";
import { draftSupportMessage } from "../services/assistantSupportDrafts.js";
import { createDraftSupportLimit } from "../services/assistantSupportDraftLimits.js";
import {
  getPromotionUsageSummary,
  listPromotionConfiguration,
} from "../services/assistantAdminPromotions.js";
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
      // 400 and 409 are post-authorization denials (bad input, business-state
      // conflict), not authorization failures.
      authorizationOutcome: status === 400 || status === 409 ? "allowed" : "denied",
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
          : status === 409
            ? "Request conflicts with the current state"
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

// Shared private-operation seam for buyer/seller reads (#12/#13/#14), seller
// listing drafts (#20), admin support queues (#17), and buyer support drafts
// (#19). Every operation crosses the same chain: workload authentication,
// delegated credential verification (no browser-JWT fallback), distributed
// limits, and per-call role/scope/rollout authorization. Inputs are strict
// schemas (unknown fields rejected, no caller totals/identity/owner fields);
// reads run inside a transaction-local actor context; success and failure
// both audit. `middlewares` (optional): route-scoped controls such as draft
// and proposal rate limiters, appended after authorization without touching
// the shared chain order. `auditInput` (optional): projection of the parsed
// input stored in audit rows — used by routes whose input carries
// user-authored content that must never be echoed into audits or logs.
// observe(output, input) may return auditMetadata merged into the audited
// redacted input.
const privateOperation = ({ path, tool, operation, roles, scope, rolloutFlag, inputSchema, run, observe, middlewares = [], auditInput }) => {
  const auditEventInput = (data) => (auditInput ? auditInput(data) : data);
  router.post(
    path,
    authenticateAssistantWorkload,
    authenticateAssistantDelegation,
    enforceAssistantDistributedLimit(),
    authorizeAssistantOperation({ operation, roles, scope, rolloutFlag }),
    ...middlewares,
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
        // purpose) rides through the established audited-input path, and
        // routes with user-authored inputs project them out via auditInput
        // before anything durable is written.
        return auditedJson(req, res, {
          operation,
          tool,
          input: auditEventInput(auditMetadata ? { ...parsed.data, ...auditMetadata } : parsed.data),
          output,
          startedAt,
          resourceIds,
          rowCount,
        });
      } catch (error) {
        const status = error?.statusCode === 404 ? 404 : error?.statusCode === 400 ? 400 : error?.statusCode === 409 ? 409 : error?.statusCode === 503 ? 503 : 500;
        return auditedError(req, res, {
          operation,
          tool,
          input: auditEventInput(parsed.data),
          status,
          code: status === 404 ? "not_found" : status === 400 ? "invalid_input" : status === 409 ? (error?.code ?? "conflict") : "operation_unavailable",
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

// consented scope (platform:read / sellers:read) and the live account must be
// an admin — a promoted user with an older narrower grant gains no authority
// without renewed consent, because the scope check reads the token's grant,
// not the current role. Outputs are fixed bounded aggregates and minimized
// application metadata: no raw ledger, payment-event, bank, or customer rows;
// no identity evidence or private contacts.
privateOperation({
  path: "/get_platform_revenue_summary",
  tool: "get_platform_revenue_summary",
  operation: "platform.revenueSummary",
  roles: ["admin"],
  scope: "platform:read",
  rolloutFlag: "MCP_TOOL_GET_PLATFORM_REVENUE_SUMMARY_ENABLED",
  inputSchema: z.object({ year: z.number().int().min(2000).max(2100).optional() }).strict(),
  run: (input, ctx) => getPlatformRevenueSummary(input, ctx),
  observe: (output) => ({ resourceIds: [], rowCount: output.buckets.length }),
});

privateOperation({
  path: "/list_seller_applications",
  tool: "list_seller_applications",
  operation: "sellers.listApplications",
  roles: ["admin"],
  scope: "sellers:read",
  rolloutFlag: "MCP_TOOL_LIST_SELLER_APPLICATIONS_ENABLED",
  inputSchema: z.object({
    status: z.enum(["pending", "approved", "rejected"]).optional(),
    cursor,
    limit: z.number().int().min(1).max(50).optional(),
  }).strict(),
  run: (input, ctx) => listSellerApplications(input, ctx),
  observe: (output) => ({
    resourceIds: output.applications.map(({ sellerReference }) => sellerReference),
    rowCount: output.applications.length,
  }),
});

// Seller listing drafts (#20). Copy is composed only from supplied facts or
// one owned product, and saving touches only owned listing_drafts rows —
// never a live Product, notification, or storefront route. Isolation carries
// BOTH sellerId and grantId in every service predicate (RLS is defense in
// depth), unverified sellers may draft, and the draft limiter bounds this
// heavier operation class to 10/minute and 100/day per subject+client.
const draftCopyInput = z.object({
  sourceProductId: z.string().min(1).max(100).optional(),
  facts: z.object({
    productName: z.string().min(1).max(140).optional(),
    keyFeatures: z.array(z.string().min(1).max(200)).max(10).optional(),
    audienceNote: z.string().min(1).max(300).optional(),
  }).strict().optional(),
}).strict().refine(
  ({ sourceProductId, facts }) => sourceProductId !== undefined || facts !== undefined,
  "sourceProductId or facts is required",
);
const draftHighlights = z.array(z.string().min(1).max(200)).max(10).optional();
const draftId = z.string().min(1).max(100);

privateOperation({
  path: "/draft_listing_copy",
  tool: "draft_listing_copy",
  operation: "listings.draftCopy",
  roles: ["seller"],
  scope: "listings:draft",
  rolloutFlag: "MCP_TOOL_DRAFT_LISTING_COPY_ENABLED",
  inputSchema: draftCopyInput,
  middlewares: [enforceListingDraftLimit()],
  run: (input, ctx) => draftListingCopy(input, ctx),
  observe: () => ({ resourceIds: [], rowCount: 1 }),
});

privateOperation({
  path: "/save_listing_draft",
  tool: "save_listing_draft",
  operation: "listings.saveDraft",
  roles: ["seller"],
  scope: "listings:draft",
  rolloutFlag: "MCP_TOOL_SAVE_LISTING_DRAFT_ENABLED",
  inputSchema: z.object({
    draftId: z.string().min(1).max(100).optional(),
    title: z.string().min(1).max(140),
    description: z.string().min(1).max(4000),
    highlights: draftHighlights,
    sourceProductId: z.string().min(1).max(100).optional(),
  }).strict(),
  middlewares: [enforceListingDraftLimit()],
  run: (input, ctx) => saveListingDraft(input, ctx),
  observe: (output) => ({ resourceIds: [output.draftId], rowCount: output.version > 1 ? 2 : 1 }),
});

privateOperation({
  path: "/list_my_listing_drafts",
  tool: "list_my_listing_drafts",
  operation: "listings.listDrafts",
  roles: ["seller"],
  scope: "listings:draft",
  rolloutFlag: "MCP_TOOL_LIST_MY_LISTING_DRAFTS_ENABLED",
  inputSchema: z.object({
    cursor,
    limit: z.number().int().min(1).max(50).optional(),
    includeSuperseded: z.boolean().optional(),
  }).strict(),
  middlewares: [enforceListingDraftLimit()],
  run: (input, ctx) => listMyListingDrafts(input, ctx),
  observe: (output) => ({ resourceIds: output.drafts.map(({ draftId }) => draftId), rowCount: output.drafts.length }),
});

privateOperation({
  path: "/get_my_listing_draft",
  tool: "get_my_listing_draft",
  operation: "listings.getDraft",
  roles: ["seller"],
  scope: "listings:draft",
  rolloutFlag: "MCP_TOOL_GET_MY_LISTING_DRAFT_ENABLED",
  inputSchema: z.object({ draftId: draftId }).strict(),
  middlewares: [enforceListingDraftLimit()],
  run: (input, ctx) => getMyListingDraft(input, ctx),
  observe: (output) => ({ resourceIds: [output.draftId], rowCount: 1 }),
});

// Proposal platform (#22). propose_cart_change persists a canonical pending
// proposal (never a cart mutation) and therefore runs the proposal-class rate
// limits in addition to the shared delegation chain. The strict input accepts
// exactly one action with no confirmation flag, no execute flag, and no
// caller-supplied totals: forged confirmation fields fail the schema, not the cart.
const proposalOptions = z
  .record(z.string().min(1).max(50), z.string().min(1).max(50))
  .refine((value) => Object.keys(value).length <= 5, { message: "options accepts at most 5 entries" })
  .optional();
const proposeCartChangeInput = z.object({
  action: z.enum(["add_item", "update_quantity", "remove_item"]),
  productId: z.string().min(1).max(100).optional(),
  options: proposalOptions,
  quantity: z.number().int().min(1).max(20).optional(),
  cartItemId: z.string().min(1).max(100).optional(),
}).strict().superRefine((value, ctx) => {
  const issue = (path, message) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
  if (value.action === "add_item") {
    if (value.productId === undefined) issue(["productId"], "add_item requires productId");
    if (value.quantity === undefined) issue(["quantity"], "add_item requires quantity");
    if (value.cartItemId !== undefined) issue(["cartItemId"], "add_item must not target an existing cart item");
  } else if (value.action === "update_quantity") {
    if (value.cartItemId === undefined) issue(["cartItemId"], "update_quantity requires cartItemId");
    if (value.quantity === undefined) issue(["quantity"], "update_quantity requires quantity");
    if (value.productId !== undefined) issue(["productId"], "update_quantity must not restate the product");
  } else {
    if (value.cartItemId === undefined) issue(["cartItemId"], "remove_item requires cartItemId");
    if (value.quantity !== undefined) issue(["quantity"], "remove_item must not carry a quantity");
    if (value.productId !== undefined) issue(["productId"], "remove_item must not carry a product");
  }
  if (value.action !== "add_item" && value.options !== undefined) {
    issue(["options"], "options only apply to add_item");
  }
});

router.post(
  "/propose_cart_change",
  authenticateAssistantWorkload,
  authenticateAssistantDelegation,
  enforceAssistantDistributedLimit(),
  authorizeAssistantOperation({
    operation: "proposals.proposeCartChange",
    roles: ["user"],
    scope: "cart:propose",
    rolloutFlag: "MCP_TOOL_PROPOSE_CART_CHANGE_ENABLED",
  }),
  enforceProposalCreationLimits(),
  async (req, res) => {
    const startedAt = Date.now();
    const operation = "proposals.proposeCartChange";
    const tool = "propose_cart_change";
    const parsed = proposeCartChangeInput.safeParse(req.body);
    if (!parsed.success) {
      return auditedError(req, res, { operation, tool, input: {}, status: 400, code: "invalid_input", startedAt });
    }
    try {
      const output = await withAssistantActor({
        actorId: req.delegation.sub,
        role: req.delegation.role,
        operation,
        signal: req.assistantSignal,
      }, (tx) => proposeCartChange(parsed.data, {
        client: tx,
        principal: {
          subject: req.delegation.sub,
          role: req.delegation.role,
          clientId: req.delegation.clientId,
          grantId: req.delegation.grantId,
        },
        now: new Date(),
      }));
      return auditedJson(req, res, {
        operation,
        tool,
        input: parsed.data,
        output,
        startedAt,
        resourceIds: [output.proposalId],
        rowCount: 1,
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

privateOperation({
  path: "/get_my_action_status",
  tool: "get_my_action_status",
  operation: "proposals.actionStatus",
  roles: ["user"],
  scope: "proposals:read",
  rolloutFlag: "MCP_TOOL_GET_MY_ACTION_STATUS_ENABLED",
  inputSchema: z.object({ proposalId: z.string().min(1).max(100) }).strict(),
  run: (input, ctx) => getMyActionStatus(input, ctx),
  observe: (output) => ({ resourceIds: [output.proposalId], rowCount: 1 }),
});

// Buyer return proposals (#25), on the #22 proposal platform. The strict input
// carries exactly { orderId, reason } — there is no evidence URL, attachment
// path, or image field, and no confirm/execute affordance: forged evidence or
// confirmation fields fail the schema, not the order. proposeOrderReturn
// persists ONLY a proposal row (never a live return request, notification, or
// refund) and therefore runs the proposal-class rate limits in addition to the
// shared delegation chain. The free-text `reason` is user-authored content and
// is projected OUT of every audited input (success, failure, and rate-limit
// denials alike) — it is never echoed into audits or logs.
export const returnProposalAuditInput = ({ orderId }) => ({ orderId });

privateOperation({
  path: "/propose_order_return",
  tool: "propose_order_return",
  operation: "proposals.orderReturn",
  roles: ["user"],
  scope: "returns:propose",
  rolloutFlag: "MCP_TOOL_PROPOSE_ORDER_RETURN_ENABLED",
  inputSchema: z.object({
    orderId: z.string().regex(/^[A-Za-z0-9]{1,24}$/),
    reason: z.string().trim().min(10).max(1000),
  }).strict(),
  middlewares: [enforceProposalCreationLimits()],
  auditInput: returnProposalAuditInput,
  run: (input, ctx) => proposeOrderReturn(input, ctx),
  observe: (output) => ({ resourceIds: [output.proposalId, output.preview.orderId], rowCount: 1 }),
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

// Buyer support-message drafting (#19). DETERMINISTIC template composition
// from the buyer's own minimized order facts plus approved, versioned policy
// answers — no LLM. ZERO DELIVERY SIDE EFFECTS: nothing on this path sends
// email or chat, creates a ticket or notification, or calls a webhook — the
// tool only returns draft text for the buyer to review. The buyer picks the
// owned order and the bounded topic; no recipient, channel, or send affordance
// exists in the contract. The draft rate class carries stricter route-scoped
// limits (10/minute, 100/day per subject+client, fail-closed) on top of the
// shared distributed limit, and the user-authored `notes` field is excluded
// from audit rows and logs.
const draftSupportInput = z.object({
  orderId: z.string().regex(/^[A-Za-z0-9]{1,24}$/),
  topic: z.enum(["order_status", "delivery_issue", "return_question", "refund_question", "other"]),
  notes: z.string().min(1).max(500).optional(),
}).strict();

privateOperation({
  path: "/draft_support_message",
  tool: "draft_support_message",
  operation: "support.draftMessage",
  roles: ["user"],
  scope: "support:draft",
  rolloutFlag: "MCP_TOOL_DRAFT_SUPPORT_MESSAGE_ENABLED",
  inputSchema: draftSupportInput,
  middlewares: [createDraftSupportLimit()],
  auditInput: ({ orderId, topic }) => ({ orderId, topic }),
  run: (input, ctx) => draftSupportMessage(input, ctx),
  observe: (output) => ({ resourceIds: [output.orderId], rowCount: 1 }),
});

// Admin promotion reads (#18). Read-only by construction: the operations run
// only SELECT projections and aggregate counts inside the actor transaction —
// no promo mutation route, notification broadcast, counter reset, or activation
// toggle is reachable from these paths. Configuration is an allowlist (the code
// string is configuration, not a secret); per-user redemption history has no
// field in any output. Missing and out-of-scope codes return the same 404.
privateOperation({
  path: "/list_promotion_configuration",
  tool: "list_promotion_configuration",
  operation: "promotions.listConfiguration",
  roles: ["admin"],
  scope: "promotions:read",
  rolloutFlag: "MCP_TOOL_LIST_PROMOTION_CONFIGURATION_ENABLED",
  inputSchema: z.object({
    cursor,
    limit: z.number().int().min(1).max(50).optional(),
    activeOnly: z.boolean().optional(),
  }).strict(),
  run: (input, ctx) => listPromotionConfiguration(input, ctx),
  observe: (output) => ({ resourceIds: output.promotions.map(({ promoCodeId }) => promoCodeId), rowCount: output.promotions.length }),
});

privateOperation({
  path: "/get_promotion_usage_summary",
  tool: "get_promotion_usage_summary",
  operation: "promotions.usageSummary",
  roles: ["admin"],
  scope: "promotions:read",
  rolloutFlag: "MCP_TOOL_GET_PROMOTION_USAGE_SUMMARY_ENABLED",
  inputSchema: z.object({ promoCodeId: z.string().min(1).max(100) }).strict(),
  run: (input, ctx) => getPromotionUsageSummary(input, ctx),
  observe: (output) => ({ resourceIds: [output.promoCodeId], rowCount: 1 }),
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
