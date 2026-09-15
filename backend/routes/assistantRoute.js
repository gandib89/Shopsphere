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

const auditedJson = async (req, res, { operation, tool, input = {}, output, startedAt }) => {
  try {
    await recordAssistantAudit(auditContext(req, {
      policyVersion: ASSISTANT_POLICY_VERSION,
      operation,
      tool,
      input,
      response: output,
      rowCount: Array.isArray(output?.notifications) ? output.notifications.length : null,
      resourceIds: output?.notifications?.map(({ id }) => id) || [],
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
    return res.status(status).json({ code, message: status === 404 ? "Resource not found" : "Assistant operation is unavailable" });
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
        signal: req.signal,
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
