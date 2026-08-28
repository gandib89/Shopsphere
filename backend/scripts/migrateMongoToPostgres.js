// One-time ETL: copies every existing MongoDB document into the new Postgres
// schema. Run once, before Mongoose is removed from the codebase:
//   node scripts/migrateMongoToPostgres.js
//
// Every Postgres id reuses the source Mongo ObjectId hex string verbatim, so
// existing JWTs and any client-cached ids keep working after the swap.

import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import mongoose from "mongoose";
import { prisma } from "../database/prismaClient.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", "config", "config.env") });

const { User } = await import("../models/userSchema.js");
const { Product } = await import("../models/productSchema.js");
const { Order } = await import("../models/orderSchema.js");
const { Cart } = await import("../models/cartSchema.js");
const { Revenue } = await import("../models/revenueSchema.js");
const { Notification } = await import("../models/notificationSchema.js");
const { PromoCode } = await import("../models/promoCodeSchema.js");
const { Bill } = await import("../models/billSchema.js");

const id = (v) => (v ? v.toString() : null);

const migratedUsers = new Set();
const migratedProducts = new Set();
const migratedOrders = new Set();
const migratedBills = new Set();

const skipped = [];
const logSkip = (collection, docId, reason) => skipped.push(`${collection} ${docId}: ${reason}`);

async function migrateUsers() {
  const docs = await User.find({}).lean();
  for (const d of docs) {
    await prisma.user.create({
      data: {
        id: id(d._id),
        firstName: d.firstName,
        lastName: d.lastName,
        email: d.email,
        phone: d.phone ?? null,
        password: d.password ?? null,
        googleId: d.googleId ?? null,
        role: d.role ?? "user",
        shopName: d.shopName ?? null,
        shopDescription: d.shopDescription ?? null,
        isVerified: !!d.isVerified,
        verificationRequestDate: d.verificationRequestDate ?? null,
        verificationApprovedDate: d.verificationApprovedDate ?? null,
        verificationRejectionReason: d.verificationRejectionReason ?? null,
        createdAt: d.createdAt ?? new Date(),
      },
    });
    migratedUsers.add(id(d._id));
  }
  console.log(`Users: ${migratedUsers.size}/${docs.length} migrated`);
}

async function migrateProducts() {
  const docs = await Product.find({}).lean();
  for (const d of docs) {
    const sellerId = id(d.sellerId);
    try {
      await prisma.product.create({
        data: {
          id: id(d._id),
          name: d.name,
          price: d.price,
          quantity: d.quantity,
          description: d.description ?? null,
          images: d.images ?? [],
          category: d.category,
          variantStorage: d.variants?.storage ?? [],
          variantColor: d.variants?.color ?? [],
          variantRam: d.variants?.ram ?? [],
          variantScreenSize: d.variants?.screenSize ?? [],
          variantProcessor: d.variants?.processor ?? [],
          sellerId: sellerId && migratedUsers.has(sellerId) ? sellerId : null,
          discount: d.discount ?? 0,
          discountUpdatedAt: d.discountUpdatedAt ?? null,
          createdAt: d.createdAt ?? new Date(),
        },
      });
    } catch (err) {
      logSkip("Product", id(d._id), err.message);
      continue;
    }
    migratedProducts.add(id(d._id));

    for (const cv of d.colorVariants ?? []) {
      await prisma.productColorVariant.create({
        data: {
          productId: id(d._id),
          color: cv.color ?? null,
          images: cv.images ?? [],
          stock: cv.stock ?? 0,
        },
      });
    }
    for (const sv of d.storageVariants ?? []) {
      await prisma.productStorageVariant.create({
        data: {
          productId: id(d._id),
          storage: sv.storage ?? null,
          stock: sv.stock ?? 0,
        },
      });
    }
  }
  console.log(`Products: ${migratedProducts.size}/${docs.length} migrated`);
  return docs; // reviews are migrated later, after Orders exist
}

