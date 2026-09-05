import bcrypt from "bcryptjs";

export const MAX_DEMO_CONFIGURED_PRICE = 50000;

export const demoUsers = [
  {
    id: "66a100000000000000000001",
    firstName: "Kiran",
    lastName: "Lama",
    email: "seller1@shopsphere.test",
    phone: "+9779801001001",
    role: "seller",
    shopName: "Kathmandu Apple Hub",
    shopDescription: "Apple Mac and iPhone products with sandbox-ready configuration pricing.",
  },
  {
    id: "66a100000000000000000002",
    firstName: "Priya",
    lastName: "Thapa",
    email: "seller2@shopsphere.test",
    phone: "+9779801001002",
    role: "seller",
    shopName: "Himalayan Apple Gear",
    shopDescription: "Apple Watch, AirPods, and Apple-designed accessories for everyday use.",
  },
  {
    id: "66a100000000000000000003",
    firstName: "Rojina",
    lastName: "Maharjan",
    email: "customer1@shopsphere.test",
    phone: "+9779802002001",
    role: "user",
  },
  {
    id: "66a100000000000000000004",
    firstName: "Bibek",
    lastName: "Adhikari",
    email: "customer2@shopsphere.test",
    phone: "+9779802002002",
    role: "user",
  },
  {
    id: "66a100000000000000000005",
    firstName: "Saanvi",
    lastName: "Koirala",
    email: "customer3@shopsphere.test",
    phone: "+9779802002003",
    role: "user",
  },
  {
    id: "66a100000000000000000006",
    firstName: "Nabin",
    lastName: "Tamang",
    email: "customer4@shopsphere.test",
    phone: "+9779802002004",
    role: "user",
  },
];

const SELLER_ONE = "66a100000000000000000001";
const SELLER_TWO = "66a100000000000000000002";
const appleImage = (fileName) => `/images/catalog/apple/${fileName}`;
const priced = (value, priceDelta = 0) => ({ value, priceDelta });
const sharedColors = (values, fileName) => values.map((color) => ({
  color,
  images: [appleImage(fileName)],
}));
const picturedColors = (entries) => entries.map(([color, fileName]) => ({
  color,
  images: [appleImage(fileName)],
}));

const makeDemoProduct = ({
  sequence,
  name,
  price,
  description,
  category,
  sellerId,
  image: mainImage,
  colors = [],
  storage = [],
  screenSizes = [],
  processors = [],
  quantity = 24,
}) => {
  const colorStock = colors.length ? Math.max(1, Math.floor(quantity / colors.length)) : null;
  const storageStock = storage.length ? Math.max(1, Math.floor(quantity / storage.length)) : null;
  const images = colors.length
    ? [...new Set(colors.flatMap((variant) => variant.images))]
    : [appleImage(mainImage)];

  return {
    id: `66a2${String(sequence).padStart(20, "0")}`,
    name,
    price,
    quantity,
    description,
    images,
    category,
    variantStorage: storage.map((option) => option.value),
    variantColor: colors.map((variant) => variant.color),
    variantRam: [],
    variantScreenSize: screenSizes.map((option) => option.value),
    variantProcessor: processors.map((option) => option.value),
    colorVariants: colors.map((variant) => ({ ...variant, stock: colorStock })),
    storageVariants: storage.map((option) => ({ storage: option.value, stock: storageStock })),
    options: [
      ...colors.map((variant) => ({ kind: "color", value: variant.color, priceDelta: 0, stock: colorStock })),
      ...storage.map((option) => ({ kind: "storage", ...option, stock: storageStock })),
      ...screenSizes.map((option) => ({ kind: "screenSize", ...option })),
      ...processors.map((option) => ({ kind: "processor", ...option })),
    ],
    sellerId,
  };
};

