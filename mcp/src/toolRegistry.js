import { z } from "zod";

export const PROTOCOL_VERSION = "2025-11-25";
export const REGISTRY_VERSION = "1.3.0";
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
    productIds: z.array(z.string().min(1).max(100)).min(1).max(5),
  })
  .strict();

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
    productId: z.string().min(1).max(100),
  })
  .strict();

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
    productId: z.string().min(1).max(100),
    cursor: z.string().min(1).max(2048).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

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
    productId: z.string().min(1).max(100),
    limit: z.number().int().min(1).max(20).optional(),
  })
  .strict();

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
