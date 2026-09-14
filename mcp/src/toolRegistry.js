import { z } from "zod";

import { POLICY_TOPICS, POLICY_VERSION } from "./policyContent.js";

export const PROTOCOL_VERSION = "2025-11-25";
export const REGISTRY_VERSION = "1.0.0";
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
    sourceId: z.string().min(1).max(100),
    sourceVersion: z.literal(POLICY_VERSION),
    registryVersion: z.literal(REGISTRY_VERSION),
  })
  .strict();

// Minimized public storefront projection: availability label only — no
// sellerId, no exact stock counts, no seller-private metadata.
const PublicProductSchema = z
  .object({
    id: z.string().min(1).max(100),
    name: z.string().min(1).max(200),
    price: z.number().nonnegative(),
    images: z.array(z.string().max(500)).max(20),
    category: z.string().min(1).max(100),
    availability: z.enum(["In stock", "Sold out"]),
  })
  .strict();

const SearchProductsInputSchema = z
  .object({
    q: z.string().min(1).max(200).optional(),
    category: z.string().min(1).max(100).optional(),
    minPrice: z.number().nonnegative().max(1_000_000_000).optional(),
    maxPrice: z.number().nonnegative().max(1_000_000_000).optional(),
    sort: z.enum(["price-asc", "price-desc", "name-asc", "name-desc"]).optional(),
    page: z.number().int().min(1).max(1000).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

const SearchProductsOutputSchema = z
  .object({
    items: z.array(PublicProductSchema).max(50),
    total: z.number().int().nonnegative(),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(50),
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

const definitions = [
  {
    name: "get_capabilities",
    title: "Get ShopSphere capabilities",
    description: "Lists the currently enabled public ShopSphere MCP capabilities and their policy metadata.",
    inputSchema: z.object({}).strict(),
    outputSchema: CapabilitiesOutputSchema,
    operationClass: "read",
    roles: ["public"],
    scopes: [],
    rateClass: "discovery",
    rollout: {
      flag: "MCP_TOOL_GET_CAPABILITIES_ENABLED",
      defaultEnabled: true,
    },
    backendOperation: {
      kind: "local",
      operationId: "registry.getCapabilities",
      method: null,
      path: null,
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
      defaultEnabled: true,
    },
    backendOperation: {
      kind: "local",
      operationId: "registry.getStorePolicy",
      method: null,
      path: null,
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
      defaultEnabled: true,
    },
    backendOperation: {
      kind: "local",
      operationId: "catalog.searchProducts",
      method: null,
      path: null,
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
      defaultEnabled: true,
    },
    backendOperation: {
      kind: "local",
      operationId: "catalog.compareProducts",
      method: null,
      path: null,
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

export const describeCapabilities = ({
  flags = {},
  maxRequestBytes = DEFAULT_MAX_REQUEST_BYTES,
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
} = {}) => ({
  registryVersion: REGISTRY_VERSION,
  protocolVersion: PROTOCOL_VERSION,
  tools: toolRegistry.filter((tool) => isToolEnabled(tool, flags)).map((tool) => ({
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