async function migrateOrders() {
  const docs = await Order.find({}).lean();
  for (const d of docs) {
    const productId = id(d.product);
    if (!productId || !migratedProducts.has(productId)) {
      logSkip("Order", id(d._id), `missing product ${productId}`);
      continue;
    }
    const userId = id(d.userId);
    try {
      await prisma.order.create({
        data: {
          id: id(d._id),
          firstName: d.firstName,
          lastName: d.lastName,
          productId,
          quantity: d.quantity,
          deliveryDate: d.deliveryDate,
          email: d.email,
          deliveryStreet: d.deliveryAddress?.street ?? null,
          deliveryCity: d.deliveryAddress?.city ?? null,
          deliveryState: d.deliveryAddress?.state ?? null,
          deliveryZipCode: d.deliveryAddress?.zipCode ?? null,
          deliveryCountry: d.deliveryAddress?.country ?? "Nepal",
          totalPrice: d.totalPrice,
          adminCommission: d.adminCommission ?? 0,
          status: d.status ?? "Pending",
          deliveredAt: d.deliveredAt ?? null,
          cancelledAt: d.cancelledAt ?? null,
          returnRequestedAt: d.returnRequestedAt ?? null,
          returnReason: d.returnReason ?? null,
          returnImage: d.returnImage ?? null,
          refundReleasedAt: d.refundReleasedAt ?? null,
          variantStorage: d.variants?.storage ?? null,
          variantColor: d.variants?.color ?? null,
          variantRam: d.variants?.ram ?? null,
          variantScreenSize: d.variants?.screenSize ?? null,
          variantProcessor: d.variants?.processor ?? null,
          size: d.size ?? null,
          color: d.color ?? null,
          // billId patched in a second pass once Bills are migrated
          userId: userId && migratedUsers.has(userId) ? userId : null,
          confirmationEmailSent: !!d.confirmationEmailSent,
          orderNumber: d.orderNumber ?? null,
          orderGroupId: d.orderGroupId ?? null,
          promoCode: d.promoCode?.code ?? null,
          promoDiscountAmount: d.promoCode?.discountAmount ?? null,
          confirmedAt: d.confirmedAt ?? null,
          processingAt: d.processingAt ?? null,
          shippedAt: d.shippedAt ?? null,
          createdAt: d.createdAt ?? new Date(),
        },
      });
      migratedOrders.add(id(d._id));
    } catch (err) {
      logSkip("Order", id(d._id), err.message);
    }
  }
  console.log(`Orders: ${migratedOrders.size}/${docs.length} migrated`);
  return docs; // keep for billId patch pass
}

async function migrateProductReviews(productDocs) {
  let count = 0;
  for (const d of productDocs) {
    if (!migratedProducts.has(id(d._id))) continue;
    for (const r of d.reviews ?? []) {
      const userId = id(r.userId);
      const orderId = id(r.orderId);
      await prisma.productReview.create({
        data: {
          productId: id(d._id),
          userName: r.userName,
          userId: userId && migratedUsers.has(userId) ? userId : null,
          orderId: orderId && migratedOrders.has(orderId) ? orderId : null,
          rating: r.rating,
          comment: r.comment,
          createdAt: r.createdAt ?? new Date(),
        },
      });
      count++;
    }
  }
  console.log(`Product reviews: ${count} migrated`);
}

async function migrateCarts() {
  const docs = await Cart.find({}).lean();
  let migrated = 0;
  let items = 0;
  for (const d of docs) {
    const userId = id(d.user);
    if (!userId || !migratedUsers.has(userId)) {
      logSkip("Cart", id(d._id), `missing user ${userId}`);
      continue;
    }
    await prisma.cart.create({
      data: {
        id: id(d._id),
        userId,
        email: d.email,
        totalPrice: d.totalPrice ?? 0,
        createdAt: d.createdAt ?? new Date(),
        updatedAt: d.updatedAt ?? new Date(),
      },
    });
    migrated++;
    for (const item of d.items ?? []) {
      const productId = id(item.product);
      if (!productId || !migratedProducts.has(productId)) {
        logSkip("CartItem", `${id(d._id)}/${productId}`, "missing product");
        continue;
      }
      await prisma.cartItem.create({
        data: {
          cartId: id(d._id),
          productId,
          quantity: item.quantity ?? 1,
          price: item.price,
          variants: item.variants ?? {},
          addedAt: item.addedAt ?? new Date(),
        },
      });
      items++;
    }
  }
  console.log(`Carts: ${migrated}/${docs.length} migrated, ${items} items`);
}

async function migrateRevenues() {
  const docs = await Revenue.find({}).lean();
  let migrated = 0;
  for (const d of docs) {
    const orderId = id(d.orderId);
    const sellerId = id(d.sellerId);
    const productId = id(d.productId);
    if (!migratedOrders.has(orderId) || !migratedUsers.has(sellerId) || !migratedProducts.has(productId)) {
      logSkip("Revenue", id(d._id), "missing order/seller/product");
      continue;
    }
    const adminId = id(d.adminId);
    await prisma.revenue.create({
      data: {
        id: id(d._id),
        orderId,
        sellerId,
        adminId: adminId && migratedUsers.has(adminId) ? adminId : null,
        productId,
        totalSalePrice: d.totalSalePrice,
        adminCommission: d.adminCommission ?? 0,
        sellerRevenue: d.sellerRevenue ?? 0,
        quantity: d.quantity ?? null,
        transactionDate: d.transactionDate ?? new Date(),
        month: d.month ?? null,
        year: d.year ?? null,
        status: d.status ?? "Completed",
      },
    });
    migrated++;
  }
  console.log(`Revenues: ${migrated}/${docs.length} migrated`);
}

