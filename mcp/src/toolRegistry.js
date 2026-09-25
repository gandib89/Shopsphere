import { z } from "zod";

export const PROTOCOL_VERSION = "2025-11-25";
export const SUPPORTED_PROTOCOL_VERSIONS = Object.freeze([
  PROTOCOL_VERSION,
  "2025-06-18",
]);
export const REGISTRY_VERSION = "1.4.0";
export const POLICY_VERSION = "1.0.0";
export const POLICY_TOPICS = Object.freeze([
  "returns",
  "delivery",
  "payment",
  "warranty",
  "authenticity",
  "tracking",
  "cancellation",
  "seller-onboarding",
  "support-contact",
]);
export const DEFAULT_MAX_REQUEST_BYTES = 32 * 1024;
export const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;

const BackendOperationSchema = z
  .object({
    kind: z.enum(["local", "http"]),
    operationId: z.string().min(1).max(100),
    method: z.enum(["GET", "POST"]).nullable(),
    path: z.string().max(200).nullable(),
  })
  .strict();

const RolloutSchema = z
  .object({
    flag: z.string().min(1).max(100),
    enabled: z.boolean(),
  })
  .strict();

const CapabilitySchema = z
  .object({
    name: z.string().min(1).max(64),
    description: z.string().min(1).max(500),
    operationClass: z.enum(["read", "draft", "propose"]),
    roles: z.array(z.enum(["public", "user", "seller", "admin"])).max(4),
    scopes: z.array(z.string().min(1).max(100)).max(20),
    rateClass: z.enum(["discovery", "public-read", "authenticated-read", "draft", "proposal"]),
    rollout: RolloutSchema,
    backendOperation: BackendOperationSchema,
  })
  .strict();