const airColors = sharedColors(["Sky Blue", "Midnight", "Starlight", "Silver"], "macbook-air.png");
const proMacColors = sharedColors(["Space Black", "Silver"], "macbook-pro.png");
const neoColors = sharedColors(["Blush", "Citrus", "Indigo", "Silver"], "macbook-neo.png");
const iphone16Colors = (model) => picturedColors([
  ["Ultramarine", `${model}-ultramarine.jpg`],
  ["Teal", `${model}-teal.jpg`],
  ["Pink", `${model}-pink.jpg`],
  ["White", `${model}-white.jpg`],
  ["Black", `${model}-black.jpg`],
]);
const titaniumColors = (model) => picturedColors([
  ["Desert Titanium", `${model}-deserttitanium.jpg`],
  ["Natural Titanium", `${model}-naturaltitanium.jpg`],
  ["White Titanium", `${model}-whitetitanium.jpg`],
  ["Black Titanium", `${model}-blacktitanium.jpg`],
]);

export const demoProducts = [
  makeDemoProduct({ sequence: 1, name: "MacBook Air 13-inch (M5)", price: 33999, description: "Apple's 13-inch MacBook Air with the M5 chip.", category: "Laptops", sellerId: SELLER_ONE, colors: airColors, storage: [priced("512GB"), priced("1TB", 5000), priced("2TB", 9000), priced("4TB", 13000)] }),
  makeDemoProduct({ sequence: 2, name: "MacBook Air 15-inch (M5)", price: 35999, description: "Apple's larger 15-inch MacBook Air with the M5 chip.", category: "Laptops", sellerId: SELLER_TWO, colors: airColors, storage: [priced("512GB"), priced("1TB", 5000), priced("2TB", 9000), priced("4TB", 13000)] }),
  makeDemoProduct({ sequence: 3, name: "MacBook Pro 14-inch", price: 34999, description: "Apple's 14-inch professional notebook, configurable with M5, M5 Pro, or M5 Max.", category: "Laptops", sellerId: SELLER_ONE, colors: proMacColors, storage: [priced("1TB"), priced("2TB", 4000), priced("4TB", 8000)], processors: [priced("M5"), priced("M5 Pro", 3000), priced("M5 Max", 5000)] }),
  makeDemoProduct({ sequence: 4, name: "MacBook Pro 16-inch", price: 36999, description: "Apple's 16-inch professional notebook, configurable with M5 Pro or M5 Max.", category: "Laptops", sellerId: SELLER_TWO, colors: proMacColors, storage: [priced("1TB"), priced("2TB", 4000), priced("4TB", 8000)], processors: [priced("M5 Pro"), priced("M5 Max", 4000)] }),
  makeDemoProduct({ sequence: 5, name: "MacBook Neo", price: 24999, description: "Apple's affordable 13-inch Liquid Retina notebook with the A18 Pro chip.", category: "Laptops", sellerId: SELLER_ONE, colors: neoColors, storage: [priced("256GB"), priced("512GB", 4000)] }),
  makeDemoProduct({ sequence: 6, name: "Mac mini", price: 26999, description: "Apple's compact desktop, configurable with M6 or M5 Pro.", category: "Mac Mini", sellerId: SELLER_TWO, image: "mac-mini.jpg", colors: sharedColors(["Silver"], "mac-mini.jpg"), storage: [priced("256GB"), priced("512GB", 3500), priced("1TB", 7000)], processors: [priced("M6"), priced("M5 Pro", 4000)] }),

  makeDemoProduct({ sequence: 7, name: "iPhone 17", price: 32999, description: "Apple iPhone 17 with a Dual Fusion camera system.", category: "Mobile Phones", sellerId: SELLER_ONE, colors: picturedColors([["Lavender", "iphone-17-lavender.jpg"], ["Sage", "iphone-17-sage.jpg"], ["Mist Blue", "iphone-17-mistblue.jpg"], ["White", "iphone-17-white.jpg"], ["Black", "iphone-17-black.jpg"]]), storage: [priced("256GB"), priced("512GB", 5000)] }),
  makeDemoProduct({ sequence: 8, name: "iPhone 17 Pro Max", price: 39999, description: "Apple iPhone 17 Pro Max with the Pro Fusion camera system.", category: "Mobile Phones", sellerId: SELLER_TWO, colors: picturedColors([["Silver", "iphone-17-pro-max-silver.jpg"], ["Cosmic Orange", "iphone-17-pro-max-cosmicorange.jpg"], ["Deep Blue", "iphone-17-pro-max-deepblue.jpg"]]), storage: [priced("256GB"), priced("512GB", 3000), priced("1TB", 6000), priced("2TB", 9000)] }),
  makeDemoProduct({ sequence: 9, name: "iPhone 16", price: 25999, description: "Apple iPhone 16 with Camera Control and the A18 chip.", category: "Mobile Phones", sellerId: SELLER_ONE, colors: iphone16Colors("iphone-16"), storage: [priced("128GB")] }),
  makeDemoProduct({ sequence: 10, name: "iPhone 16 Plus", price: 28999, description: "Apple iPhone 16 Plus with a larger display and the A18 chip.", category: "Mobile Phones", sellerId: SELLER_TWO, colors: iphone16Colors("iphone-16plus"), storage: [priced("128GB"), priced("256GB", 4000)] }),
  makeDemoProduct({ sequence: 11, name: "iPhone 16 Pro", price: 32999, description: "Apple iPhone 16 Pro in four titanium finishes.", category: "Mobile Phones", sellerId: SELLER_ONE, colors: titaniumColors("iphone-16-pro"), storage: [priced("128GB"), priced("256GB", 4000), priced("512GB", 8000), priced("1TB", 12000)] }),
  makeDemoProduct({ sequence: 12, name: "iPhone 16 Pro Max", price: 34999, description: "Apple iPhone 16 Pro Max in four titanium finishes.", category: "Mobile Phones", sellerId: SELLER_TWO, colors: titaniumColors("iphone-16-pro-max"), storage: [priced("256GB"), priced("512GB", 5000), priced("1TB", 10000)] }),
  makeDemoProduct({ sequence: 13, name: "iPhone 15 Pro Max", price: 31999, description: "Apple iPhone 15 Pro Max with a titanium design.", category: "Mobile Phones", sellerId: SELLER_ONE, colors: picturedColors([["Natural Titanium", "iphone-15-pro-max-naturaltitanium.jpg"], ["Blue Titanium", "iphone-15-pro-max-bluetitanium.jpg"], ["White Titanium", "iphone-15-pro-max-whitetitanium.jpg"], ["Black Titanium", "iphone-15-pro-max-blacktitanium.jpg"]]), storage: [priced("256GB"), priced("512GB", 5000), priced("1TB", 10000)] }),
  makeDemoProduct({ sequence: 14, name: "iPhone 14 Pro Max", price: 27999, description: "Apple iPhone 14 Pro Max with Dynamic Island and a 48MP main camera.", category: "Mobile Phones", sellerId: SELLER_TWO, colors: picturedColors([["Deep Purple", "iphone-14-pro-max-deeppurple.jpg"], ["Gold", "iphone-14-pro-max-gold.jpg"], ["Silver", "iphone-14-pro-max-silver.jpg"], ["Space Black", "iphone-14-pro-max-spaceblack.jpg"]]), storage: [priced("128GB"), priced("256GB", 4000), priced("512GB", 8000), priced("1TB", 12000)] }),

  makeDemoProduct({ sequence: 15, name: "Apple Watch Series 11", price: 21999, description: "Apple Watch Series 11 in Apple's current aluminum and titanium finishes.", category: "Smartwatches", sellerId: SELLER_ONE, colors: sharedColors(["Rose Gold", "Silver", "Space Gray", "Jet Black", "Gold Titanium", "Natural Titanium", "Slate Titanium"], "apple-watch-series-11.png"), screenSizes: [priced("42mm"), priced("46mm", 2000)] }),
  makeDemoProduct({ sequence: 16, name: "Apple Watch Ultra 3", price: 34999, description: "Apple's rugged 49mm titanium watch with satellite connectivity.", category: "Smartwatches", sellerId: SELLER_TWO, colors: sharedColors(["Natural Titanium", "Black Titanium"], "apple-watch-ultra-3.png"), screenSizes: [priced("49mm")] }),
  makeDemoProduct({ sequence: 17, name: "Apple Watch SE 3", price: 16999, description: "Apple's affordable watch in Midnight and Starlight aluminum.", category: "Smartwatches", sellerId: SELLER_ONE, colors: sharedColors(["Midnight", "Starlight"], "apple-watch-se-3.png"), screenSizes: [priced("40mm"), priced("44mm", 1800)] }),

  makeDemoProduct({ sequence: 18, name: "AirPods 4", price: 9999, description: "Apple AirPods 4 with a USB-C charging case.", category: "Accessories", sellerId: SELLER_TWO, image: "airpods-4.png" }),
  makeDemoProduct({ sequence: 19, name: "AirPods 4 with Active Noise Cancellation", price: 12999, description: "Apple AirPods 4 with Active Noise Cancellation and a wireless charging case.", category: "Accessories", sellerId: SELLER_ONE, image: "airpods-4.png" }),
  makeDemoProduct({ sequence: 20, name: "AirPods Pro 3", price: 16999, description: "Apple in-ear headphones with Active Noise Cancellation and the H2 chip.", category: "Accessories", sellerId: SELLER_TWO, image: "airpods-pro-3.png" }),
  makeDemoProduct({ sequence: 21, name: "AirPods Max 2", price: 22999, description: "Apple over-ear headphones with the H2 chip.", category: "Accessories", sellerId: SELLER_ONE, colors: sharedColors(["Midnight", "Starlight", "Blue", "Purple", "Orange"], "airpods-max-2.png") }),

  makeDemoProduct({ sequence: 22, name: "Magic Keyboard with Touch ID", price: 11999, description: "Apple Magic Keyboard with Touch ID and USB-C for Mac models with Apple silicon.", category: "Accessories", sellerId: SELLER_TWO, image: "magic-keyboard-touch-id.jpg" }),
  makeDemoProduct({ sequence: 23, name: "Magic Keyboard for iPad Pro", price: 14999, description: "Apple Magic Keyboard for compatible 11-inch and 13-inch iPad Pro models.", category: "Accessories", sellerId: SELLER_ONE, colors: sharedColors(["White", "Black"], "magic-keyboard-ipad.jpg"), screenSizes: [priced("11-inch"), priced("13-inch", 3000)] }),
  makeDemoProduct({ sequence: 24, name: "Magic Trackpad (USB-C)", price: 10999, description: "Apple rechargeable Multi-Touch trackpad with USB-C.", category: "Accessories", sellerId: SELLER_TWO, colors: sharedColors(["White", "Black"], "magic-trackpad.jpg") }),
  makeDemoProduct({ sequence: 25, name: "Magic Mouse (USB-C)", price: 7999, description: "Apple rechargeable Multi-Touch mouse with USB-C.", category: "Accessories", sellerId: SELLER_ONE, colors: sharedColors(["White", "Black"], "magic-mouse.jpg") }),
  makeDemoProduct({ sequence: 26, name: "MagSafe Charger (1 m)", price: 3999, description: "Apple MagSafe wireless charger with a one-meter cable.", category: "Accessories", sellerId: SELLER_TWO, image: "magsafe-charger.jpg" }),
  makeDemoProduct({ sequence: 27, name: "MagSafe Battery Pack", price: 7999, description: "Apple's legacy white MagSafe Battery Pack for compatible iPhone models.", category: "Accessories", sellerId: SELLER_ONE, image: "magsafe-battery-pack.png" }),
  makeDemoProduct({ sequence: 28, name: "Apple 20W USB-C Power Adapter", price: 2499, description: "Apple 20W USB-C wall power adapter.", category: "Accessories", sellerId: SELLER_TWO, image: "20w-usb-c-power-adapter.jpg" }),
  makeDemoProduct({ sequence: 29, name: "Apple 35W Dual USB-C Port Compact Power Adapter", price: 4999, description: "Apple compact adapter for charging two USB-C devices.", category: "Accessories", sellerId: SELLER_ONE, image: "35w-dual-usb-c-adapter.jpg" }),
  makeDemoProduct({ sequence: 30, name: "Apple 40W Dynamic Power Adapter with 60W Max", price: 4499, description: "Apple dynamic power adapter with up to 60W output.", category: "Accessories", sellerId: SELLER_TWO, image: "40w-dynamic-adapter.jpg" }),
  makeDemoProduct({ sequence: 31, name: "Apple 60W USB-C Charge Cable (1 m)", price: 1999, description: "Apple woven USB-C charge cable, one meter long.", category: "Accessories", sellerId: SELLER_ONE, image: "60w-usb-c-cable-1m.jpg" }),
  makeDemoProduct({ sequence: 32, name: "Apple 240W USB-C Charge Cable (2 m)", price: 2999, description: "Apple woven USB-C charge cable, two meters long.", category: "Accessories", sellerId: SELLER_TWO, image: "240w-usb-c-cable-2m.jpg" }),
  makeDemoProduct({ sequence: 33, name: "USB-C to MagSafe 3 Cable (2 m)", price: 4499, description: "Apple two-meter USB-C to MagSafe 3 charging cable.", category: "Accessories", sellerId: SELLER_ONE, colors: sharedColors(["Sky Blue", "Space Gray", "Midnight", "Starlight", "Space Black", "Silver"], "usb-c-to-magsafe-3.jpg") }),
  makeDemoProduct({ sequence: 34, name: "Magic Keyboard for iPad Air", price: 12999, description: "Apple Magic Keyboard for compatible 11-inch and 13-inch iPad Air models.", category: "Accessories", sellerId: SELLER_TWO, colors: sharedColors(["White", "Black"], "magic-keyboard-ipad-air.jpg"), screenSizes: [priced("11-inch"), priced("13-inch", 3000)] }),
  makeDemoProduct({ sequence: 35, name: "MagSafe Charger (2 m)", price: 4999, description: "Apple MagSafe wireless charger with a two-meter cable.", category: "Accessories", sellerId: SELLER_ONE, image: "magsafe-charger.jpg" }),
];

