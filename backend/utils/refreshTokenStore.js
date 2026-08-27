import { prisma } from "../database/prismaClient.js";
import { generateId } from "./generateId.js";
import { generateRefreshToken, hashRefreshToken, REFRESH_TOKEN_TTL_MS } from "./tokens.js";

export class RefreshTokenError extends Error {
  constructor(message) {
    super(message);
    this.code = "invalid_refresh_token";
  }
}

const createInFamily = async (client, userId, familyId) => {
  const raw = generateRefreshToken();
  await client.refreshToken.create({
    data: {
      id: generateId(),
      userId,
      familyId,
      tokenHash: hashRefreshToken(raw),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  });
  return raw;
};

// Starts a fresh rotation family for a new login/register — not a rotation of
// an existing token, so it never touches another family's rows.
export const issueRefreshFamily = (userId, client = prisma) =>
  createInFamily(client, userId, generateId());

const revokeFamily = (client, familyId) =>
  client.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

export const rotateRefreshToken = async (rawToken, client = prisma) => {
  const tokenHash = hashRefreshToken(rawToken);
  const record = await client.refreshToken.findUnique({ where: { tokenHash } });

  if (!record || record.revokedAt || record.expiresAt < new Date()) {
    throw new RefreshTokenError("Refresh token invalid or expired");
  }

  if (record.usedAt) {
    // Same raw token presented twice: it was already rotated once, so this is
    // either a replay or the token was stolen. Kill the whole family.
    await revokeFamily(client, record.familyId);
    throw new RefreshTokenError("Refresh token reuse detected");
  }

  await client.refreshToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
  const refreshToken = await createInFamily(client, record.userId, record.familyId);
  return { userId: record.userId, refreshToken };
};

export const revokeFamilyByToken = async (rawToken, client = prisma) => {
  const record = await client.refreshToken.findUnique({
    where: { tokenHash: hashRefreshToken(rawToken) },
  });
  if (record) await revokeFamily(client, record.familyId);
};