export const CapabilitiesOutputSchema = z
  .object({
    registryVersion: z.literal(REGISTRY_VERSION),
    protocolVersion: z.literal(PROTOCOL_VERSION),
    tools: z.array(CapabilitySchema).max(100),
    limits: z
      .object({
        maxRequestBytes: z.number().int().positive(),
        maxResponseBytes: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();

export const GetStorePolicyInputSchema = z
  .object({
    topic: z.enum(POLICY_TOPICS),
  })
  .strict();

export const GetStorePolicyOutputSchema = z
  .object({
    topic: z.string().min(1).max(64),
    answer: z.string().min(1).max(4000),
    sources: z
      .array(
        z
          .object({
            sourceId: z.string().min(1).max(100),
            sourceVersion: z.literal(POLICY_VERSION),
          })
          .strict(),
      )
      .max(10),
  })
  .strict();

const MoneySchema = z
  .object({
    amount: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/),
    currency: z.literal("NPR"),
  })
  .strict();

const SignedMoneySchema = z
  .object({
    amount: z.string().regex(/^-?\d{1,10}(\.\d{1,2})?$/),
    currency: z.literal("NPR"),
  })
  .strict();

const DecimalInputSchema = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/);

// Minimized public storefront projection: availability label only — no
// sellerId, no exact stock counts, no seller-private metadata.
const PublicProductSchema = z
  .object({
    id: z.string().min(1).max(100),
    name: z.string().min(1).max(200),
    price: MoneySchema,
    images: z.array(z.string().max(500)).max(20),
    category: z.string().min(1).max(100),
    availability: z.enum(["In stock", "Sold out"]),
  })
  .strict();

const SearchProductsInputSchema = z
  .object({
    q: z.string().min(1).max(200).optional(),
    category: z.string().min(1).max(100).optional(),
    minPrice: DecimalInputSchema.optional(),
    maxPrice: DecimalInputSchema.optional(),
    sort: z.enum(["price-asc", "price-desc", "name-asc", "name-desc"]).optional(),
    cursor: z.string().min(1).max(2048).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict()
  .refine(
    ({ minPrice, maxPrice }) =>
      minPrice === undefined || maxPrice === undefined || Number(minPrice) <= Number(maxPrice),
    { message: "minPrice must not exceed maxPrice" },
  );

const SearchProductsOutputSchema = z
  .object({
    items: z.array(PublicProductSchema).max(50),
    total: z.number().int().nonnegative(),
    nextCursor: z.string().min(1).max(2048).nullable(),
  })
  .strict();

const CompareProductsInputSchema = z
  .object({
    productIds: z.array(z.string().min(1).max(100)).min(1).max(5).optional(),
    product_ids: z.array(z.string().min(1).max(100)).min(1).max(5).optional(),
  })
  .strict()
  .refine(({ productIds, product_ids }) => Boolean(productIds) !== Boolean(product_ids), {
    message: "Provide exactly one of productIds or product_ids",
  })
  .transform(({ productIds, product_ids }) => ({ productIds: productIds ?? product_ids }));

const CompareProductsOutputSchema = z
  .object({
    products: z.array(PublicProductSchema).max(5),
  })
  .strict();

const VariantOptionSchema = z
  .object({
    kind: z.enum(["color", "storage", "ram", "screenSize", "processor"]),
    value: z.string().min(1).max(100),
    priceDelta: SignedMoneySchema,
  })
  .strict();

const PublicVariantsSchema = z
  .object({
    colors: z.array(z.string().min(1).max(100)).max(20),
    storages: z.array(z.string().min(1).max(100)).max(20),
    options: z.array(VariantOptionSchema).max(20),
  })
  .strict();

// Detail projection: the public search projection plus display-safe
// description and variants. No sellerId, stock counts, or private metadata.
const ProductDetailSchema = PublicProductSchema.extend({
  description: z.string().min(1).max(2000),
  variants: PublicVariantsSchema,
}).strict();

const GetProductInputSchema = z
  .object({
    productId: z.string().min(1).max(100).optional(),
    product_id: z.string().min(1).max(100).optional(),
  })
  .strict()
  .refine(({ productId, product_id }) => Boolean(productId) !== Boolean(product_id), {
    message: "Provide exactly one of productId or product_id",
  })
  .transform(({ productId, product_id }) => ({ productId: productId ?? product_id }));

const PublicReviewSchema = z
  .object({
    displayName: z.string().min(1).max(100),
    rating: z.number().int().min(1).max(5),
    comment: z.string().min(1).max(1000),
    createdAt: z.iso.datetime().max(100),
  })
  .strict();

const GetProductReviewsInputSchema = z
  .object({
    productId: z.string().min(1).max(100).optional(),
    product_id: z.string().min(1).max(100).optional(),
    cursor: z.string().min(1).max(2048).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict()
  .refine(({ productId, product_id }) => Boolean(productId) !== Boolean(product_id), {
    message: "Provide exactly one of productId or product_id",
  })
  .transform(({ productId, product_id, ...rest }) => ({
    productId: productId ?? product_id,
    ...rest,
  }));

const GetProductReviewsOutputSchema = z
  .object({
    productId: z.string().min(1).max(100),
    reviews: z.array(PublicReviewSchema).max(50),
    total: z.number().int().nonnegative(),
    nextCursor: z.string().min(1).max(2048).nullable(),
    contentNotice: z.string().min(1).max(500),
  })
  .strict();

const GetRecommendationsInputSchema = z
  .object({
    productId: z.string().min(1).max(100).optional(),
    product_id: z.string().min(1).max(100).optional(),
    limit: z.number().int().min(1).max(20).optional(),
  })
  .strict()
  .refine(({ productId, product_id }) => Boolean(productId) !== Boolean(product_id), {
    message: "Provide exactly one of productId or product_id",
  })
  .transform(({ productId, product_id, ...rest }) => ({
    productId: productId ?? product_id,
    ...rest,
  }));

const GetRecommendationsOutputSchema = z
  .object({
    productId: z.string().min(1).max(100),
    recommendations: z.array(PublicProductSchema).max(20),
  })
  .strict();

const GetMyProfileSummaryOutputSchema = z
  .object({
    displayName: z.string().min(1).max(201),
    role: z.enum(["user", "seller", "admin"]),
    verified: z.boolean(),
  })
  .strict();

const ListMyNotificationsInputSchema = z.object({
  cursor: z.string().min(1).max(2048).optional(),
  limit: z.number().int().min(1).max(50).optional(),
}).strict();

const NotificationSchema = z.object({
  id: z.string().min(1).max(100),
  type: z.string().min(1).max(100),
  title: z.string().min(1).max(200),
  message: z.string().max(1000),
  read: z.boolean(),
  productId: z.string().min(1).max(100).nullable(),
  productName: z.string().min(1).max(200).nullable(),
  createdAt: z.iso.datetime(),
}).strict();

const ListMyNotificationsOutputSchema = z.object({
  notifications: z.array(NotificationSchema).max(50),
  nextCursor: z.string().min(1).max(2048).nullable(),
}).strict();

// Buyer cart reads (#12): own items and server-computed totals only. No
// caller-supplied totals, identity, or owner fields exist in these inputs.
const CartItemSchema = z
  .object({
    productId: z.string().min(1).max(100),
    name: z.string().min(1).max(200),
    quantity: z.number().int().min(1),
    unitPrice: MoneySchema,
    lineTotal: MoneySchema,
    variants: z.record(z.string(), z.string()),
    images: z.array(z.string().max(500)).max(5),
    availability: z.enum(["In stock", "Sold out", "Unavailable"]),
  })
  .strict();

const CartTotalsSchema = z
  .object({
    items: z.array(CartItemSchema).max(50),
    subtotal: MoneySchema,
    discountTotal: MoneySchema,
    total: MoneySchema,
  })
  .strict();

const ValidatePromoCodeInputSchema = z
  .object({
    code: z.string().min(1).max(50),
  })
  .strict();

const ValidatePromoCodeOutputSchema = z
  .object({
    code: z.string().min(1).max(50).nullable(),
    valid: z.boolean(),
    reason: z.string().min(1).max(50).nullable(),
    discountType: z.enum(["percentage", "fixed"]).nullable(),
    discountValue: z.string().min(1).max(50).nullable(),
    discountAmount: MoneySchema,
    finalAmount: MoneySchema.nullable(),
  })
  .strict();

const ValidPromoSchema = z
  .object({
    code: z.string().min(1).max(50),
    discountType: z.enum(["percentage", "fixed"]),
    discountValue: z.string().min(1).max(50),
    discountAmount: MoneySchema,
  })
  .strict();

const InvalidPromoSchema = z
  .object({
    code: z.string().min(1).max(50).nullable(),
    valid: z.literal(false),
    reason: z.string().min(1).max(50),
  })
  .strict();

const PreviewCheckoutInputSchema = z
  .object({
    promoCode: z.string().min(1).max(50).optional(),
  })
  .strict();

const PreviewCheckoutOutputSchema = CartTotalsSchema.extend({
  promo: z.union([ValidPromoSchema, InvalidPromoSchema]).nullable(),
  promoDiscount: MoneySchema,
}).strict();

// Buyer order reads (#13): immutable buyer identity, bounded filters, opaque
// cursors, minimized projections. No address, contact, gateway, or credential
// fields exist in these outputs.
const OrderStatusSchema = z.enum([
  "Pending",
  "Confirmed",
  "Processing",
  "Shipped",
  "Delivered",
  "Cancelled",
  "ReturnRequested",
  "Returned",
]);

const BuyerOrderSchema = z
  .object({
    id: z.string().min(1).max(100),
    status: z.string().min(1).max(50),
    quantity: z.number().int().min(1),
    totalPrice: MoneySchema,
    createdAt: z.iso.datetime().max(100),
    orderGroupId: z.string().min(1).max(100).nullable(),
    productName: z.string().min(1).max(200).nullable(),
  })
  .strict();

const ListMyOrdersInputSchema = z
  .object({
    status: OrderStatusSchema.optional(),
    from: z.string().min(1).max(100).optional(),
    to: z.string().min(1).max(100).optional(),
    cursor: z.string().min(1).max(2048).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

const ListMyOrdersOutputSchema = z
  .object({
    orders: z.array(BuyerOrderSchema).max(50),
    nextCursor: z.string().min(1).max(2048).nullable(),
  })
  .strict();

const OrderIdInputSchema = z
  .object({
    orderId: z.string().min(1).max(100),
  })
  .strict();

const BuyerOrderDetailSchema = BuyerOrderSchema.extend({
  variants: z
    .object({
      storage: z.string().max(100).nullable(),
      color: z.string().max(100).nullable(),
      ram: z.string().max(100).nullable(),
      screenSize: z.string().max(100).nullable(),
      processor: z.string().max(100).nullable(),
    })
    .strict(),
  confirmedAt: z.iso.datetime().max(100).nullable(),
  processingAt: z.iso.datetime().max(100).nullable(),
  shippedAt: z.iso.datetime().max(100).nullable(),
  deliveredAt: z.iso.datetime().max(100).nullable(),
  cancelledAt: z.iso.datetime().max(100).nullable(),
}).strict();

const GetMyOrderOutputSchema = z
  .object({
    order: BuyerOrderDetailSchema,
    groupOrders: z.array(BuyerOrderSchema).max(50),
  })
  .strict();

const TrackMyOrderOutputSchema = z
  .object({
    orderId: z.string().min(1).max(100),
    status: z.string().min(1).max(50),
    timeline: z
      .array(
        z
          .object({
            step: z.string().min(1).max(100),
            status: z.string().min(1).max(50),
            time: z.iso.datetime().max(100).nullable(),
            done: z.boolean(),
          })
          .strict(),
      )
      .max(10),
  })
  .strict();

const GetMyBillSummaryOutputSchema = z
  .object({
    billNumber: z.string().min(1).max(100),
    orderId: z.string().min(1).max(100),
    productName: z.string().min(1).max(200).nullable(),
    quantity: z.number().int().min(1).nullable(),
    unitPrice: MoneySchema,
    totalPrice: MoneySchema,
    status: z.string().min(1).max(50),
    orderDate: z.iso.datetime().max(100).nullable(),
  })
  .strict();

const StatusAmountSchema = z
  .object({
    status: z.string().min(1).max(50),
    amount: MoneySchema,
  })
  .strict();

const GetMyPaymentStatusOutputSchema = z
  .object({
    orderId: z.string().min(1).max(100),
    status: z.string().min(1).max(50),
    payments: z.array(StatusAmountSchema).max(20),
    refunds: z.array(StatusAmountSchema).max(20),
  })
  .strict();

// Seller catalog reads (#14): present-day Product.sellerId scoping, exact
// private stock, archived products included for their owner. No customer,
// order, revenue, or competitor fields exist in these outputs.
const SellerProductSchema = z
  .object({
    id: z.string().min(1).max(100),
    name: z.string().min(1).max(200),
    price: MoneySchema,
    quantity: z.number().int().nonnegative(),
    category: z.string().min(1).max(100),
    isArchived: z.boolean(),
  })
  .strict();

const ListMyProductsInputSchema = z.object({
  cursor: z.string().min(1).max(2048).optional(),
  limit: z.number().int().min(1).max(50).optional(),
}).strict();

const ListMyProductsOutputSchema = z.object({
  products: z.array(SellerProductSchema).max(50),
  nextCursor: z.string().min(1).max(2048).nullable(),
}).strict();

const SellerOptionSchema = z
  .object({
    kind: z.string().min(1).max(50),
    value: z.string().min(1).max(100),
    priceDelta: SignedMoneySchema,
    stock: z.number().int().nonnegative().nullable(),
  })
  .strict();

const GetMyProductOutputSchema = SellerProductSchema.extend({
  description: z.string().min(1).max(2000),
  images: z.array(z.string().max(500)).max(20),
  discount: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/),
  createdAt: z.iso.datetime().max(100).nullable(),
  options: z.array(SellerOptionSchema).max(50),
}).strict();

const GetMyInventorySummaryInputSchema = z.object({
  threshold: z.number().int().min(1).max(50).optional(),
}).strict();

const GetMyInventorySummaryOutputSchema = z.object({
  threshold: z.number().int().min(1).max(50),
  totalProducts: z.number().int().nonnegative(),
  totalUnits: z.number().int().nonnegative(),
  lowStockCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
  lowStock: z
    .array(
      z
        .object({
          productId: z.string().min(1).max(100),
          name: z.string().min(1).max(200),
          quantity: z.number().int().nonnegative(),
        })
        .strict(),
    )
    .max(50),
}).strict();

// Seller sale-line reads (#15): authorized through immutable Order.sellerIdAtPurchase
// only — never current product ownership and never a caller-supplied seller id.
// Customer identity leaves as a deterministic opaque reference derived from the
// buyer's id; names, emails, addresses, and commissions never appear.
const SellerSaleStatusSchema = z.enum([
  "Pending",
  "Confirmed",
  "Processing",
  "Shipped",
  "Delivered",
  "Cancelled",
  "ReturnRequested",
  "Returned",
  "Refund Released",
]);

const SellerSaleLineSchema = z
  .object({
    id: z.string().min(1).max(100),
    status: z.string().min(1).max(50),
    quantity: z.number().int().min(1),
    totalPrice: MoneySchema,
    createdAt: z.iso.datetime().max(100),
    orderGroupId: z.string().min(1).max(100).nullable(),
    productId: z.string().min(1).max(100),
    productName: z.string().min(1).max(200).nullable(),
    buyerReference: z.string().min(1).max(100).nullable(),
  })
  .strict();

const ListMySellerOrdersInputSchema = z
  .object({
    status: SellerSaleStatusSchema.optional(),
    from: z.string().min(1).max(100).optional(),
    to: z.string().min(1).max(100).optional(),
    cursor: z.string().min(1).max(2048).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

const ListMySellerOrdersOutputSchema = z
  .object({
    sales: z.array(SellerSaleLineSchema).max(50),
    nextCursor: z.string().min(1).max(2048).nullable(),
  })
  .strict();

const GetMySellerOrderInputSchema = z
  .object({
    orderId: z.string().min(1).max(100),
  })
  .strict();

const SellerSaleDetailSchema = SellerSaleLineSchema.extend({
  variants: z
    .object({
      storage: z.string().max(100).nullable(),
      color: z.string().max(100).nullable(),
      ram: z.string().max(100).nullable(),
      screenSize: z.string().max(100).nullable(),
      processor: z.string().max(100).nullable(),
    })
    .strict(),
  confirmedAt: z.iso.datetime().max(100).nullable(),
  processingAt: z.iso.datetime().max(100).nullable(),
  shippedAt: z.iso.datetime().max(100).nullable(),
  deliveredAt: z.iso.datetime().max(100).nullable(),
  cancelledAt: z.iso.datetime().max(100).nullable(),
  revenue: z
    .object({
      status: z.string().min(1).max(50),
      grossSale: MoneySchema,
      commission: MoneySchema,
      netSale: MoneySchema,
    })
    .strict()
    .nullable(),
}).strict();

const GetMySellerOrderOutputSchema = z
  .object({
    sale: SellerSaleDetailSchema,
    groupSales: z.array(SellerSaleLineSchema).max(50),
  })
  .strict();

// Revenue summary (#15): exactly twelve fixed monthly buckets for one year.
// grossSale/commission/netSale sum Completed ledger rows by sale month;
// refunded sums succeeded refund amounts by the month the refund completed and
// is never netted against the sale buckets.
const GetMyRevenueSummaryInputSchema = z
  .object({
    year: z.number().int().min(2000).max(2100).optional(),
  })
  .strict();

const RevenueBucketSchema = z
  .object({
    month: z.number().int().min(1).max(12),
    saleCount: z.number().int().nonnegative(),
    grossSale: MoneySchema,
    commission: MoneySchema,
    netSale: MoneySchema,
    refunded: MoneySchema,
  })
  .strict();

const GetMyRevenueSummaryOutputSchema = z
  .object({
    year: z.number().int().min(2000).max(2100),
    buckets: z.array(RevenueBucketSchema).length(12),
    totals: z
      .object({
        saleCount: z.number().int().nonnegative(),
        grossSale: MoneySchema,
        commission: MoneySchema,
        netSale: MoneySchema,
        refunded: MoneySchema,
      })
      .strict(),
  })
  .strict();

// Admin platform revenue summary (#16): the same twelve fixed monthly buckets
// aggregated across the whole platform from the append-only ledger. No raw
// ledger rows, per-order data, payment events, or bank/customer fields exist
// in the contract — only counts and exact-decimal money.
const GetPlatformRevenueSummaryInputSchema = z
  .object({
    year: z.number().int().min(2000).max(2100).optional(),
  })
  .strict();

const PlatformRevenueBucketSchema = z
  .object({
    month: z.number().int().min(1).max(12),
    completedSaleCount: z.number().int().nonnegative(),
    grossSale: MoneySchema,
    adminCommission: MoneySchema,
    sellerRevenue: MoneySchema,
    refunded: MoneySchema,
  })
  .strict();

const GetPlatformRevenueSummaryOutputSchema = z
  .object({
    year: z.number().int().min(2000).max(2100),
    buckets: z.array(PlatformRevenueBucketSchema).length(12),
    totals: z
      .object({
        completedSaleCount: z.number().int().nonnegative(),
        grossSale: MoneySchema,
        adminCommission: MoneySchema,
        sellerRevenue: MoneySchema,
        refunded: MoneySchema,
      })
      .strict(),
  })
  .strict();

// Admin seller-application list (#16): approved business/display metadata and
// the derived application status only. The seller leaves as a deterministic
// opaque reference derived from the account id; email, phone, personal names,
// home address, and identity evidence never appear.
const ListSellerApplicationsInputSchema = z
  .object({
    status: z.enum(["pending", "approved", "rejected"]).optional(),
    cursor: z.string().min(1).max(2048).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

const SellerApplicationSchema = z
  .object({
    sellerReference: z.string().regex(/^seller-[0-9a-f]{12}$/),
    shopName: z.string().max(200),
    shopDescription: z.string().max(2000),
    status: z.enum(["pending", "approved", "rejected"]),
    requestDate: z.iso.datetime().max(100).nullable(),
    decisionDate: z.iso.datetime().max(100).nullable(),
    rejectionReason: z.string().min(1).max(500).nullable(),
  })
  .strict();

const ListSellerApplicationsOutputSchema = z
  .object({
    applications: z.array(SellerApplicationSchema).max(50),
    nextCursor: z.string().min(1).max(2048).nullable(),
  })
  .strict();

// Seller listing drafts (#20): deterministic, template-based composition from
// supplied facts or one seller-owned product. The templates restate supplied
// facts only and point at the approved store policy — no condition, warranty,
// or policy claims are ever invented. Saving touches only owned draft rows and
// never creates, modifies, publishes, or broadcasts a live listing. grantId
// isolation (a draft is readable/writable only through the grant that made it)
// is enforced by the backend service; these schemas bound every string/array.
const DraftPolicySourceSchema = z
  .object({
    sourceId: z.string().min(1).max(100),
    sourceVersion: z.literal(POLICY_VERSION),
  })
  .strict();

const DraftListingCopyInputSchema = z
  .object({
    sourceProductId: z.string().min(1).max(100).optional(),
    facts: z
      .object({
        productName: z.string().min(1).max(140).optional(),
        keyFeatures: z.array(z.string().min(1).max(200)).max(10).optional(),
        audienceNote: z.string().min(1).max(300).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((input) => input.sourceProductId !== undefined || input.facts !== undefined, {
    message: "sourceProductId or facts is required",
  });

const DraftListingCopyOutputSchema = z
  .object({
    title: z.string().min(1).max(140),
    description: z.string().min(1).max(4000),
    highlights: z.array(z.string().min(1).max(200)).max(10),
    citations: z.array(DraftPolicySourceSchema).max(10),
    generatedAt: z.iso.datetime(),
  })
  .strict();

const SaveListingDraftInputSchema = z
  .object({
    draftId: z.string().min(1).max(100).optional(),
    title: z.string().min(1).max(140),
    description: z.string().min(1).max(4000),
    highlights: z.array(z.string().min(1).max(200)).max(10).optional(),
    sourceProductId: z.string().min(1).max(100).optional(),
  })
  .strict();

const SaveListingDraftOutputSchema = z
  .object({
    draftId: z.string().min(1).max(100),
    version: z.number().int().min(1),
    status: z.enum(["Draft", "Superseded"]),
    savedAt: z.iso.datetime(),
  })
  .strict();

const ListMyListingDraftsInputSchema = z
  .object({
    cursor: z.string().min(1).max(2048).optional(),
    limit: z.number().int().min(1).max(50).optional(),
    includeSuperseded: z.boolean().optional(),
  })
  .strict();

const ListingDraftSummarySchema = z
  .object({
    draftId: z.string().min(1).max(100),
    title: z.string().min(1).max(140),
    status: z.enum(["Draft", "Superseded"]),
    version: z.number().int().min(1),
    sourceProductId: z.string().min(1).max(100).nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

const ListMyListingDraftsOutputSchema = z
  .object({
    drafts: z.array(ListingDraftSummarySchema).max(50),
    nextCursor: z.string().min(1).max(2048).nullable(),
  })
  .strict();

const GetMyListingDraftInputSchema = z
  .object({
    draftId: z.string().min(1).max(100),
  })
  .strict();

const GetMyListingDraftOutputSchema = z
  .object({
    draftId: z.string().min(1).max(100),
    title: z.string().min(1).max(140),
    description: z.string().min(1).max(4000),
    highlights: z.array(z.string().min(1).max(200)).max(10),
    status: z.enum(["Draft", "Superseded"]),
    version: z.number().int().min(1),
    supersedesId: z.string().min(1).max(100).nullable(),
    sourceProductId: z.string().min(1).max(100).nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();


// Cart-change proposals (#22). The input is one action at a time with no
// confirmation flag, no execute field, and no caller-supplied totals: forged
// confirmation fields fail the schema, and the proposal never mutates the cart.
// The preview is the exact server-computed before/after (integer-paisa math,
// NPR decimal strings); the caller cannot influence it.
const ProposalPreviewSideSchema = z
  .object({
    quantity: z.number().int().min(1).nullable(),
    unitPrice: MoneySchema.nullable(),
    lineTotal: MoneySchema.nullable(),
    cartSubtotal: MoneySchema,
  })
  .strict();

const ProposalPreviewSchema = z
  .object({
    actionKind: z.enum(["cart.add_item", "cart.update_quantity", "cart.remove_item"]),
    currency: z.literal("NPR"),
    productName: z.string().min(1).max(200),
    availability: z.enum(["In stock", "Sold out", "Unavailable"]),
    before: ProposalPreviewSideSchema,
    after: ProposalPreviewSideSchema,
  })
  .strict();

const ProposalOptionsSchema = z
  .record(z.string().min(1).max(50), z.string().min(1).max(50))
  .refine((value) => Object.keys(value).length <= 5, { message: "options accepts at most 5 entries" })
  .optional();

const ProposeCartChangeInputSchema = z
  .object({
    action: z.enum(["add_item", "update_quantity", "remove_item"]),
    productId: z.string().min(1).max(100).optional(),
    options: ProposalOptionsSchema,
    quantity: z.number().int().min(1).max(20).optional(),
    cartItemId: z.string().min(1).max(100).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const issue = (path, message) => ctx.addIssue({ code: "custom", path, message });
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

const ProposeCartChangeOutputSchema = z
  .object({
    proposalId: z.string().min(1).max(100),
    status: z.literal("pending"),
    expiresAt: z.iso.datetime().max(100),
    preview: ProposalPreviewSchema,
  })
  .strict();

const ProposalActionKindSchema = z.enum([
  "cart.add_item",
  "cart.update_quantity",
  "cart.remove_item",
  "order.cancel",
  "order.return_request",
]);

const GetMyActionStatusInputSchema = z
  .object({
    proposalId: z.string().min(1).max(100),
  })
  .strict();

const GetMyActionStatusOutputSchema = z
  .object({
    proposalId: z.string().min(1).max(100),
    actionKind: ProposalActionKindSchema,
    status: z.enum(["pending", "executed", "expired", "stale", "rejected"]),
    createdAt: z.iso.datetime().max(100),
    expiresAt: z.iso.datetime().max(100),
    executedAt: z.iso.datetime().max(100).nullable(),
    outcomeReason: z.string().min(1).max(50).nullable(),
  })
  .strict();

// Seller listing proposals (#26). Closed allowlist content only: seller
// identity, price, stock, quantity, discount, visibility, and deletion fields
// are not part of the schema and therefore fail strict parsing. Money is not
// involved anywhere in the listing content contract.
const ListingDraftIdSchema = z.string().regex(/^[a-f0-9]{24}$/);

const ListingDisclosuresSchema = z.array(z.string().min(1).max(200)).max(5);

const ProposeListingPublishInputSchema = z
  .object({
    draftId: ListingDraftIdSchema,
  })
  .strict();

const ProposeListingPublishOutputSchema = z
  .object({
    proposalId: z.string().min(1).max(100),
    status: z.literal("pending"),
    expiresAt: z.iso.datetime().max(100),
    preview: z
      .object({
        actionKind: z.literal("listing.publish_draft"),
        draftId: z.string().min(1).max(100),
        title: z.string().min(1).max(140),
        description: z.string().max(4000),
        highlights: z.array(z.string().min(1).max(200)).max(10),
        sourceProductId: z.string().min(1).max(100).nullable(),
        disclosedConsequences: ListingDisclosuresSchema,
      })
      .strict(),
  })
  .strict();

const ListingContentSchema = z
  .object({
    name: z.string().min(1).max(140).optional(),
    description: z.string().min(1).max(4000).optional(),
    images: z.array(z.string().min(1).max(500)).max(6).optional(),
  })
  .strict();

const ProposeListingContentChangeInputSchema = z
  .object({
    productId: z.string().min(1).max(100),
    content: ListingContentSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.content.name === undefined && value.content.description === undefined && value.content.images === undefined) {
      ctx.addIssue({ code: "custom", path: ["content"], message: "content requires at least one allowlisted field" });
    }
  });

const ListingContentSideSchema = z
  .object({
    name: z.string().min(1).max(140).optional(),
    description: z.string().max(4000).optional(),
    images: z.array(z.string().max(500)).max(50).optional(),
  })
  .strict();

const ProposeListingContentChangeOutputSchema = z
  .object({
    proposalId: z.string().min(1).max(100),
    status: z.literal("pending"),
    expiresAt: z.iso.datetime().max(100),
    preview: z
      .object({
        actionKind: z.literal("listing.update_content"),
        productId: z.string().min(1).max(100),
        productName: z.string().min(1).max(140),
        before: ListingContentSideSchema,
        after: ListingContentSideSchema,
        disclosedConsequences: ListingDisclosuresSchema,
      })
      .strict(),
  })
  .strict();


// Buyer order-cancellation proposals (#24). The preview is the exact
// server-computed snapshot of the owned order at propose time: only an
// eligible order (Pending|Confirmed — the server's fixed cancellable set)
// produces a proposal, so currentStatus is pinned to those two values and
// cancelEligible is always true in an output. stockToRestore follows the
// server cancellation rule (quantity restored only from "Confirmed", 0
// otherwise), paidAmount is the exact-decimal NPR amount of a succeeded
// payment or null, and the disclosed consequences are fixed server strings
// that state plainly that any refund is a separate manual admin action never
// initiated by this tool or its execution.
const ProposeOrderCancellationInputSchema = z
  .object({
    orderId: z.string().regex(/^[A-Za-z0-9]{1,24}$/),
  })
  .strict();

const OrderCancellationPreviewSchema = z
  .object({
    actionKind: z.literal("order.cancel"),
    currency: z.literal("NPR"),
    orderId: z.string().min(1).max(100),
    orderNumber: z.string().min(1).max(100).nullable(),
    currentStatus: z.enum(["Pending", "Confirmed"]),
    cancelEligible: z.literal(true),
    stockToRestore: z.number().int().min(0).max(10_000),
    paidAmount: MoneySchema.nullable(),
    disclosedConsequences: z.array(z.string().min(1).max(200)).max(10),
  })
  .strict();

const ProposeOrderCancellationOutputSchema = z
  .object({
    proposalId: z.string().min(1).max(100),
    status: z.literal("pending"),
    expiresAt: z.iso.datetime().max(100),
    preview: OrderCancellationPreviewSchema,
  })
  .strict();

// Buyer return proposals (#25). The input is exactly one owned order plus a
// bounded free-text reason — there is no evidence URL, attachment path, or
// image field (evidence upload stays in ShopSphere's trusted flows), and no
// confirm/execute affordance: forged fields fail the schema, not the order.
// The preview is the exact server-computed owned-order and policy picture; the
// caller cannot influence any of it. Money uses the shared NPR contract.
const ProposeOrderReturnInputSchema = z
  .object({
    orderId: z.string().regex(/^[A-Za-z0-9]{1,24}$/),
    reason: z.string().trim().min(10).max(1000),
  })
  .strict();

const ProposeOrderReturnPreviewSchema = z
  .object({
    orderId: z.string().min(1).max(100),
    orderNumber: z.string().min(1).max(100).nullable(),
    currentStatus: z.string().min(1).max(50),
    returnEligible: z.literal(true),
    orderTotal: MoneySchema,
    policyBasis: z.array(DraftPolicySourceSchema).max(10),
    disclosedConsequences: z.array(z.string().min(1).max(300)).max(10),
  })
  .strict();

const ProposeOrderReturnOutputSchema = z
  .object({
    proposalId: z.string().min(1).max(100),
    status: z.literal("pending"),
    expiresAt: z.iso.datetime().max(100),
    preview: ProposeOrderReturnPreviewSchema,
  })
  .strict();


// Seller price proposals (#27). The input is exactly one owned product, one
// change kind, and one bounded decimal value — there is NO optionId (options
// carry additive priceDelta deltas, not absolute prices, so option-level
// targeting cannot produce an exact old/new-value contract), no caller-supplied
// payable total, and no confirm/execute affordance: forged fields fail the
// schema, not the listing. The configured bounds ([1, 999999.99] NPR for
// set_price, [0, 100]% for set_discount) and the differ-from-current rule are
// enforced server-side (assistantPriceProposals.js) and re-checked at
// execution. The preview is the exact server-computed old/new snapshot with
// integer-paisa display math (the exact-decimal form of
// effectiveProductPrice) and fixed disclosure strings.
const ProposePriceChangeInputSchema = z
  .object({
    productId: z.string().min(1).max(100),
    change: z.enum(["set_price", "set_discount"]),
    newValue: DecimalInputSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.change === "set_discount" && !/^\d{1,4}(\.\d{1,2})?$/.test(value.newValue)) {
      ctx.addIssue({ code: "custom", path: ["newValue"], message: "set_discount takes a percent between 0 and 100" });
    }
  });

const PriceChangeValueSchema = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/);

const ProposePriceChangePreviewSchema = z
  .object({
    actionKind: z.enum(["product.set_price", "product.set_discount"]),
    currency: z.literal("NPR"),
    productId: z.string().min(1).max(100),
    productName: z.string().min(1).max(200),
    change: z.enum(["set_price", "set_discount"]),
    oldValue: PriceChangeValueSchema,
    newValue: PriceChangeValueSchema,
    effectiveDisplayPriceBefore: MoneySchema,
    effectiveDisplayPriceAfter: MoneySchema,
    disclosedConsequences: z.array(z.string().min(1).max(300)).max(10),
  })
  .strict();

const ProposePriceChangeOutputSchema = z
  .object({
    proposalId: z.string().min(1).max(100),
    status: z.literal("pending"),
    expiresAt: z.iso.datetime().max(100),
    preview: ProposePriceChangePreviewSchema,
  })
  .strict();

// Seller inventory proposals (#28). The input is exactly one owned product,
// at most one optionId (the option must track its own stock — stock != null;
// a product-level quantity target is allowed only when NO option tracks
// stock), exactly one of a bounded signed adjustment or an absolute setTo,
// and a REQUIRED user-authored reason. There is NO confirm/execute
// affordance, no other absolute-overwrite field, and no second change per
// proposal: forged fields fail the schema, not the stock. The bounds
// ([-10000, 10000] / [0, 100000]) and the nonnegative-result rule are
// enforced server-side (assistantInventoryProposals.js) against the CURRENT
// count and re-checked at execution. The preview is the exact server-computed
// target/current/requested snapshot with fixed disclosure strings.
const ProposeInventoryAdjustmentInputSchema = z
  .object({
    productId: z.string().min(1).max(100),
    optionId: z.string().min(1).max(100).optional(),
    adjustment: z.number().int().min(-10000).max(10000).optional(),
    setTo: z.number().int().min(0).max(100000).optional(),
    reason: z.string().trim().min(20).max(500),
  })
  .strict()
  .superRefine((value, ctx) => {
    const given = (value.adjustment !== undefined ? 1 : 0) + (value.setTo !== undefined ? 1 : 0);
    if (given !== 1) {
      ctx.addIssue({ code: "custom", path: ["adjustment"], message: "exactly one of adjustment or setTo is required" });
    }
  });

const ProposeInventoryAdjustmentPreviewSchema = z
  .object({
    actionKind: z.literal("inventory.adjust"),
    productId: z.string().min(1).max(100),
    productName: z.string().min(1).max(200),
    optionId: z.string().min(1).max(100).optional(),
    optionKind: z.string().min(1).max(100).optional(),
    optionValue: z.string().min(1).max(200).optional(),
    currentCount: z.number().int().min(0),
    requestedCount: z.number().int().min(0),
    reason: z.string().min(20).max(500),
    disclosedConsequences: z.array(z.string().min(1).max(300)).max(10),
  })
  .strict();

const ProposeInventoryAdjustmentOutputSchema = z
  .object({
    proposalId: z.string().min(1).max(100),
    status: z.literal("pending"),
    expiresAt: z.iso.datetime().max(100),
    preview: ProposeInventoryAdjustmentPreviewSchema,
  })
  .strict();


// Seller fulfillment-transition proposals (#29). The input is exactly one owned
// sale line (the seller's own Order row id, attributed via the immutable
// sellerIdAtPurchase) and the requested next stage. There is NO currentStatus
// input (the server derives the exact stored status) and NO confirm/execute
// affordance: forged fields fail the schema, not the order. Eligibility is the
// exact server state machine — only the exact next stage out of
// Confirmed/Processing/Shipped can be proposed (pending payment can never be
// proposed to Confirmed or beyond) — so the output's currentStatus is pinned to
// the three fulfillable stages and willSetTimestamp to the four stage
// timestamp fields. The disclosed consequences are fixed server strings; the
// notification line states honestly that this execution sends no buyer
// notification/email (the storefront fulfillment flow normally sends one).
const ProposeFulfillmentTransitionInputSchema = z
  .object({
    saleLineId: z.string().regex(/^[a-f0-9]{24}$/),
    nextStatus: z.enum(["Processing", "Shipped", "Delivered"]),
  })
  .strict();

const ProposeFulfillmentPreviewSchema = z
  .object({
    actionKind: z.literal("sale.advance_fulfillment"),
    saleLineId: z.string().min(1).max(100),
    orderNumber: z.string().min(1).max(100).nullable(),
    productName: z.string().min(1).max(200).nullable(),
    currentStatus: z.enum(["Confirmed", "Processing", "Shipped"]),
    nextStatus: z.enum(["Processing", "Shipped", "Delivered"]),
    stageTimestamps: z
      .object({
        confirmedAt: z.iso.datetime().max(100).nullable(),
        processingAt: z.iso.datetime().max(100).nullable(),
        shippedAt: z.iso.datetime().max(100).nullable(),
        deliveredAt: z.iso.datetime().max(100).nullable(),
      })
      .strict(),
    willSetTimestamp: z.enum(["confirmedAt", "processingAt", "shippedAt", "deliveredAt"]),
    disclosedConsequences: z.array(z.string().min(1).max(300)).max(10),
  })
  .strict();

const ProposeFulfillmentTransitionOutputSchema = z
  .object({
    proposalId: z.string().min(1).max(100),
    status: z.literal("pending"),
    expiresAt: z.iso.datetime().max(100),
    preview: ProposeFulfillmentPreviewSchema,
  })
  .strict();


// Admin support queues (#17): membership is a fixed server rule — the exact
// stored return/refund exception status strings inside a rolling 90-day window —
// never a caller-supplied filter. Inputs therefore carry pagination only, plus
// an explicit purpose for the detail audit trail. Statuses are the exact
// stored server strings (with spaces); the MCP-fictional "ReturnRequested" and
// "Returned" names used by earlier buyer/seller enums are deliberately absent.
// Refunds are only created against "Return Approved" or "Cancelled" orders and
// a failed refund leaves that status untouched, so "Cancelled" is part of the
// exception queue's closed status set — the output never misrepresents rows.
const AdminQueueStatusSchema = z.enum([
  "Return Requested",
  "Return Approved",
  "Return Rejected",
  "Refund Released",
  "Cancelled",
]);

const AdminReturnStatusSchema = z.enum([
  "Return Requested",
  "Return Approved",
  "Return Rejected",
]);

const RefundStateSchema = z.enum(["Processing", "Succeeded", "Failed"]);

const AdminQueuePageInputSchema = z.object({
  cursor: z.string().min(1).max(2048).optional(),
  limit: z.number().int().min(1).max(50).optional(),
}).strict();

const AdminQueueOrderSchema = z
  .object({
    orderId: z.string().min(1).max(100),
    orderNumber: z.string().min(1).max(100).nullable(),
    status: AdminQueueStatusSchema,
    returnRequestedAt: z.iso.datetime().max(100).nullable(),
    refundStatus: RefundStateSchema.nullable(),
    refundAmount: MoneySchema.nullable(),
    buyerReference: z.string().min(1).max(100).nullable(),
    sellerReference: z.string().min(1).max(100).nullable(),
    lastTransitionAt: z.iso.datetime().max(100),
  })
  .strict();

const ListOrderExceptionQueueOutputSchema = z
  .object({
    orders: z.array(AdminQueueOrderSchema).max(50),
    nextCursor: z.string().min(1).max(2048).nullable(),
  })
  .strict();

const GetOrderExceptionDetailInputSchema = z
  .object({
    orderId: z.string().min(1).max(100),
    purpose: z.string().min(10).max(500),
  })
  .strict();

const GetOrderExceptionDetailOutputSchema = z
  .object({
    order: AdminQueueOrderSchema.extend({
      quantity: z.number().int().min(1),
      totalPrice: MoneySchema,
      adminCommission: MoneySchema.nullable(),
      confirmedAt: z.iso.datetime().max(100).nullable(),
      processingAt: z.iso.datetime().max(100).nullable(),
      shippedAt: z.iso.datetime().max(100).nullable(),
      deliveredAt: z.iso.datetime().max(100).nullable(),
      cancelledAt: z.iso.datetime().max(100).nullable(),
      returnReason: z.string().max(1000).nullable(),
      refundReleasedAt: z.iso.datetime().max(100).nullable(),
    }).strict(),
  })
  .strict();

const AdminReturnQueueRowSchema = z
  .object({
    orderId: z.string().min(1).max(100),
    orderNumber: z.string().min(1).max(100).nullable(),
    status: AdminReturnStatusSchema,
    returnRequestedAt: z.iso.datetime().max(100),
    returnReason: z.string().max(1000).nullable(),
    buyerReference: z.string().min(1).max(100).nullable(),
    sellerReference: z.string().min(1).max(100).nullable(),
    hasReturnImage: z.boolean(),
    refundStatus: RefundStateSchema.nullable(),
  })
  .strict();

const ListReturnQueueOutputSchema = z
  .object({
    returns: z.array(AdminReturnQueueRowSchema).max(50),
    nextCursor: z.string().min(1).max(2048).nullable(),
  })
  .strict();


// Buyer support-message drafting (#19): deterministic template composition
// from the buyer's own minimized order facts plus approved, versioned policy
// answers. The buyer picks the owned order and a bounded topic; no recipient,
// channel, or send/submit affordance exists in the contract, and the composed
// draft is bounded to 4000 characters.
const SUPPORT_DRAFT_TOPICS = Object.freeze([
  "order_status",
  "delivery_issue",
  "return_question",
  "refund_question",
  "other",
]);

const DraftSupportMessageInputSchema = z
  .object({
    orderId: z.string().regex(/^[A-Za-z0-9]{1,24}$/),
    topic: z.enum(SUPPORT_DRAFT_TOPICS),
    notes: z.string().min(1).max(500).optional(),
  })
  .strict();

const SupportDraftCitationSchema = z
  .object({
    sourceId: z.string().min(1).max(100),
    sourceVersion: z.literal(POLICY_VERSION),
  })
  .strict();

const DraftSupportMessageOutputSchema = z
  .object({
    orderId: z.string().min(1).max(24),
    topic: z.enum(SUPPORT_DRAFT_TOPICS),
    draft: z.string().min(1).max(4000),
    truncated: z.boolean(),
    citations: z.array(SupportDraftCitationSchema).max(10),
    generatedAt: z.iso.datetime(),
  })
  .strict();


// Admin promotion reads (#18): configuration is public inside the admin trust
// boundary — the code string itself is included — but creator identity and any
// per-user redemption data (user ids, redemption timestamps, per-user rows)
// have no field in these schemas at all. Percentage and fixed discounts are
// exact decimal values: percentages are bounded 0..100, fixed amounts use the
// shared money contract.
const PromotionPercentSchema = z
  .object({
    percent: z.string().regex(/^(?:\d{1,2}(?:\.\d{1,2})?|100(?:\.0{1,2})?)$/),
  })
  .strict();

const PromotionConfigurationSchema = z
  .object({
    promoCodeId: z.string().min(1).max(100),
    code: z.string().min(1).max(50),
    discountType: z.enum(["percentage", "fixed"]),
    discountValue: z.union([PromotionPercentSchema, MoneySchema]),
    minPurchase: MoneySchema,
    maxDiscount: MoneySchema.nullable(),
    usageLimit: z.number().int().min(1).nullable(),
    usedCount: z.number().int().nonnegative(),
    validFrom: z.iso.datetime().max(100),
    validUntil: z.iso.datetime().max(100).nullable(),
    isActive: z.boolean(),
  })
  .strict();

const ListPromotionConfigurationInputSchema = z
  .object({
    cursor: z.string().min(1).max(2048).optional(),
    limit: z.number().int().min(1).max(50).optional(),
    activeOnly: z.boolean().optional(),
  })
  .strict();

const ListPromotionConfigurationOutputSchema = z
  .object({
    promotions: z.array(PromotionConfigurationSchema).max(50),
    nextCursor: z.string().min(1).max(2048).nullable(),
  })
  .strict();

const PromoCodeIdInputSchema = z
  .object({
    promoCodeId: z.string().min(1).max(100),
  })
  .strict();

const GetPromotionUsageSummaryOutputSchema = z
  .object({
    promoCodeId: z.string().min(1).max(100),
    code: z.string().min(1).max(50),
    totalRedemptions: z.number().int().nonnegative(),
    distinctUsers: z.number().int().nonnegative(),
    active: z.boolean(),
    validFrom: z.iso.datetime().max(100),
    validUntil: z.iso.datetime().max(100).nullable(),
  })
  .strict();

// Admin recommendation drafts (#21): deterministic template composition from
// the authorized minimized admin views plus approved, versioned policy
// sources. Recommendations never decide — no approve/reject/refund/activation/
// reset/notify affordance exists in any of these contracts. Inputs carry
// opaque references only: raw user ids, emails, and decision or outcome fields
// have no field at all. The recommendation text is bounded to 4000 characters
// with an explicit truncation flag, and absent facts render as "unknown"
// inside the text rather than being inferred.
const RecommendationCitationSchema = z
  .object({
    sourceId: z.string().min(1).max(100),
    sourceVersion: z.literal(POLICY_VERSION),
  })
  .strict();

const RecommendationDraftOutputSchema = z
  .object({
    recommendation: z.string().min(1).max(4000),
    truncated: z.boolean(),
    citations: z.array(RecommendationCitationSchema).max(10),
    generatedAt: z.iso.datetime(),
  })
  .strict();

// The seller reference is the opaque digest emitted by list_seller_applications
// (seller-<12 hex>); raw user ids and emails cannot be expressed.
const DraftSellerReviewRecommendationInputSchema = z
  .object({
    sellerReference: z.string().regex(/^seller-[0-9a-f]{12}$/),
  })
  .strict();

// The purpose mirrors get_order_exception_detail: bounded admin-supplied text
// recording why this access happened, audited server-side and never returned.
const DraftReturnReviewRecommendationInputSchema = z
  .object({
    orderId: z.string().min(1).max(100),
    purpose: z.string().min(10).max(500),
  })
  .strict();

const DraftPromotionRecommendationInputSchema = z
  .object({
    promoCodeId: z.string().min(1).max(100),
  })
  .strict();

const definitions = [
  {
    name: "get_capabilities",
    title: "Get ShopSphere capabilities",
    description: "Lists the ShopSphere MCP capabilities currently available to this caller and their policy metadata.",
    inputSchema: z.object({}).strict(),
    outputSchema: CapabilitiesOutputSchema,
    operationClass: "read",
    roles: ["public"],
    scopes: [],
    rateClass: "discovery",
    rollout: {
      flag: "MCP_TOOL_GET_CAPABILITIES_ENABLED",
      defaultEnabled: false,
    },
    backendOperation: {
      kind: "local",
      operationId: "registry.getCapabilities",
      method: null,
      path: null,
    },
  },
  {
    name: "get_my_profile_summary",
    title: "Get my ShopSphere profile summary",
    description: "Reads the authenticated user's display name, current role, and verification state.",
    inputSchema: z.object({}).strict(),
    outputSchema: GetMyProfileSummaryOutputSchema,
    operationClass: "read",
    roles: ["user", "seller", "admin"],
    scopes: ["profile:read"],
    rateClass: "authenticated-read",
    rollout: {
      flag: "MCP_TOOL_GET_MY_PROFILE_SUMMARY_ENABLED",
      defaultEnabled: false,
    },
    backendOperation: {
      kind: "http",
      operationId: "profile.getMySummary",
      method: "POST",
      path: "/api/v1/assistant/get_my_profile_summary",
    },
  },
  {
    name: "list_my_notifications",
    title: "List my ShopSphere notifications",
    description: "Reads one bounded page of notifications owned by the authenticated user.",
    inputSchema: ListMyNotificationsInputSchema,
    outputSchema: ListMyNotificationsOutputSchema,
    operationClass: "read",
    roles: ["user", "seller", "admin"],
    scopes: ["notifications:read"],
    rateClass: "authenticated-read",
    rollout: {
      flag: "MCP_TOOL_LIST_MY_NOTIFICATIONS_ENABLED",
      defaultEnabled: false,
    },
    backendOperation: {
      kind: "http",
      operationId: "notifications.listMine",
      method: "POST",
      path: "/api/v1/assistant/list_my_notifications",
    },
  },
  {
    name: "get_store_policy",
    title: "Get ShopSphere store policy",
    description:
      "Answers approved ShopSphere store policy questions from versioned curated sources.",
    inputSchema: GetStorePolicyInputSchema,
    outputSchema: GetStorePolicyOutputSchema,
    operationClass: "read",
    roles: ["public"],
    scopes: [],
    rateClass: "public-read",
    rollout: {
      flag: "MCP_TOOL_GET_STORE_POLICY_ENABLED",
      defaultEnabled: false,
    },
    backendOperation: {
      kind: "http",
      operationId: "policy.getStorePolicy",
      method: "POST",
      path: "/api/v1/assistant/get_store_policy",
    },
  },
  {
    name: "search_products",
    title: "Search ShopSphere products",
    description: "Searches visible public products by text, category, and price with capped pages.",
    inputSchema: SearchProductsInputSchema,
    outputSchema: SearchProductsOutputSchema,
    operationClass: "read",
    roles: ["public"],
    scopes: [],
    rateClass: "public-read",
    rollout: {
      flag: "MCP_TOOL_SEARCH_PRODUCTS_ENABLED",
      defaultEnabled: false,
    },
    backendOperation: {
      kind: "http",
      operationId: "catalog.searchProducts",
      method: "POST",
      path: "/api/v1/assistant/search_products",
    },
  },
  {
    name: "compare_products",
    title: "Compare ShopSphere products",
    description: "Compares up to 5 visible public products using the same public projection.",
    inputSchema: CompareProductsInputSchema,
    outputSchema: CompareProductsOutputSchema,
    operationClass: "read",
    roles: ["public"],
    scopes: [],
    rateClass: "public-read",
    rollout: {
      flag: "MCP_TOOL_COMPARE_PRODUCTS_ENABLED",
      defaultEnabled: false,
    },
    backendOperation: {
      kind: "http",
      operationId: "catalog.compareProducts",
      method: "POST",
      path: "/api/v1/assistant/compare_products",
    },
  },
  {
    name: "get_product",
    title: "Get ShopSphere product",
    description: "Inspects one visible public product: variants, displayed price, and availability label.",
    inputSchema: GetProductInputSchema,
    outputSchema: ProductDetailSchema,
    operationClass: "read",
    roles: ["public"],
    scopes: [],
    rateClass: "public-read",
    rollout: {
      flag: "MCP_TOOL_GET_PRODUCT_ENABLED",
      defaultEnabled: false,
    },
    backendOperation: {
      kind: "http",
      operationId: "catalog.getProduct",
      method: "POST",
      path: "/api/v1/assistant/get_product",
    },
  },
  {
    name: "get_product_reviews",
    title: "Get ShopSphere product reviews",
    description: "Reads bounded display-safe reviews for one visible public product; content is untrusted.",
    inputSchema: GetProductReviewsInputSchema,
    outputSchema: GetProductReviewsOutputSchema,
    operationClass: "read",
    roles: ["public"],
    scopes: [],
    rateClass: "public-read",
    rollout: {
      flag: "MCP_TOOL_GET_PRODUCT_REVIEWS_ENABLED",
      defaultEnabled: false,
    },
    backendOperation: {
      kind: "http",
      operationId: "catalog.getProductReviews",
      method: "POST",
      path: "/api/v1/assistant/get_product_reviews",
    },
  },
  {
    name: "get_recommendations",
    title: "Get ShopSphere recommendations",
    description: "Lists currently available public products related to one visible product.",
    inputSchema: GetRecommendationsInputSchema,
    outputSchema: GetRecommendationsOutputSchema,
    operationClass: "read",
    roles: ["public"],
    scopes: [],
    rateClass: "public-read",
    rollout: {
      flag: "MCP_TOOL_GET_RECOMMENDATIONS_ENABLED",
      defaultEnabled: false,
    },
    backendOperation: {
      kind: "http",
      operationId: "catalog.getRecommendations",
      method: "POST",
      path: "/api/v1/assistant/get_recommendations",
    },
  },
  {
    name: "get_my_cart",
    title: "Get my ShopSphere cart",
    description: "Reads the authenticated buyer's cart items with server-calculated totals.",
    inputSchema: z.object({}).strict(),
    outputSchema: CartTotalsSchema,
    operationClass: "read",
    roles: ["user"],
    scopes: ["cart:read"],
    rateClass: "authenticated-read",
    rollout: {
      flag: "MCP_TOOL_GET_MY_CART_ENABLED",
      defaultEnabled: false,
    },
    backendOperation: {
      kind: "http",
      operationId: "cart.getMine",
      method: "POST",
      path: "/api/v1/assistant/get_my_cart",
    },
  },
  {
    name: "validate_promo_code",
    title: "Validate a ShopSphere promo code",
    description: "Checks a promo code against the buyer's cart without redeeming it.",
    inputSchema: ValidatePromoCodeInputSchema,
    outputSchema: ValidatePromoCodeOutputSchema,
    operationClass: "read",
    roles: ["user"],
    scopes: ["cart:read"],
    rateClass: "authenticated-read",
    rollout: {
      flag: "MCP_TOOL_VALIDATE_PROMO_CODE_ENABLED",
      defaultEnabled: false,
    },
    backendOperation: {
      kind: "http",
      operationId: "cart.validatePromo",
      method: "POST",
      path: "/api/v1/assistant/validate_promo_code",
    },
  },
  {
    name: "preview_checkout",
    title: "Preview ShopSphere checkout totals",
    description: "Previews exact server-calculated checkout totals without creating an order.",
    inputSchema: PreviewCheckoutInputSchema,
    outputSchema: PreviewCheckoutOutputSchema,
    operationClass: "read",
    roles: ["user"],
    scopes: ["cart:read"],
    rateClass: "authenticated-read",
    rollout: {
      flag: "MCP_TOOL_PREVIEW_CHECKOUT_ENABLED",
      defaultEnabled: false,
    },
    backendOperation: {
      kind: "http",
      operationId: "cart.previewCheckout",
      method: "POST",
      path: "/api/v1/assistant/preview_checkout",
    },
  },
  {
    name: "list_my_orders",
    title: "List my ShopSphere orders",
    description: "Lists the authenticated buyer's orders over a bounded date range.",
    inputSchema: ListMyOrdersInputSchema,
    outputSchema: ListMyOrdersOutputSchema,
    operationClass: "read",
    roles: ["user"],
    scopes: ["orders:read"],
    rateClass: "authenticated-read",
    rollout: {
      flag: "MCP_TOOL_LIST_MY_ORDERS_ENABLED",
      defaultEnabled: false,
    },
    backendOperation: {
      kind: "http",
      operationId: "orders.listMine",
      method: "POST",
      path: "/api/v1/assistant/list_my_orders",
    },
  },
  {
    name: "get_my_order",
    title: "Get my ShopSphere order",
    description: "Inspects one order owned by the authenticated buyer.",
    inputSchema: OrderIdInputSchema,
    outputSchema: GetMyOrderOutputSchema,
    operationClass: "read",
    roles: ["user"],
    scopes: ["orders:read"],
    rateClass: "authenticated-read",
    rollout: {
      flag: "MCP_TOOL_GET_MY_ORDER_ENABLED",
      defaultEnabled: false,
    },
    backendOperation: {
      kind: "http",
      operationId: "orders.getMine",
      method: "POST",
      path: "/api/v1/assistant/get_my_order",
    },
  },
  {
    name: "track_my_order",
    title: "Track my ShopSphere order",
    description: "Reads the stored delivery timeline of one buyer-owned order.",
    inputSchema: OrderIdInputSchema,
    outputSchema: TrackMyOrderOutputSchema,
    operationClass: "read",
    roles: ["user"],
    scopes: ["orders:read"],
    rateClass: "authenticated-read",
    rollout: {
      flag: "MCP_TOOL_TRACK_MY_ORDER_ENABLED",
      defaultEnabled: false,
    },
    backendOperation: {
      kind: "http",
      operationId: "orders.trackMine",
      method: "POST",
      path: "/api/v1/assistant/track_my_order",
    },
  },
  {
    name: "get_my_bill_summary",
    title: "Get my ShopSphere bill summary",
    description: "Reads an existing bill summary without generating or updating a bill.",
    inputSchema: OrderIdInputSchema,
    outputSchema: GetMyBillSummaryOutputSchema,
    operationClass: "read",
    roles: ["user"],
    scopes: ["orders:read"],
    rateClass: "authenticated-read",
    rollout: {
      flag: "MCP_TOOL_GET_MY_BILL_SUMMARY_ENABLED",
      defaultEnabled: false,
    },
    backendOperation: {
      kind: "http",
      operationId: "orders.getMyBillSummary",
      method: "POST",
      path: "/api/v1/assistant/get_my_bill_summary",
    },
  },
  {
    name: "get_my_payment_status",
    title: "Get my ShopSphere payment status",
    description: "Reads minimized payment and refund status without gateway details.",
    inputSchema: OrderIdInputSchema,
    outputSchema: GetMyPaymentStatusOutputSchema,
    operationClass: "read",
    roles: ["user"],
    scopes: ["orders:read"],
    rateClass: "authenticated-read",
    rollout: {
      flag: "MCP_TOOL_GET_MY_PAYMENT_STATUS_ENABLED",
      defaultEnabled: false,
    },
    backendOperation: {
      kind: "http",
      operationId: "orders.getMyPaymentStatus",
      method: "POST",
      path: "/api/v1/assistant/get_my_payment_status",
    },
  },
  {
    name: "list_my_products",
    title: "List my ShopSphere products",
    description: "Lists products owned by the authenticated seller, including archived ones.",
    inputSchema: ListMyProductsInputSchema,
    outputSchema: ListMyProductsOutputSchema,
    operationClass: "read",
    roles: ["seller"],
    scopes: ["catalog:read"],
    rateClass: "authenticated-read",
    rollout: {
      flag: "MCP_TOOL_LIST_MY_PRODUCTS_ENABLED",
      defaultEnabled: false,
    },
    backendOperation: {
      kind: "http",
      operationId: "products.listMine",
      method: "POST",
      path: "/api/v1/assistant/list_my_products",
    },
  },
  {
    name: "get_my_product",
    title: "Get my ShopSphere product",
    description: "Inspects one seller-owned product with exact option stock.",
    inputSchema: GetProductInputSchema,
    outputSchema: GetMyProductOutputSchema,
    operationClass: "read",
    roles: ["seller"],
    scopes: ["catalog:read"],
    rateClass: "authenticated-read",
    rollout: {
      flag: "MCP_TOOL_GET_MY_PRODUCT_ENABLED",
      defaultEnabled: false,
    },
    backendOperation: {
      kind: "http",
      operationId: "products.getMine",
      method: "POST",
      path: "/api/v1/assistant/get_my_product",
    },
  },
  {
    name: "get_my_inventory_summary",
    title: "Get my ShopSphere inventory summary",
    description: "Summarizes low-stock counts for the authenticated seller's products.",
    inputSchema: GetMyInventorySummaryInputSchema,
    outputSchema: GetMyInventorySummaryOutputSchema,
    operationClass: "read",
    roles: ["seller"],
    scopes: ["catalog:read"],
    rateClass: "authenticated-read",
    rollout: {
      flag: "MCP_TOOL_GET_MY_INVENTORY_SUMMARY_ENABLED",
      defaultEnabled: false,
    },
    backendOperation: {
      kind: "http",
      operationId: "products.getMyInventorySummary",
      method: "POST",
      path: "/api/v1/assistant/get_my_inventory_summary",
    },
  },
  {
    name: "list_my_seller_orders",
    title: "List my ShopSphere sales",
    description:
      "Lists sale lines attributed to the authenticated seller at purchase time over a bounded date range, with opaque buyer references.",
    inputSchema: ListMySellerOrdersInputSchema,
    outputSchema: ListMySellerOrdersOutputSchema,
    operationClass: "read",
    roles: ["seller"],
    scopes: ["sales:read"],
    rateClass: "authenticated-read",
    rollout: {
      flag: "MCP_TOOL_LIST_MY_SELLER_ORDERS_ENABLED",
      defaultEnabled: false,
    },
    backendOperation: {
      kind: "http",
      operationId: "sales.listMine",
      method: "POST",
      path: "/api/v1/assistant/list_my_seller_orders",
    },
  },
  {
    name: "get_my_seller_order",
    title: "Get my ShopSphere sale",
    description:
      "Inspects one sale line attributed to the authenticated seller at purchase time, with its stored ledger entry and only same-seller group lines.",
    inputSchema: GetMySellerOrderInputSchema,
    outputSchema: GetMySellerOrderOutputSchema,
    operationClass: "read",
    roles: ["seller"],
    scopes: ["sales:read"],
    rateClass: "authenticated-read",
    rollout: {
      flag: "MCP_TOOL_GET_MY_SELLER_ORDER_ENABLED",
      defaultEnabled: false,
    },
    backendOperation: {
      kind: "http",
      operationId: "sales.getMine",
      method: "POST",
      path: "/api/v1/assistant/get_my_seller_order",
    },
  },
  {
    name: "get_my_revenue_summary",
    title: "Get my ShopSphere revenue summary",
    description:
      "Reads twelve fixed monthly revenue buckets for the authenticated seller with explicit gross, commission, net, and refund amounts.",
    inputSchema: GetMyRevenueSummaryInputSchema,
    outputSchema: GetMyRevenueSummaryOutputSchema,
    operationClass: "read",
    roles: ["seller"],
    scopes: ["revenue:read"],
    rateClass: "authenticated-read",
    rollout: {
      flag: "MCP_TOOL_GET_MY_REVENUE_SUMMARY_ENABLED",
      defaultEnabled: false,
    },
    backendOperation: {
      kind: "http",
      operationId: "sales.revenueSummary",
      method: "POST",
      path: "/api/v1/assistant/get_my_revenue_summary",
    },
  },
  {
    name: "get_platform_revenue_summary",
    title: "Get ShopSphere platform revenue summary",
    description:
      "Reads twelve fixed platform-wide monthly revenue buckets for one year with explicit gross, commission, seller, and refund amounts.",
    inputSchema: GetPlatformRevenueSummaryInputSchema,
    outputSchema: GetPlatformRevenueSummaryOutputSchema,
    operationClass: "read",
    roles: ["admin"],
    scopes: ["platform:read"],
    rateClass: "authenticated-read",
    rollout: {
      flag: "MCP_TOOL_GET_PLATFORM_REVENUE_SUMMARY_ENABLED",
      defaultEnabled: false,
    },
    backendOperation: {
      kind: "http",
      operationId: "platform.revenueSummary",
      method: "POST",
      path: "/api/v1/assistant/get_platform_revenue_summary",
    },
  },
  {
    name: "list_seller_applications",
    title: "List ShopSphere seller applications",
    description:
      "Lists one bounded page of seller applications with approved shop display metadata and application status only.",
    inputSchema: ListSellerApplicationsInputSchema,
    outputSchema: ListSellerApplicationsOutputSchema,
    operationClass: "read",
    roles: ["admin"],
    scopes: ["sellers:read"],
    rateClass: "authenticated-read",
    rollout: {
      flag: "MCP_TOOL_LIST_SELLER_APPLICATIONS_ENABLED",
      defaultEnabled: false,
    },
    backendOperation: {
      kind: "http",
      operationId: "sellers.listApplications",
      method: "POST",
      path: "/api/v1/assistant/list_seller_applications",
    },
  },


  {
    name: "draft_listing_copy",
    title: "Draft ShopSphere listing copy",
    description:
      "Composes bounded listing copy from supplied facts or one seller-owned product using fixed templates; invents no condition, warranty, or policy claims and never publishes anything.",
    inputSchema: DraftListingCopyInputSchema,
    outputSchema: DraftListingCopyOutputSchema,
    operationClass: "draft",
    roles: ["seller"],
    scopes: ["listings:draft"],
    rateClass: "draft",
    rollout: {
      flag: "MCP_TOOL_DRAFT_LISTING_COPY_ENABLED",
      defaultEnabled: false,
    },
    backendOperation: {
      kind: "http",
      operationId: "listings.draftCopy",
      method: "POST",
      path: "/api/v1/assistant/draft_listing_copy",
    },
  },

  {
    name: "save_listing_draft",
    title: "Save my ShopSphere listing draft",
    description:
      "Creates or versions an unpublished listing draft owned by the authenticated seller and grant; saving never creates, modifies, publishes, or broadcasts a live listing.",
    inputSchema: SaveListingDraftInputSchema,
    outputSchema: SaveListingDraftOutputSchema,
    operationClass: "draft",
    roles: ["seller"],
    scopes: ["listings:draft"],
    rateClass: "draft",
    rollout: {
      flag: "MCP_TOOL_SAVE_LISTING_DRAFT_ENABLED",
      defaultEnabled: false,
    },
    backendOperation: {
      kind: "http",
      operationId: "listings.saveDraft",
      method: "POST",
      path: "/api/v1/assistant/save_listing_draft",
    },
  },

  {
    name: "list_my_listing_drafts",
    title: "List my ShopSphere listing drafts",
    description:
      "Lists one bounded page of unpublished listing drafts owned by the authenticated seller and grant, optionally including superseded versions.",
    inputSchema: ListMyListingDraftsInputSchema,
    outputSchema: ListMyListingDraftsOutputSchema,
    operationClass: "draft",
    roles: ["seller"],
    scopes: ["listings:draft"],
    rateClass: "draft",
    rollout: {
      flag: "MCP_TOOL_LIST_MY_LISTING_DRAFTS_ENABLED",
      defaultEnabled: false,
    },
    backendOperation: {
      kind: "http",
      operationId: "listings.listDrafts",
      method: "POST",
      path: "/api/v1/assistant/list_my_listing_drafts",
    },
  },

  {
    name: "get_my_listing_draft",
    title: "Get my ShopSphere listing draft",
    description:
      "Reads one full listing draft owned by the authenticated seller and grant, including its description, highlights, status, and version lineage.",
    inputSchema: GetMyListingDraftInputSchema,
    outputSchema: GetMyListingDraftOutputSchema,
    operationClass: "draft",
    roles: ["seller"],
    scopes: ["listings:draft"],
    rateClass: "draft",
    rollout: {
      flag: "MCP_TOOL_GET_MY_LISTING_DRAFT_ENABLED",
      defaultEnabled: false,
    },
    backendOperation: {
      kind: "http",
      operationId: "listings.getDraft",
      method: "POST",
      path: "/api/v1/assistant/get_my_listing_draft",
    },
  },

  {
    name: "propose_cart_change",
    title: "Propose a ShopSphere cart change",
    description:
      "Records one pending cart-change proposal for the buyer to review and confirm in ShopSphere. It never changes the cart and never takes payment.",
    inputSchema: ProposeCartChangeInputSchema,
    outputSchema: ProposeCartChangeOutputSchema,
    operationClass: "propose",
    roles: ["user"],
    scopes: ["cart:propose"],
    rateClass: "proposal",
    rollout: {
      flag: "MCP_TOOL_PROPOSE_CART_CHANGE_ENABLED",
      defaultEnabled: false,
    },
    backendOperation: {
      kind: "http",
      operationId: "proposals.proposeCartChange",
      method: "POST",
      path: "/api/v1/assistant/propose_cart_change",
    },
  },

  {
    name: "get_my_action_status",
    title: "Get my ShopSphere proposal status",
    description:
      "Reads the current status of one cart-change proposal owned by the caller. It never returns approval secrets, previews, or execution methods.",
    inputSchema: GetMyActionStatusInputSchema,
    outputSchema: GetMyActionStatusOutputSchema,
    operationClass: "read",
    roles: ["user"],
    scopes: ["proposals:read"],
    rateClass: "authenticated-read",
    rollout: {
      flag: "MCP_TOOL_GET_MY_ACTION_STATUS_ENABLED",
      defaultEnabled: false,
    },
    backendOperation: {
      kind: "http",
      operationId: "proposals.actionStatus",
      method: "POST",
      path: "/api/v1/assistant/get_my_action_status",
    },
  },

  {
    name: "propose_order_cancellation",
    title: "Propose a ShopSphere order cancellation",
    description:
      "Records one pending cancellation proposal for one of the buyer's own eligible orders to review and confirm in ShopSphere. It never cancels the order, never restores stock, and never starts a refund.",
    inputSchema: ProposeOrderCancellationInputSchema,
    outputSchema: ProposeOrderCancellationOutputSchema,
    operationClass: "propose",
    roles: ["user"],
    scopes: ["orders:propose"],
    rateClass: "proposal",
    rollout: {
      flag: "MCP_TOOL_PROPOSE_ORDER_CANCELLATION_ENABLED",
      defaultEnabled: false,
    },
    backendOperation: {
      kind: "http",
      operationId: "proposals.orderCancel",
      method: "POST",
      path: "/api/v1/assistant/propose_order_cancellation",
    },
  },

  {
    name: "propose_order_return",
    title: "Propose a ShopSphere order return",
    description:
      "Records one pending return-request proposal for one of the buyer's own delivered orders inside the approved return window. It accepts no evidence URLs or attachments, never creates the return itself, and never releases a refund.",
    inputSchema: ProposeOrderReturnInputSchema,
    outputSchema: ProposeOrderReturnOutputSchema,
    operationClass: "propose",
    roles: ["user"],
    scopes: ["returns:propose"],
    rateClass: "proposal",
    rollout: {
      flag: "MCP_TOOL_PROPOSE_ORDER_RETURN_ENABLED",
      defaultEnabled: false,
    },
    backendOperation: {
      kind: "http",
      operationId: "proposals.orderReturn",
      method: "POST",
      path: "/api/v1/assistant/propose_order_return",
    },
  },

  {
    name: "propose_price_change",
    title: "Propose a ShopSphere price change",
    description:
      "Records one pending price or discount proposal for one of the seller's own products to review and confirm in ShopSphere with a password re-confirmation. It accepts no option-level target, no caller-supplied totals, never changes the live listing, and never touches orders, payments, or promotions.",
    inputSchema: ProposePriceChangeInputSchema,
    outputSchema: ProposePriceChangeOutputSchema,
    operationClass: "propose",
    roles: ["seller"],
    scopes: ["pricing:propose"],
    rateClass: "proposal",
    rollout: {
      flag: "MCP_TOOL_PROPOSE_PRICE_CHANGE_ENABLED",
      defaultEnabled: false,
    },
    backendOperation: {
      kind: "http",
      operationId: "proposals.priceChange",
      method: "POST",
      path: "/api/v1/assistant/propose_price_change",
    },
  },

  {
    name: "propose_inventory_adjustment",
    title: "Propose a ShopSphere inventory adjustment",
    description:
      "Records one pending stock proposal for one of the seller's own products — exactly one stock-tracking option or the product-level quantity — with a required reason. Nothing is reserved or changed at creation; a concurrent sale makes the proposal stale, and confirmation in ShopSphere never overwrites it or drives stock negative.",
    inputSchema: ProposeInventoryAdjustmentInputSchema,
    outputSchema: ProposeInventoryAdjustmentOutputSchema,
    operationClass: "propose",
    roles: ["seller"],
    scopes: ["inventory:propose"],
    rateClass: "proposal",
    rollout: {
      flag: "MCP_TOOL_PROPOSE_INVENTORY_ADJUSTMENT_ENABLED",
      defaultEnabled: false,
    },
    backendOperation: {
      kind: "http",
      operationId: "proposals.inventoryAdjust",
      method: "POST",
      path: "/api/v1/assistant/propose_inventory_adjustment",
    },
  },

  {
    name: "propose_fulfillment_transition",
    title: "Propose a ShopSphere fulfillment step",
    description:
      "Records one pending forward-only fulfillment proposal for one of the seller's own sale lines (Confirmed to Processing, Processing to Shipped, Shipped to Delivered) to review and confirm in ShopSphere. It derives the current status server-side, never advances the order itself, and never touches payment, stock, or any buyer notification.",
    inputSchema: ProposeFulfillmentTransitionInputSchema,
    outputSchema: ProposeFulfillmentTransitionOutputSchema,
    operationClass: "propose",
    roles: ["seller"],
    scopes: ["fulfillment:propose"],
    rateClass: "proposal",
    rollout: {
      flag: "MCP_TOOL_PROPOSE_FULFILLMENT_TRANSITION_ENABLED",
      defaultEnabled: false,
    },
    backendOperation: {
      kind: "http",
      operationId: "proposals.fulfillmentTransition",
      method: "POST",
      path: "/api/v1/assistant/propose_fulfillment_transition",
    },
  },

  {
    name: "list_order_exception_queue",
    title: "List ShopSphere order exceptions",
    description:
      "Lists one bounded page of orders in the fixed support exception queue: return and refund exception states or failed refunds within the last 90 days.",
    inputSchema: AdminQueuePageInputSchema,
    outputSchema: ListOrderExceptionQueueOutputSchema,
    operationClass: "read",
    roles: ["admin"],
    scopes: ["support:read"],
    rateClass: "authenticated-read",
    rollout: {
      flag: "MCP_TOOL_LIST_ORDER_EXCEPTION_QUEUE_ENABLED",
      defaultEnabled: false,
    },
    backendOperation: {
      kind: "http",
      operationId: "support.orderExceptionQueue",
      method: "POST",
      path: "/api/v1/assistant/list_order_exception_queue",
    },
  },

  {
    name: "get_order_exception_detail",
    title: "Get ShopSphere order exception detail",
    description:
      "Inspects one minimized queued order for a stated support purpose; foreign, non-queued, and unknown ids are indistinguishable.",
    inputSchema: GetOrderExceptionDetailInputSchema,
    outputSchema: GetOrderExceptionDetailOutputSchema,
    operationClass: "read",
    roles: ["admin"],
    scopes: ["support:read"],
    rateClass: "authenticated-read",
    rollout: {
      flag: "MCP_TOOL_GET_ORDER_EXCEPTION_DETAIL_ENABLED",
      defaultEnabled: false,
    },
    backendOperation: {
      kind: "http",
      operationId: "support.orderExceptionDetail",
      method: "POST",
      path: "/api/v1/assistant/get_order_exception_detail",
    },
  },

  {
    name: "list_return_queue",
    title: "List ShopSphere returns",
    description:
      "Lists one bounded page of orders with a requested return still inside the return lifecycle, newest first, within the last 90 days.",
    inputSchema: AdminQueuePageInputSchema,
    outputSchema: ListReturnQueueOutputSchema,
    operationClass: "read",
    roles: ["admin"],
    scopes: ["support:read"],
    rateClass: "authenticated-read",
    rollout: {
      flag: "MCP_TOOL_LIST_RETURN_QUEUE_ENABLED",
      defaultEnabled: false,
    },
    backendOperation: {
      kind: "http",
      operationId: "support.returnQueue",
      method: "POST",
      path: "/api/v1/assistant/list_return_queue",
    },
  },

  {
    name: "draft_support_message",
    title: "Draft my ShopSphere support message",
    description:
      "Composes a bounded support-inquiry draft for one of the buyer's own orders from approved ShopSphere policy sources. It only drafts text: it never sends messages, creates tickets, or triggers notifications.",
    inputSchema: DraftSupportMessageInputSchema,
    outputSchema: DraftSupportMessageOutputSchema,
    operationClass: "draft",
    roles: ["user"],
    scopes: ["support:draft"],
    rateClass: "draft",
    rollout: {
      flag: "MCP_TOOL_DRAFT_SUPPORT_MESSAGE_ENABLED",
      defaultEnabled: false,
    },
    backendOperation: {
      kind: "http",
      operationId: "support.draftMessage",
      method: "POST",
      path: "/api/v1/assistant/draft_support_message",
    },
  },

  {
    name: "list_promotion_configuration",
    title: "List ShopSphere promotion configuration",
    description:
      "Lists one bounded page of promotion configurations with allowlisted rule fields and usage counters; never per-user redemption history.",
    inputSchema: ListPromotionConfigurationInputSchema,
    outputSchema: ListPromotionConfigurationOutputSchema,
    operationClass: "read",
    roles: ["admin"],
    scopes: ["promotions:read"],
    rateClass: "authenticated-read",
    rollout: {
      flag: "MCP_TOOL_LIST_PROMOTION_CONFIGURATION_ENABLED",
      defaultEnabled: false,
    },
    backendOperation: {
      kind: "http",
      operationId: "promotions.listConfiguration",
      method: "POST",
      path: "/api/v1/assistant/list_promotion_configuration",
    },
  },

  {
    name: "get_promotion_usage_summary",
    title: "Get ShopSphere promotion usage summary",
    description:
      "Reads aggregate redemption counters and the validity window for one promotion; per-user redemption history is never exposed.",
    inputSchema: PromoCodeIdInputSchema,
    outputSchema: GetPromotionUsageSummaryOutputSchema,
    operationClass: "read",
    roles: ["admin"],
    scopes: ["promotions:read"],
    rateClass: "authenticated-read",
    rollout: {
      flag: "MCP_TOOL_GET_PROMOTION_USAGE_SUMMARY_ENABLED",
      defaultEnabled: false,
    },
    backendOperation: {
      kind: "http",
      operationId: "promotions.usageSummary",
      method: "POST",
      path: "/api/v1/assistant/get_promotion_usage_summary",
    },
  },

  {
    name: "draft_seller_review_recommendation",
    title: "Draft a ShopSphere seller review recommendation",
    description:
      "Composes a bounded seller-application review recommendation from the minimized application view and approved policy sources. It only drafts text for human reviewers: it never approves or rejects sellers and never notifies anyone.",
    inputSchema: DraftSellerReviewRecommendationInputSchema,
    outputSchema: RecommendationDraftOutputSchema,
    operationClass: "draft",
    roles: ["admin"],
    scopes: ["recommendations:draft"],
    rateClass: "draft",
    rollout: {
      flag: "MCP_TOOL_DRAFT_SELLER_REVIEW_RECOMMENDATION_ENABLED",
      defaultEnabled: false,
    },
    backendOperation: {
      kind: "http",
      operationId: "recommendations.sellerReview",
      method: "POST",
      path: "/api/v1/assistant/draft_seller_review_recommendation",
    },
  },

  {
    name: "draft_return_review_recommendation",
    title: "Draft a ShopSphere return review recommendation",
    description:
      "Composes a bounded return review recommendation from the minimized return-queue facts and the approved returns policy, for a stated audit purpose. It only drafts text for human reviewers: it never approves or rejects returns, releases refunds, or notifies anyone.",
    inputSchema: DraftReturnReviewRecommendationInputSchema,
    outputSchema: RecommendationDraftOutputSchema,
    operationClass: "draft",
    roles: ["admin"],
    scopes: ["recommendations:draft"],
    rateClass: "draft",
    rollout: {
      flag: "MCP_TOOL_DRAFT_RETURN_REVIEW_RECOMMENDATION_ENABLED",
      defaultEnabled: false,
    },
    backendOperation: {
      kind: "http",
      operationId: "recommendations.returnReview",
      method: "POST",
      path: "/api/v1/assistant/draft_return_review_recommendation",
    },
  },

  {
    name: "draft_promotion_recommendation",
    title: "Draft a ShopSphere promotion recommendation",
    description:
      "Composes a bounded promotion recommendation from the allowlisted configuration and aggregate usage counters. It only drafts text for human reviewers: it never activates or deactivates promotions, resets usage, or notifies anyone.",
    inputSchema: DraftPromotionRecommendationInputSchema,
    outputSchema: RecommendationDraftOutputSchema,
    operationClass: "draft",
    roles: ["admin"],
    scopes: ["recommendations:draft"],
    rateClass: "draft",
    rollout: {
      flag: "MCP_TOOL_DRAFT_PROMOTION_RECOMMENDATION_ENABLED",
      defaultEnabled: false,
    },
    backendOperation: {
      kind: "http",
      operationId: "recommendations.promotionReview",
      method: "POST",
      path: "/api/v1/assistant/draft_promotion_recommendation",
    },
  },

  {
    name: "propose_listing_publish",
    title: "Propose publishing my ShopSphere listing draft",
    description:
      "Records one pending proposal to publish one owned, unpublished listing draft as a live product. It never publishes, mutates the draft or catalog, broadcasts, or notifies; the seller reviews and confirms in ShopSphere.",
    inputSchema: ProposeListingPublishInputSchema,
    outputSchema: ProposeListingPublishOutputSchema,
    operationClass: "propose",
    roles: ["seller"],
    scopes: ["listings:propose"],
    rateClass: "proposal",
    rollout: {
      flag: "MCP_TOOL_PROPOSE_LISTING_PUBLISH_ENABLED",
      defaultEnabled: false,
    },
    backendOperation: {
      kind: "http",
      operationId: "proposals.listingPublish",
      method: "POST",
      path: "/api/v1/assistant/propose_listing_publish",
    },
  },

  {
    name: "propose_listing_content_change",
    title: "Propose a ShopSphere listing content change",
    description:
      "Records one pending proposal to change allowlisted content (name, description, images) on one owned live listing. Price, stock, seller identity, visibility, and deletion are not part of the contract; nothing changes until the seller confirms in ShopSphere.",
    inputSchema: ProposeListingContentChangeInputSchema,
    outputSchema: ProposeListingContentChangeOutputSchema,
    operationClass: "propose",
    roles: ["seller"],
    scopes: ["listings:propose"],
    rateClass: "proposal",
    rollout: {
      flag: "MCP_TOOL_PROPOSE_LISTING_CONTENT_CHANGE_ENABLED",
      defaultEnabled: false,
    },
    backendOperation: {
      kind: "http",
      operationId: "proposals.listingContentChange",
      method: "POST",
      path: "/api/v1/assistant/propose_listing_content_change",
    },
  },
];

const freezeDefinition = (definition) =>
  Object.freeze({
    ...definition,
    roles: Object.freeze([...definition.roles]),
    scopes: Object.freeze([...definition.scopes]),
    rollout: Object.freeze({ ...definition.rollout }),
    backendOperation: Object.freeze({ ...definition.backendOperation }),
  });

export const toolRegistry = Object.freeze(definitions.map(freezeDefinition));

export const isToolEnabled = (definition, flags = {}) =>
  flags[definition.rollout.flag] ?? definition.rollout.defaultEnabled;

export const isToolAvailable = (definition, flags = {}, auth) => {
  if (!isToolEnabled(definition, flags)) return false;
  if (definition.roles.includes("public")) return true;
  return Boolean(
    auth
    && definition.roles.includes(auth.role)
    && definition.scopes.every((scope) => auth.scopes?.includes(scope)),
  );
};

export const describeCapabilities = ({
  flags = {},
  maxRequestBytes = DEFAULT_MAX_REQUEST_BYTES,
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
  auth,
} = {}) => ({
  registryVersion: REGISTRY_VERSION,
  protocolVersion: PROTOCOL_VERSION,
  tools: toolRegistry.filter((tool) => isToolAvailable(tool, flags, auth)).map((tool) => ({
    name: tool.name,
    description: tool.description,
    operationClass: tool.operationClass,
    roles: [...tool.roles],
    scopes: [...tool.scopes],
    rateClass: tool.rateClass,
    rollout: {
      flag: tool.rollout.flag,
      enabled: true,
    },
    backendOperation: { ...tool.backendOperation },
  })),
  limits: { maxRequestBytes, maxResponseBytes },
});
