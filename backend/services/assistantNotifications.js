import crypto from "node:crypto";

import { ASSISTANT_POLICY_VERSION } from "./assistantPublicCatalog.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const CURSOR_VERSION = 1;

const fingerprint = (principal) => crypto.createHash("sha256").update(JSON.stringify({
  subject: principal.subject,
  role: principal.role,
  clientId: principal.clientId,
  grantId: principal.grantId,
  operation: "notifications.listMine",
  sort: "createdAt-desc,id-desc",
  policyVersion: ASSISTANT_POLICY_VERSION,
})).digest("base64url");

const invalidCursor = () => Object.assign(new Error("Resource not found"), { statusCode: 404, code: "not_found" });

const decodeCursor = (cursor, principal, secret) => {
  if (!cursor) return null;
  if (!secret || secret.length < 32) throw Object.assign(new Error("Cursor service unavailable"), { statusCode: 503 });
  const [encoded, signature, extra] = cursor.split(".");
  if (!encoded || !signature || extra) throw invalidCursor();
  const expected = crypto.createHmac("sha256", secret).update(encoded).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw invalidCursor();
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (
      payload.version !== CURSOR_VERSION
      || payload.principal !== fingerprint(principal)
      || typeof payload.createdAt !== "string"
      || typeof payload.id !== "string"
    ) throw invalidCursor();
    return payload;
  } catch (error) {
    if (error?.statusCode) throw error;
    throw invalidCursor();
  }
};

const encodeCursor = (row, principal, secret) => {
  if (!secret || secret.length < 32) throw Object.assign(new Error("Cursor service unavailable"), { statusCode: 503 });
  const encoded = Buffer.from(JSON.stringify({
    version: CURSOR_VERSION,
    principal: fingerprint(principal),
    createdAt: row.createdAt.toISOString(),
    id: row.id,
  })).toString("base64url");
  return `${encoded}.${crypto.createHmac("sha256", secret).update(encoded).digest("base64url")}`;
};

const projection = {
  id: true,
  type: true,
  title: true,
  message: true,
  read: true,
  productId: true,
  productName: true,
  createdAt: true,
};

export const listMyNotifications = async (
  { cursor, limit = DEFAULT_LIMIT },
  { client, principal, cursorSecret },
) => {
  const boundedLimit = Math.min(limit, MAX_LIMIT);
  const position = decodeCursor(cursor, principal, cursorSecret);
  const rows = await client.notification.findMany({
    where: {
      userId: principal.subject,
      ...(position ? {
        OR: [
          { createdAt: { lt: new Date(position.createdAt) } },
          { createdAt: new Date(position.createdAt), id: { lt: position.id } },
        ],
      } : {}),
    },
    select: projection,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: boundedLimit + 1,
  });
  const page = rows.slice(0, boundedLimit);
  return {
    notifications: page.map((row) => ({
      id: row.id,
      type: row.type.slice(0, 100),
      title: row.title.slice(0, 200),
      message: row.message.slice(0, 1_000),
      read: row.read,
      productId: row.productId,
      productName: row.productName?.slice(0, 200) ?? null,
      createdAt: row.createdAt.toISOString(),
    })),
    nextCursor: rows.length > boundedLimit ? encodeCursor(page.at(-1), principal, cursorSecret) : null,
  };
};
