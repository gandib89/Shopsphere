import assert from "node:assert/strict";
import test from "node:test";
import bcrypt from "bcryptjs";

import { bootstrapAdmin } from "./seedAdmin.js";

const createAdminPrisma = (initialUser = null) => {
  let user = initialUser ? { ...initialUser } : null;
  return {
    get userRecord() {
      return user;
    },
    user: {
      findUnique: async ({ where }) => user?.email === where.email ? user : null,
      create: async ({ data }) => {
        user = { ...data };
        return user;
      },
    },
  };
};

test("skips admin bootstrap when explicit credentials are missing", async () => {
  const prisma = createAdminPrisma();

  const result = await bootstrapAdmin({ client: prisma, email: "", password: "" });

  assert.deepEqual(result, { status: "skipped", reason: "missing-config" });
  assert.equal(prisma.userRecord, null);
});

test("preserves an existing configured admin and its password", async () => {
  const existing = {
    id: "66abbbbbbbbbbbbbbbbbbbb",
    firstName: "Existing",
    lastName: "Admin",
    email: "admin@example.com",
    password: "existing-password-hash",
    role: "admin",
    isVerified: true,
  };
  const prisma = createAdminPrisma(existing);

  const result = await bootstrapAdmin({
    client: prisma,
    email: existing.email,
    password: "NewPublicPassword",
  });

  assert.deepEqual(result, { status: "existing", email: existing.email });
  assert.deepEqual(prisma.userRecord, existing);
});

test("creates a configured admin with a hashed password", async () => {
  const prisma = createAdminPrisma();

  const result = await bootstrapAdmin({
    client: prisma,
    email: "admin@shopsphere",
    password: "Qwerty@9876",
  });

  assert.deepEqual(result, { status: "created", email: "admin@shopsphere" });
  assert.equal(prisma.userRecord.role, "admin");
  assert.equal(prisma.userRecord.isVerified, true);
  assert.equal(await bcrypt.compare("Qwerty@9876", prisma.userRecord.password), true);
});

test("rejects a configured admin email already used by another role", async () => {
  const existing = {
    id: "66acccccccccccccccccccc",
    email: "admin@example.com",
    role: "seller",
  };
  const prisma = createAdminPrisma(existing);

  await assert.rejects(
    bootstrapAdmin({ client: prisma, email: existing.email, password: "secret" }),
    /already belongs to role seller/,
  );
  assert.deepEqual(prisma.userRecord, existing);
});

test("accepts a concurrently created configured admin after a unique conflict", async () => {
  const concurrentAdmin = {
    id: "66addddddddddddddddddddd",
    email: "admin@example.com",
    role: "admin",
    password: "concurrent-password-hash",
    isVerified: true,
  };
  let reads = 0;
  const prisma = {
    user: {
      findUnique: async () => {
        reads += 1;
        return reads === 1 ? null : concurrentAdmin;
      },
      create: async () => {
        const error = new Error("unique constraint");
        error.code = "P2002";
        throw error;
      },
    },
  };

  const result = await bootstrapAdmin({
    client: prisma,
    email: concurrentAdmin.email,
    password: "Qwerty@9876",
  });

  assert.deepEqual(result, { status: "existing", email: concurrentAdmin.email });
  assert.equal(reads, 2);
});
