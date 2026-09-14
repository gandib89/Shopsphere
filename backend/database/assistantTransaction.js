import { Prisma } from "../generated/prisma/index.js";

import { assistantPrisma } from "./assistantPrisma.js";

const roles = new Set(["user", "seller", "admin"]);
const actorPattern = /^[a-f0-9]{24}$/;
const operationPattern = /^[a-z][a-z0-9_.]{0,99}$/;

const abortError = () => Object.assign(new Error("Assistant operation cancelled"), { name: "AbortError" });

export const withAssistantActor = async (
  { actorId, role, operation, timeoutMs = 5_000, signal } = {},
  run,
  client = assistantPrisma,
) => {
  if (!actorPattern.test(actorId ?? "") || !roles.has(role) || !operationPattern.test(operation ?? "")) {
    throw new Error("Invalid assistant actor context");
  }
  if (typeof run !== "function") throw new Error("Assistant transaction callback is required");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
    throw new Error("Invalid assistant transaction timeout");
  }
  if (signal?.aborted) throw abortError();

  return client.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SELECT set_config('shopsphere.actor_id', ${actorId}, true)`);
    await tx.$executeRaw(Prisma.sql`SELECT set_config('shopsphere.actor_role', ${role}, true)`);
    await tx.$executeRaw(Prisma.sql`SELECT set_config('shopsphere.operation', ${operation}, true)`);
    await tx.$executeRaw(Prisma.sql`SELECT set_config('statement_timeout', ${String(timeoutMs)}, true)`);
    if (signal?.aborted) throw abortError();
    const result = await run(tx);
    if (signal?.aborted) throw abortError();
    return result;
  }, { timeout: timeoutMs, maxWait: timeoutMs });
};
