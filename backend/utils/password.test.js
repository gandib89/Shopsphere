import assert from "node:assert/strict";
import test from "node:test";
import bcrypt from "bcryptjs";

import { hashPassword, verifyPassword, isLegacyHash } from "./password.js";

test("argon2id hash round-trips and rejects the wrong password", async () => {
  const hash = await hashPassword("Qwerty@9876");
  assert.equal(await verifyPassword(hash, "Qwerty@9876"), true);
  assert.equal(await verifyPassword(hash, "wrong-password"), false);
  assert.equal(isLegacyHash(hash), false);
});

test("legacy bcrypt hashes still verify (pre-migration users)", async () => {
  const legacyHash = await bcrypt.hash("OldPassword1", 12);
  assert.equal(isLegacyHash(legacyHash), true);
  assert.equal(await verifyPassword(legacyHash, "OldPassword1"), true);
  assert.equal(await verifyPassword(legacyHash, "wrong"), false);
});