export const getMaximumConfiguredPrice = (product) => {
  const maximumByKind = new Map();
  for (const option of product.options || []) {
    maximumByKind.set(
      option.kind,
      Math.max(maximumByKind.get(option.kind) || 0, Number(option.priceDelta) || 0),
    );
  }
  return product.price + [...maximumByKind.values()].reduce((total, delta) => total + delta, 0);
};

const validateDemoCatalog = () => {
  for (const product of demoProducts) {
    if (getMaximumConfiguredPrice(product) > MAX_DEMO_CONFIGURED_PRICE) {
      throw new Error(`${product.name} exceeds the NPR ${MAX_DEMO_CONFIGURED_PRICE} demo price ceiling`);
    }

    const colorImages = new Map(product.colorVariants.map((variant) => [variant.color, variant.images]));
    for (const color of product.variantColor) {
      if (!colorImages.get(color)?.length) {
        throw new Error(`${product.name} is missing images for its ${color} color variant`);
      }
    }
  }
};

const createMissingDemoData = async (database, demoPassword) => {
  const existingUsers = await Promise.all(
    demoUsers.map(async (user) => (
      (await database.user.findUnique({ where: { id: user.id } }))
      ?? database.user.findUnique({ where: { email: user.email } })
    )),
  );
  const usersToCreate = demoUsers.filter((_, index) => !existingUsers[index]);
  const password = usersToCreate.length ? await bcrypt.hash(demoPassword, 12) : null;
  const resolvedUserIds = new Map();
  let usersCreated = 0;
  let usersExisting = 0;

  for (let index = 0; index < demoUsers.length; index += 1) {
    const user = demoUsers[index];
    const existing = existingUsers[index];

    if (existing) {
      if (existing.role !== user.role) {
        throw new Error(`${user.email} already exists with role ${existing.role}; expected ${user.role}`);
      }
      resolvedUserIds.set(user.id, existing.id);
      usersExisting += 1;
      continue;
    }

    const approvedAt = new Date();
    const created = await database.user.create({
      data: {
        ...user,
        password,
        isVerified: true,
        ...(user.role === "seller" ? { verificationApprovedDate: approvedAt } : {}),
      },
    });
    resolvedUserIds.set(user.id, created.id);
    usersCreated += 1;
  }

  let productsCreated = 0;
  let productsExisting = 0;

  for (const product of demoProducts) {
    const existing = await database.product.findUnique({ where: { id: product.id } });
    if (existing) {
      productsExisting += 1;
      continue;
    }

    const { sellerId, colorVariants, storageVariants, options, ...productData } = product;
    await database.product.create({
      data: {
        ...productData,
        discount: 0,
        sellerId: resolvedUserIds.get(sellerId),
        colorVariants: { create: colorVariants },
        storageVariants: { create: storageVariants },
        options: { create: options },
      },
    });
    productsCreated += 1;
  }

  return { usersCreated, usersExisting, productsCreated, productsExisting };
};

