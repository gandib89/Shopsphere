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

export const createCursorCodec = ({ operation, confidential = false }) => {
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
    try {
      let plaintext;
      if (confidential) {
        const parts = cursor.split(".");
        const [format, encoded] = parts;
        if (parts.length !== 2 || format !== "c1" || !encoded) throw notFound();
        const packed = Buffer.from(encoded, "base64url");
        if (packed.length <= 28 || packed.toString("base64url") !== encoded) throw notFound();
        const key = crypto.createHash("sha256").update(secret).digest();
        const decipher = crypto.createDecipheriv("aes-256-gcm", key, packed.subarray(0, 12));
        decipher.setAAD(Buffer.from(operation));
        decipher.setAuthTag(packed.subarray(12, 28));
        plaintext = Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString("utf8");
      } else {
        const [encoded, signature, extra] = cursor.split(".");
        if (!encoded || !signature || extra) throw notFound();
        const expected = crypto.createHmac("sha256", secret).update(encoded).digest();
        const actual = Buffer.from(signature, "base64url");
        if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw notFound();
        plaintext = Buffer.from(encoded, "base64url").toString("utf8");
      }
      const payload = JSON.parse(plaintext);
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
    const plaintext = JSON.stringify({
      version: CURSOR_VERSION,
      principal: fingerprint(principal, query),
      createdAt: row.createdAt.toISOString(),
      id: row.id,
      state,
    });
    if (confidential) {
      // Account identifiers are not approved application fields. Signing alone
      // leaves cursor positions readable; GCM authenticates and conceals them.
      const key = crypto.createHash("sha256").update(secret).digest();
      const nonce = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(Buffer.from(operation));
      const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      return `c1.${Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString("base64url")}`;
    }
    const encoded = Buffer.from(plaintext).toString("base64url");
    return `${encoded}.${crypto.createHmac("sha256", secret).update(encoded).digest("base64url")}`;
  };

  return { decode, encode };
};
