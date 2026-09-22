import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import bcrypt from "bcryptjs";

import {
  demoProducts,
  ensureDemoData,
  getMaximumConfiguredPrice,
  MAX_DEMO_CONFIGURED_PRICE,
} from "./seedDemoData.js";

process.env.DEMO_PASSWORD ||= "TestDemoPassword@123";

const expectedAccounts = [
  ["seller1@shopsphere.test", "seller"],
  ["seller2@shopsphere.test", "seller"],
  ["customer1@shopsphere.test", "user"],
  ["customer2@shopsphere.test", "user"],
  ["customer3@shopsphere.test", "user"],
  ["customer4@shopsphere.test", "user"],
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

test("creates usable demo accounts and products only once", async () => {
  const prisma = createMemoryPrisma();

  const firstResult = await ensureDemoData(prisma);
  const secondResult = await ensureDemoData(prisma);

  assert.deepEqual(firstResult, {
    usersCreated: 6,
    usersExisting: 0,
    productsCreated: demoProducts.length,
    productsExisting: 0,
  });
  assert.deepEqual(secondResult, {
    usersCreated: 0,
    usersExisting: 6,
    productsCreated: 0,
    productsExisting: demoProducts.length,
  });
  assert.equal(prisma.users.size, 6);
  assert.equal(prisma.products.size, demoProducts.length);

  for (const [email, role] of expectedAccounts) {
    const account = prisma.users.get(email);
    assert.ok(account, `${email} should be seeded`);
    assert.equal(account.role, role);
    assert.equal(account.isVerified, true);
    assert.equal(await bcrypt.compare(process.env.DEMO_PASSWORD, account.password), true);
  }

  const sellerIds = new Set([
    prisma.users.get("seller1@shopsphere.test").id,
    prisma.users.get("seller2@shopsphere.test").id,
  ]);
  for (const product of prisma.products.values()) {
    assert.ok(sellerIds.has(product.sellerId), `${product.name} should belong to a demo seller`);
    assert.ok(product.images.length > 0, `${product.name} should have at least one image`);

    for (const image of product.images) {
      assert.match(image, /^\/images\//);
    }
  }

  assert.ok(
    [...prisma.products.values()].some(
      (product) => product.category === "Mobile Phones" && product.images[0].includes("catalog"),
    ),
    "an iPhone search result should have an Apple catalog photo",
  );
});

test("keeps every configuration sandbox-priced and every phone color represented", () => {
  for (const product of demoProducts) {
    assert.ok(
      getMaximumConfiguredPrice(product) <= MAX_DEMO_CONFIGURED_PRICE,
      `${product.name} should stay within the eSewa sandbox ceiling`,
    );

    const picturedColors = new Map(
      product.colorVariants.map((variant) => [variant.color, variant.images]),
    );
    for (const color of product.variantColor) {
      const images = picturedColors.get(color);
      assert.ok(images?.length, `${product.name} ${color} should have an image`);
      for (const image of images) {
        assert.match(image, /^\/images\//);
      }
    }
  }
});

const frontendPublic = path.resolve(import.meta.dirname, "../../frontend/public");
test("every referenced demo product image exists", {
  skip: !existsSync(frontendPublic) && "frontend/public is not included in the backend image",
}, () => {
  for (const product of demoProducts) {
    for (const image of [
      ...product.images,
      ...product.colorVariants.flatMap((variant) => variant.images),
    ]) {
      assert.equal(existsSync(path.join(frontendPublic, image)), true, `${product.name} image should exist: ${image}`);
    }
  }
});

test("seeds only verified Apple product names", () => {
  const unsupportedNames = ["Apple Watch Series 12", "Apple Watch Ultra 4", "AirPods 5"];
  const allowedPrefixes = ["Apple", "AirPods", "iPhone", "MacBook", "Mac mini", "Magic", "MagSafe", "USB-C"];

  assert.equal(demoProducts.length, 35);
  assert.equal(demoProducts.every((product) => (
    allowedPrefixes.some((prefix) => product.name.startsWith(prefix))
  )), true);
  assert.equal(demoProducts.some((product) => unsupportedNames.includes(product.name)), false);
});

test("preserves an existing seller and assigns products to that seller's actual id", async () => {
  const existingPassword = await bcrypt.hash("ExistingPassword@1", 4);
  const existingSeller = {
    id: "66afffffffffffffffffffff",
    firstName: "Existing",
    lastName: "Seller",
    email: "seller1@shopsphere.test",
    phone: "+9779811111111",
    password: existingPassword,
    role: "seller",
    shopName: "Existing Shop",
    isVerified: true,
  };
  const prisma = createMemoryPrisma({ initialUsers: [existingSeller] });

  const result = await ensureDemoData(prisma);

  assert.equal(result.usersCreated, 5);
  assert.equal(result.usersExisting, 1);
  assert.deepEqual(prisma.users.get(existingSeller.email), existingSeller);
  assert.equal(
    [...prisma.products.values()]
      .filter((product) => [
        "66a200000000000000000001",
        "66a200000000000000000003",
        "66a200000000000000000005",
      ].includes(product.id))
      .every((product) => product.sellerId === existingSeller.id),
    true,
  );
});

test("rejects a conflicting account role without modifying it", async () => {
  const conflict = {
    id: "66aeeeeeeeeeeeeeeeeeeeee",
    firstName: "Existing",
    lastName: "Customer",
    email: "seller1@shopsphere.test",
    password: "untouched",
    role: "user",
    isVerified: true,
  };
  const prisma = createMemoryPrisma({ initialUsers: [conflict] });

  await assert.rejects(
    ensureDemoData(prisma),
    /seller1@shopsphere\.test already exists with role user/,
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

  assert.equal(result.usersCreated, 6);
  assert.equal(transactionClient.products.size, demoProducts.length);
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
  assert.equal(result.productsCreated, demoProducts.length);
});
