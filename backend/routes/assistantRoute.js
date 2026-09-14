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

const router = express.Router();
const decimal = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/);
const productId = z.string().min(1).max(100);
const cursor = z.string().min(1).max(2048).optional();

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

router.use((req, res, next) => {
  const expected = process.env.ASSISTANT_API_TOKEN;
  const authorization = req.get("authorization") || "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!expected || !safeEqual(supplied, expected)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});

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
