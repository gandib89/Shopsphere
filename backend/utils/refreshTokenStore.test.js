import assert from "node:assert/strict";
import test from "node:test";

import { issueRefreshFamily, rotateRefreshToken, revokeFamilyByToken, RefreshTokenError } from "./refreshTokenStore.js";
import { hashRefreshToken } from "./tokens.js";

const createFakePrisma = () => {
  const rows = new Map();
  let seq = 0;
  return {
    rows,
    refreshToken: {
      create: async ({ data }) => {
        rows.set(data.id, { usedAt: null, revokedAt: null, ...data });
        return rows.get(data.id);
      },
      findUnique: async ({ where: { tokenHash } }) => {
        for (const row of rows.values()) if (row.tokenHash === tokenHash) return { ...row };
        return null;
      },
      update: async ({ where: { id }, data }) => {
        const row = rows.get(id);
        Object.assign(row, data);
        return { ...row };
      },
      updateMany: async ({ where: { familyId, revokedAt }, data }) => {
        let count = 0;
        for (const row of rows.values()) {
          if (row.familyId === familyId && row.revokedAt === revokedAt) {
            Object.assign(row, data);
            count += 1;
          }
        }
        return { count };
      },
    },
  };
};

test("rotating a valid token marks it used and issues a new one in the same family", async () => {
  const prisma = createFakePrisma();
  const raw1 = await issueRefreshFamily("user-1", prisma);

  const { userId, refreshToken: raw2 } = await rotateRefreshToken(raw1, prisma);

  assert.equal(userId, "user-1");
  assert.notEqual(raw2, raw1);

  const used = [...prisma.rows.values()].find((r) => r.tokenHash === hashRefreshToken(raw1));
  const fresh = [...prisma.rows.values()].find((r) => r.tokenHash === hashRefreshToken(raw2));
  assert.ok(used.usedAt);
  assert.equal(fresh.familyId, used.familyId);
  assert.equal(fresh.usedAt, null);
});

test("reusing an already-rotated token revokes the entire family", async () => {
  const prisma = createFakePrisma();
  const raw1 = await issueRefreshFamily("user-1", prisma);
  const { refreshToken: raw2 } = await rotateRefreshToken(raw1, prisma);

  await assert.rejects(rotateRefreshToken(raw1, prisma), RefreshTokenError);

  for (const row of prisma.rows.values()) assert.ok(row.revokedAt, `row ${row.id} should be revoked`);

  // The legitimately-rotated successor is also dead now — reuse poisons the whole family.
  await assert.rejects(rotateRefreshToken(raw2, prisma), RefreshTokenError);
});

test("rotating an unknown token is rejected", async () => {
  const prisma = createFakePrisma();
  await assert.rejects(rotateRefreshToken("not-a-real-token", prisma), RefreshTokenError);
});

test("rotating an expired token is rejected", async () => {
  const prisma = createFakePrisma();
  const raw = await issueRefreshFamily("user-1", prisma);
  for (const row of prisma.rows.values()) row.expiresAt = new Date(Date.now() - 1000);

  await assert.rejects(rotateRefreshToken(raw, prisma), RefreshTokenError);
});

test("logout revokes the family without needing rotation", async () => {
  const prisma = createFakePrisma();
  const raw = await issueRefreshFamily("user-1", prisma);

  await revokeFamilyByToken(raw, prisma);

  await assert.rejects(rotateRefreshToken(raw, prisma), RefreshTokenError);
});
