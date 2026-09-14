import { z } from "zod";

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
