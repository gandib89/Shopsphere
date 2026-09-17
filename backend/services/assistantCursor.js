// Shared opaque cursor codec for assistant list operations.
// Cursors bind subject, role, client, grant, operation, sort, query filters,
// and policy version into an HMAC fingerprint: a cursor minted for one
// principal, operation, or query never validates anywhere else. Forgery and
// cross-principal replay return generic not-found; a missing signing secret
// fails closed. Reads only — no database access.
import crypto from "node:crypto";

import { ASSISTANT_POLICY_VERSION } from "./assistantPublicCatalog.js";

const CURSOR_VERSION = 1;
const SORT = "createdAt-desc,id-desc";

const notFound = () => Object.assign(new Error("Resource not found"), { statusCode: 404, code: "not_found" });

export const createCursorCodec = ({ operation }) => {
  const fingerprint = (principal, query) => crypto.createHash("sha256").update(JSON.stringify({
    subject: principal.subject,
    role: principal.role,
    clientId: principal.clientId,
    grantId: principal.grantId,
    operation,
    sort: SORT,
    policyVersion: ASSISTANT_POLICY_VERSION,
    query,
  })).digest("base64url");

  const decode = (cursor, principal, query, secret) => {
    if (!cursor) return null;
    if (!secret || secret.length < 32) throw Object.assign(new Error("Cursor service unavailable"), { statusCode: 503 });
    const [encoded, signature, extra] = cursor.split(".");
    if (!encoded || !signature || extra) throw notFound();
    const expected = crypto.createHmac("sha256", secret).update(encoded).digest();
    const actual = Buffer.from(signature, "base64url");
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw notFound();
    try {
      const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
      if (
        payload.version !== CURSOR_VERSION
        || payload.principal !== fingerprint(principal, query)
        || typeof payload.createdAt !== "string"
        || typeof payload.id !== "string"
      ) throw notFound();
      return payload;
    } catch (error) {
      if (error?.statusCode) throw error;
      throw notFound();
    }
  };

  const encode = (row, principal, query, secret, state = null) => {
    if (!secret || secret.length < 32) throw Object.assign(new Error("Cursor service unavailable"), { statusCode: 503 });
    const encoded = Buffer.from(JSON.stringify({
      version: CURSOR_VERSION,
      principal: fingerprint(principal, query),
      createdAt: row.createdAt.toISOString(),
      id: row.id,
      state,
    })).toString("base64url");
    return `${encoded}.${crypto.createHmac("sha256", secret).update(encoded).digest("base64url")}`;
  };

  return { decode, encode };
};
