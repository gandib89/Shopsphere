import crypto from "crypto";
import { prisma } from "../database/prismaClient.js";

const PRUNE_AFTER_MS = 24 * 60 * 60 * 1000;

export const hashPayload = (payload) =>
  crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");

// Runs `fn` exactly once per Idempotency-Key. Concurrent requests with the same key race on
// the idempotency_keys unique constraint: Postgres blocks the second INSERT until the first
// transaction commits, then rejects it with 23505 (Prisma P2002) — that block *is* the row
// lock the spec asks for, no manual SELECT ... FOR UPDATE needed.
export const withIdempotency = async (key, requestPayload, fn) => {
  // ponytail: inline prune instead of a cron job — cheap (indexed column), runs on the hot path.
  await prisma.idempotencyKey.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - PRUNE_AFTER_MS) } },
  });

  const requestHash = hashPayload(requestPayload);

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.idempotencyKey.create({ data: { key, requestHash, status: "processing" } });
      const result = await fn(tx);
      await tx.idempotencyKey.update({
        where: { key },
        data: { status: "completed", statusCode: result.statusCode, response: result.body },
      });
      return { replayed: false, ...result };
    });
  } catch (err) {
    if (err.code !== "P2002") throw err;

    const existing = await prisma.idempotencyKey.findUnique({ where: { key } });
    if (!existing) throw err;

    if (existing.requestHash !== requestHash) {
      const conflict = new Error("Idempotency-Key was already used with a different request payload");
      conflict.statusCode = 422;
      throw conflict;
    }
    if (existing.status === "completed") {
      return { replayed: true, statusCode: existing.statusCode, body: existing.response };
    }
    const pending = new Error("A request with this Idempotency-Key is already being processed");
    pending.statusCode = 409;
    throw pending;
  }
};
