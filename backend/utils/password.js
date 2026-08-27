import { hash, verify } from "@node-rs/argon2";
import bcrypt from "bcryptjs";

// memoryCost/timeCost/parallelism match @node-rs/argon2's own defaults; pinned
// explicitly so a future library upgrade can't silently change the work factor.
const ARGON2_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (password) => hash(password, ARGON2_OPTIONS);

// Existing users still carry bcrypt hashes from before this system; only new
// hashes are argon2id, so `verifyPassword` speaks both. Callers should rehash
// with hashPassword() once a legacy hash verifies (see isLegacyHash).
export const isLegacyHash = (passwordHash) => !passwordHash?.startsWith("$argon2");

export const verifyPassword = (passwordHash, password) => {
  if (!passwordHash) return Promise.resolve(false);
  return isLegacyHash(passwordHash)
    ? bcrypt.compare(password, passwordHash)
    : verify(passwordHash, password);
};
