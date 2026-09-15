import { z } from "zod";

export const PROTOCOL_VERSION = "2025-11-25";
export const REGISTRY_VERSION = "1.2.0";
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
