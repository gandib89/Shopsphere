import { fileURLToPath } from "url";
import { dirname, join } from "path";
import dotenv from "dotenv";
import { PrismaClient } from "../generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";

// Loaded defensively here (not just in app.js) because this module is
// imported transitively before app.js's own dotenv.config() line runs.
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", "config", "config.env") });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

const basePrisma = new PrismaClient({ adapter });

// Money columns are stored as Postgres NUMERIC (via Prisma's Decimal type) so currency values
// round-trip exactly on disk instead of drifting like the old double-precision Float columns
// did. Every other line of application code (controllers, tests, the frontend) was written
// against plain JS numbers, though — this extension converts Decimal <-> number right at the
// read boundary so nothing else has to change. Writes need no such extension: Prisma already
// accepts a plain `number` for a Decimal field on create/update.
const toNumber = (value) => (value === null || value === undefined ? value : value.toNumber());

const decimalField = (field) => ({
  needs: { [field]: true },
  compute: (row) => toNumber(row[field]),
});

export const prisma = basePrisma.$extends({
  name: "decimalToNumber",
  result: {
    product: { price: decimalField("price"), discount: decimalField("discount") },
    order: {
      totalPrice: decimalField("totalPrice"),
      adminCommission: decimalField("adminCommission"),
      promoDiscountAmount: decimalField("promoDiscountAmount"),
    },
    payment: { amount: decimalField("amount") },
    refund: { amount: decimalField("amount") },
    cart: { totalPrice: decimalField("totalPrice") },
    cartItem: { price: decimalField("price") },
    revenue: {
      totalSalePrice: decimalField("totalSalePrice"),
      adminCommission: decimalField("adminCommission"),
      sellerRevenue: decimalField("sellerRevenue"),
    },
    promoCode: {
      discountValue: decimalField("discountValue"),
      minPurchase: decimalField("minPurchase"),
      maxDiscount: decimalField("maxDiscount"),
    },
    bill: {
      unitPrice: decimalField("unitPrice"),
      totalPrice: decimalField("totalPrice"),
      adminCommission: decimalField("adminCommission"),
      sellerRevenue: decimalField("sellerRevenue"),
    },
  },
});