const demoPasswordFromEnvironment = () => {
  const demoPassword = process.env.DEMO_PASSWORD;
  if (!demoPassword || demoPassword.length < 12) {
    throw new Error("DEMO_PASSWORD must be set to at least 12 characters when demo seeding is enabled");
  }
  return demoPassword;
};

export const applyDemoOptionPricing = async (client) => {
  const results = [];
  for (const product of demoProducts) {
    for (const option of product.options) {
      const updated = await client.productOption.updateMany({
        where: { productId: product.id, kind: option.kind, value: option.value },
        data: { priceDelta: option.priceDelta, stock: option.stock ?? null },
      });
      if (updated.count > 0) results.push({ productId: product.id, ...option });
    }
  }
  return results;
};

export const ensureDemoData = async (prisma) => {
  const demoPassword = demoPasswordFromEnvironment();
  validateDemoCatalog();
  const seedTransaction = () => prisma.$transaction(
    (database) => createMissingDemoData(database, demoPassword),
    { isolationLevel: "Serializable" },
  );

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await seedTransaction();
    } catch (error) {
      const retryable = error?.code === "P2002" || error?.code === "P2034";
      if (!retryable || attempt === 3) throw error;
    }
  }

  throw new Error("Demo data seed retry loop exhausted");
};

export const replaceCustomerSellerData = async (prisma) => {
  const demoPassword = demoPasswordFromEnvironment();
  validateDemoCatalog();

  return prisma.$transaction(async (database) => {
    await database.order.updateMany({ data: { billId: null } });

    const deleted = {};
    const preserved = { paymentEvents: await database.paymentEvent.count() };
    for (const [name, operation] of [
      ["idempotencyKeys", () => database.idempotencyKey.deleteMany()],
      ["payments", () => database.payment.deleteMany()],
      ["reviews", () => database.productReview.deleteMany()],
      ["revenues", () => database.revenue.deleteMany()],
      ["notifications", () => database.notification.deleteMany()],
      ["cartItems", () => database.cartItem.deleteMany()],
      ["carts", () => database.cart.deleteMany()],
      ["bills", () => database.bill.deleteMany()],
      ["orders", () => database.order.deleteMany()],
      ["promoCodeUsages", () => database.promoCodeUsage.deleteMany()],
      ["nonAdminPromoCodes", () => database.promoCode.deleteMany({
        where: { createdBy: { role: { in: ["user", "seller"] } } },
      })],
      ["refreshTokens", () => database.refreshToken.deleteMany({
        where: { user: { role: { in: ["user", "seller"] } } },
      })],
      ["products", () => database.product.deleteMany()],
      ["users", () => database.user.deleteMany({ where: { role: { in: ["user", "seller"] } } })],
    ]) {
      deleted[name] = (await operation()).count;
    }

    const seeded = await createMissingDemoData(database, demoPassword);
    return { deleted, preserved, seeded };
  }, { isolationLevel: "Serializable", timeout: 30000 });
};
