import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import bcrypt from "bcryptjs";

import { ensureDemoData } from "./seedDemoData.js";

process.env.DEMO_PASSWORD ||= "TestDemoPassword@123";

const expectedAccounts = [
  ["seller1@shopsphere", "seller"],
  ["seller2@shopsphere", "seller"],
  ["custumer1@shopsphere", "user"],
  ["custumer2@shopsphere", "user"],
];

const createMemoryPrisma = ({ initialUsers = [], initialProducts = [] } = {}) => {
  const users = new Map(initialUsers.map((user) => [user.email, { ...user }]));
  const products = new Map(initialProducts.map((product) => [product.id, { ...product }]));

  const database = {
    users,
    products,
    user: {
      findUnique: async ({ where }) => users.get(where.email) ?? null,
      create: async ({ data }) => {
        users.set(data.email, { ...data });
        return users.get(data.email);
      },
    },
    product: {
      findUnique: async ({ where }) => products.get(where.id) ?? null,
      create: async ({ data }) => {
        products.set(data.id, { ...data });
        return products.get(data.id);
      },
    },
  };

  database.$transaction = async (operation) => operation(database);
  return database;
};

test("creates usable demo accounts and pictured products only once", async () => {
  const prisma = createMemoryPrisma();

  const firstResult = await ensureDemoData(prisma);
  const secondResult = await ensureDemoData(prisma);

  assert.deepEqual(firstResult, {
    usersCreated: 4,
    usersExisting: 0,
    productsCreated: 12,
    productsExisting: 0,
  });
  assert.deepEqual(secondResult, {
    usersCreated: 0,
    usersExisting: 4,
    productsCreated: 0,
    productsExisting: 12,
  });
  assert.equal(prisma.users.size, 4);
  assert.equal(prisma.products.size, 12);

  for (const [email, role] of expectedAccounts) {
    const account = prisma.users.get(email);
    assert.ok(account, `${email} should be seeded`);
    assert.equal(account.role, role);
    assert.equal(account.isVerified, true);
    assert.equal(await bcrypt.compare(process.env.DEMO_PASSWORD, account.password), true);
  }

  const sellerIds = new Set([
    prisma.users.get("seller1@shopsphere").id,
    prisma.users.get("seller2@shopsphere").id,
  ]);
  const projectRoot = path.resolve(import.meta.dirname, "../..");

  for (const product of prisma.products.values()) {
    assert.ok(sellerIds.has(product.sellerId), `${product.name} should belong to a demo seller`);
    assert.ok(product.images.length > 0, `${product.name} should have at least one image`);

    for (const image of product.images) {
      assert.match(image, /^\/images\//);
      assert.equal(
        existsSync(path.join(projectRoot, "frontend", "public", image)),
        true,
        `${product.name} image should exist: ${image}`,
      );
    }
  }

  assert.ok(
    [...prisma.products.values()].some(
      (product) => /iphone/i.test(product.name) && product.images[0].includes("iphone"),
    ),
    "an iPhone search result should have an iPhone photo",
  );
});

test("preserves an existing seller and assigns products to that seller's actual id", async () => {
  const existingPassword = await bcrypt.hash("ExistingPassword@1", 4);
  const existingSeller = {
    id: "66afffffffffffffffffffff",
    firstName: "Existing",
    lastName: "Seller",
    email: "seller1@shopsphere",
    phone: "+9779811111111",
    password: existingPassword,
    role: "seller",
    shopName: "Existing Shop",
    isVerified: true,
  };
  const prisma = createMemoryPrisma({ initialUsers: [existingSeller] });

  const result = await ensureDemoData(prisma);

  assert.equal(result.usersCreated, 3);
  assert.equal(result.usersExisting, 1);
  assert.deepEqual(prisma.users.get(existingSeller.email), existingSeller);
  assert.equal(
    [...prisma.products.values()]
      .filter((product) => product.name.startsWith("iPhone") || product.name.startsWith("Mac") || product.name === "Apple Magic Keyboard")
      .every((product) => product.sellerId === existingSeller.id),
    true,
  );
});

test("rejects a conflicting account role without modifying it", async () => {
  const conflict = {
    id: "66aeeeeeeeeeeeeeeeeeeeee",
    firstName: "Existing",
    lastName: "Customer",
    email: "seller1@shopsphere",
    password: "untouched",
    role: "user",
    isVerified: true,
  };
  const prisma = createMemoryPrisma({ initialUsers: [conflict] });

  await assert.rejects(
    ensureDemoData(prisma),
    /seller1@shopsphere already exists with role user/,
  );
  assert.deepEqual(prisma.users.get(conflict.email), conflict);
  assert.equal(prisma.products.size, 0);
});

test("performs existence reads through the transaction client", async () => {
  const transactionClient = createMemoryPrisma();
  const prisma = {
    user: {
      findUnique: async () => {
        throw new Error("read happened outside transaction");
      },
    },
    $transaction: async (operation) => operation(transactionClient),
  };

  const result = await ensureDemoData(prisma);

  assert.equal(result.usersCreated, 4);
  assert.equal(transactionClient.products.size, 12);
});

test("retries a serializable transaction conflict", async () => {
  const transactionClient = createMemoryPrisma();
  let attempts = 0;
  const prisma = {
    $transaction: async (operation) => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error("write conflict");
        error.code = "P2034";
        throw error;
      }
      return operation(transactionClient);
    },
  };

  const result = await ensureDemoData(prisma);

  assert.equal(attempts, 2);
  assert.equal(result.productsCreated, 12);
});