async function migrateNotifications() {
  const docs = await Notification.find({}).lean();
  let migrated = 0;
  for (const d of docs) {
    const userId = id(d.userId);
    if (!userId || !migratedUsers.has(userId)) {
      logSkip("Notification", id(d._id), `missing user ${userId}`);
      continue;
    }
    const productId = id(d.productId);
    await prisma.notification.create({
      data: {
        id: id(d._id),
        userId,
        type: d.type,
        title: d.title,
        message: d.message,
        read: !!d.read,
        productId: productId && migratedProducts.has(productId) ? productId : null,
        productName: d.productName ?? null,
        productImage: d.productImage ?? null,
        createdAt: d.createdAt ?? new Date(),
      },
    });
    migrated++;
  }
  console.log(`Notifications: ${migrated}/${docs.length} migrated`);
}

async function migratePromoCodes() {
  const docs = await PromoCode.find({}).lean();
  let migrated = 0;
  let usages = 0;
  for (const d of docs) {
    const createdById = id(d.createdBy);
    if (!createdById || !migratedUsers.has(createdById)) {
      logSkip("PromoCode", id(d._id), `missing createdBy ${createdById}`);
      continue;
    }
    await prisma.promoCode.create({
      data: {
        id: id(d._id),
        code: d.code,
        description: d.description,
        discountType: d.discountType,
        discountValue: d.discountValue,
        minPurchase: d.minPurchase ?? 0,
        maxDiscount: d.maxDiscount ?? null,
        usageLimit: d.usageLimit ?? null,
        usedCount: d.usedCount ?? 0,
        validFrom: d.validFrom,
        validUntil: d.validUntil,
        isActive: d.isActive ?? true,
        createdById,
        createdAt: d.createdAt ?? new Date(),
      },
    });
    migrated++;
    for (const u of d.usedBy ?? []) {
      const userId = id(u);
      if (!userId || !migratedUsers.has(userId)) continue;
      await prisma.promoCodeUsage.create({
        data: { promoCodeId: id(d._id), userId },
      });
      usages++;
    }
  }
  console.log(`Promo codes: ${migrated}/${docs.length} migrated, ${usages} usages`);
}

async function migrateBills() {
  const docs = await Bill.find({}).lean();
  let migrated = 0;
  for (const d of docs) {
    const orderId = id(d.orderId);
    const userId = id(d.userId);
    const productId = id(d.productId);
    if (!migratedOrders.has(orderId) || !migratedUsers.has(userId) || !migratedProducts.has(productId)) {
      logSkip("Bill", id(d._id), "missing order/user/product");
      continue;
    }
    await prisma.bill.create({
      data: {
        id: id(d._id),
        orderId,
        userId,
        productId,
        billNumber: d.billNumber,
        firstName: d.firstName ?? null,
        lastName: d.lastName ?? null,
        email: d.email ?? null,
        phone: d.phone ?? null,
        productName: d.productName ?? null,
        quantity: d.quantity ?? null,
        unitPrice: d.unitPrice ?? null,
        totalPrice: d.totalPrice ?? null,
        adminCommission: d.adminCommission ?? null,
        sellerRevenue: d.sellerRevenue ?? null,
        deliveryStreet: d.deliveryAddress?.street ?? null,
        deliveryCity: d.deliveryAddress?.city ?? null,
        deliveryState: d.deliveryAddress?.state ?? null,
        deliveryZipCode: d.deliveryAddress?.zipCode ?? null,
        deliveryCountry: d.deliveryAddress?.country ?? null,
        deliveryDate: d.deliveryDate ?? null,
        orderDate: d.orderDate ?? new Date(),
        status: d.status ?? "Generated",
      },
    });
    migratedBills.add(id(d._id));
    migrated++;
  }
  console.log(`Bills: ${migrated}/${docs.length} migrated`);
}

async function patchOrderBillIds(orderDocs) {
  let patched = 0;
  for (const d of orderDocs) {
    const orderId = id(d._id);
    const billId = id(d.billId);
    if (!migratedOrders.has(orderId) || !billId || !migratedBills.has(billId)) continue;
    await prisma.order.update({ where: { id: orderId }, data: { billId } });
    patched++;
  }
  console.log(`Order.billId patched on ${patched} orders`);
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { dbName: "SHOPSPHERE" });
  console.log("Connected to MongoDB (read-only for this migration)\n");

  await migrateUsers();
  const productDocs = await migrateProducts();
  const orderDocs = await migrateOrders();
  await migrateProductReviews(productDocs);
  await migrateCarts();
  await migrateRevenues();
  await migrateNotifications();
  await migratePromoCodes();
  await migrateBills();
  await patchOrderBillIds(orderDocs);

  if (skipped.length) {
    console.log(`\n${skipped.length} rows skipped (dangling references in source data):`);
    skipped.forEach((s) => console.log(`  - ${s}`));
  }

  await mongoose.disconnect();
  await prisma.$disconnect();
  console.log("\nMigration complete.");
}

main().catch(async (err) => {
  console.error("Migration failed:", err);
  await mongoose.disconnect().catch(() => {});
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
