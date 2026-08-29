import bcrypt from "bcryptjs";

const demoUsers = [
  {
    id: "66a100000000000000000001",
    firstName: "Aarav",
    lastName: "Shrestha",
    email: "seller1@shopsphere",
    phone: "+9779800001001",
    role: "seller",
    shopName: "Orbit Apple Store",
    shopDescription: "Apple devices, Macs, and everyday accessories with delivery across Nepal.",
  },
  {
    id: "66a100000000000000000002",
    firstName: "Nisha",
    lastName: "Gurung",
    email: "seller2@shopsphere",
    phone: "+9779800001002",
    role: "seller",
    shopName: "Himalayan Tech House",
    shopDescription: "Curated personal tech, charging gear, wearables, and portable audio.",
  },
  {
    id: "66a100000000000000000003",
    firstName: "Suman",
    lastName: "Karki",
    email: "custumer1@shopsphere",
    phone: "+9779800002001",
    role: "user",
  },
  {
    id: "66a100000000000000000004",
    firstName: "Maya",
    lastName: "Rai",
    email: "custumer2@shopsphere",
    phone: "+9779800002002",
    role: "user",
  },
];

const demoProducts = [
  {
    id: "66a200000000000000000001",
    name: "iPhone 17",
    price: 124999,
    quantity: 18,
    description: "Latest-generation iPhone with a bright display, capable dual-camera system, and all-day battery life.",
    images: ["/images/iphone17.jpg", "/images/iphone17a.jpg", "/images/iphone17b.jpg"],
    category: "Mobile Phones",
    variantStorage: ["128GB", "256GB", "512GB"],
    variantColor: ["Lavender", "Mist Blue", "Black", "Sage"],
    sellerId: "66a100000000000000000001",
  },
  {
    id: "66a200000000000000000002",
    name: "iPhone 17 Pro Max",
    price: 189999,
    quantity: 12,
    description: "Flagship iPhone with a large ProMotion display, pro camera controls, and premium performance.",
    images: ["/images/iphone17pm.png", "/images/17pmblue.png", "/images/17pmorange.webp", "/images/17pmwhite.jpg"],
    category: "Mobile Phones",
    variantStorage: ["256GB", "512GB", "1TB"],
    variantColor: ["Deep Blue", "Silver", "Cosmic Orange"],
    sellerId: "66a100000000000000000001",
  },
  {
    id: "66a200000000000000000003",
    name: "iPhone 16",
    price: 109999,
    quantity: 21,
    description: "A fast and dependable iPhone with a versatile camera, durable design, and USB-C charging.",
    images: ["/images/iphone16.png"],
    category: "Mobile Phones",
    variantStorage: ["128GB", "256GB"],
    variantColor: ["Ultramarine", "Teal", "Pink", "Black", "White"],
    sellerId: "66a100000000000000000001",
  },
  {
    id: "66a200000000000000000004",
    name: "MacBook Air M4 13-inch",
    price: 179999,
    quantity: 9,
    description: "Thin and light MacBook Air with M4 performance, a sharp Liquid Retina display, and silent operation.",
    images: ["/images/macbookairm4.avif", "/images/macairmidnight.jpg", "/images/macairsilver.webp"],
    category: "Laptops",
    variantStorage: ["256GB", "512GB"],
    variantRam: ["16GB", "24GB"],
    variantColor: ["Midnight", "Silver"],
    sellerId: "66a100000000000000000001",
  },
  {
    id: "66a200000000000000000005",
    name: "Mac mini M4",
    price: 99999,
    quantity: 7,
    description: "Compact M4 desktop for work and creativity, with fast unified memory and a versatile selection of ports.",
    images: ["/images/macmini.jpg", "/images/macm4.webp", "/images/macm4a.webp", "/images/macm4b.webp"],
    category: "Mac Mini",
    variantStorage: ["256GB", "512GB"],
    variantRam: ["16GB", "24GB"],
    sellerId: "66a100000000000000000001",
  },
  {
    id: "66a200000000000000000006",
    name: "Apple Magic Keyboard",
    price: 19999,
    quantity: 15,
    description: "Low-profile wireless keyboard with a comfortable, precise typing feel and rechargeable battery.",
    images: ["/images/magickeyboard.png", "/images/magickeyboardblack.webp", "/images/magickeyboardwhite.jpg"],
    category: "Accessories",
    variantColor: ["White", "Black"],
    sellerId: "66a100000000000000000001",
  },
  {
    id: "66a200000000000000000007",
    name: "Apple Watch Series 10",
    price: 72999,
    quantity: 13,
    description: "Slim Apple Watch with health and activity tracking, a bright always-on display, and everyday notifications.",
    images: ["/images/applewatch.avif"],
    category: "Smartwatches",
    variantScreenSize: ["42mm", "46mm"],
    variantColor: ["Jet Black", "Rose Gold", "Silver"],
    sellerId: "66a100000000000000000002",
  },
  {
    id: "66a200000000000000000008",
    name: "Apple Watch Band Collection",
    price: 8999,
    quantity: 28,
    description: "A choice of comfortable sport, braided, trail, and metal bands compatible with Apple Watch.",
    images: ["/images/applewatchband.jpg"],
    category: "Accessories",
    variantColor: ["Volt", "Orange", "Blue", "Purple", "Natural"],
    sellerId: "66a100000000000000000002",
  },
  {
    id: "66a200000000000000000009",
    name: "Apple Magic Mouse",
    price: 14999,
    quantity: 17,
    description: "Rechargeable wireless mouse with a smooth Multi-Touch surface for gestures and scrolling.",
    images: ["/images/magicmouse.jpg"],
    category: "Accessories",
    variantColor: ["White"],
    sellerId: "66a100000000000000000002",
  },
  {
    id: "66a20000000000000000000a",
    name: "Apple 20W USB-C Power Adapter with Cable",
    price: 5999,
    quantity: 32,
    description: "Compact fast-charging USB-C power adapter supplied with a compatible charging cable.",
    images: ["/images/chargingdock.jpg", "/images/charger.jpg", "/images/charger3.webp"],
    category: "Accessories",
    sellerId: "66a100000000000000000002",
  },
  {
    id: "66a20000000000000000000b",
    name: "USB-C Charge Cable",
    price: 2499,
    quantity: 44,
    description: "Durable USB-C charging cable for compatible phones, tablets, laptops, and power adapters.",
    images: ["/images/ctypecable.webp"],
    category: "Accessories",
    sellerId: "66a100000000000000000002",
  },
  {
    id: "66a20000000000000000000c",
    name: "Marshall Middleton Portable Bluetooth Speaker",
    price: 54999,
    quantity: 8,
    description: "Portable wireless speaker with powerful room-filling sound, tactile controls, and a carry strap.",
    images: ["/images/speaker2.jpg", "/images/speaker.webp"],
    category: "Accessories",
    variantColor: ["Black and Brass"],
    sellerId: "66a100000000000000000002",
  },
];

export const ensureDemoData = async (prisma) => {
  const demoPassword = process.env.DEMO_PASSWORD;
  if (!demoPassword || demoPassword.length < 12) {
    throw new Error("DEMO_PASSWORD must be set to at least 12 characters when demo seeding is enabled");
  }
  const seedTransaction = async () => prisma.$transaction(async (database) => {
    const existingUsers = await Promise.all(
      demoUsers.map((user) => database.user.findUnique({ where: { email: user.email } })),
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

      await database.product.create({
        data: {
          variantStorage: [],
          variantColor: [],
          variantRam: [],
          variantScreenSize: [],
          variantProcessor: [],
          discount: 0,
          ...product,
          sellerId: resolvedUserIds.get(product.sellerId),
        },
      });
      productsCreated += 1;
    }

    return { usersCreated, usersExisting, productsCreated, productsExisting };
  }, { isolationLevel: "Serializable" });

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
