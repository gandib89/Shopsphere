-- Money columns were stored as double precision (Float), which cannot exactly represent
-- typical currency values and accumulates rounding drift across the order -> revenue -> bill
-- chain. Switching to fixed-precision NUMERIC stores exact currency values on disk. The
-- application layer keeps working with plain JS numbers unchanged — see the Prisma Client
-- extension in database/prismaClient.js that converts Decimal <-> number at the read boundary.

-- AlterTable: products
ALTER TABLE "products"
  ALTER COLUMN "price" TYPE DECIMAL(12,2) USING ROUND("price"::numeric, 2),
  ALTER COLUMN "discount" TYPE DECIMAL(5,2) USING ROUND("discount"::numeric, 2),
  ALTER COLUMN "discount" SET DEFAULT 0;

-- AlterTable: orders
ALTER TABLE "orders"
  ALTER COLUMN "totalPrice" TYPE DECIMAL(12,2) USING ROUND("totalPrice"::numeric, 2),
  ALTER COLUMN "adminCommission" TYPE DECIMAL(12,2) USING ROUND("adminCommission"::numeric, 2),
  ALTER COLUMN "adminCommission" SET DEFAULT 0,
  ALTER COLUMN "promoDiscountAmount" TYPE DECIMAL(12,2) USING ROUND("promoDiscountAmount"::numeric, 2);

-- AlterTable: payments
ALTER TABLE "payments"
  ALTER COLUMN "amount" TYPE DECIMAL(12,2) USING ROUND("amount"::numeric, 2);

-- AlterTable: carts
ALTER TABLE "carts"
  ALTER COLUMN "totalPrice" TYPE DECIMAL(12,2) USING ROUND("totalPrice"::numeric, 2),
  ALTER COLUMN "totalPrice" SET DEFAULT 0;

-- AlterTable: cart_items
ALTER TABLE "cart_items"
  ALTER COLUMN "price" TYPE DECIMAL(12,2) USING ROUND("price"::numeric, 2);

-- AlterTable: revenues
ALTER TABLE "revenues"
  ALTER COLUMN "totalSalePrice" TYPE DECIMAL(12,2) USING ROUND("totalSalePrice"::numeric, 2),
  ALTER COLUMN "adminCommission" TYPE DECIMAL(12,2) USING ROUND("adminCommission"::numeric, 2),
  ALTER COLUMN "adminCommission" SET DEFAULT 0,
  ALTER COLUMN "sellerRevenue" TYPE DECIMAL(12,2) USING ROUND("sellerRevenue"::numeric, 2),
  ALTER COLUMN "sellerRevenue" SET DEFAULT 0;

-- AlterTable: promo_codes
ALTER TABLE "promo_codes"
  ALTER COLUMN "discountValue" TYPE DECIMAL(12,2) USING ROUND("discountValue"::numeric, 2),
  ALTER COLUMN "minPurchase" TYPE DECIMAL(12,2) USING ROUND("minPurchase"::numeric, 2),
  ALTER COLUMN "minPurchase" SET DEFAULT 0,
  ALTER COLUMN "maxDiscount" TYPE DECIMAL(12,2) USING ROUND("maxDiscount"::numeric, 2);

-- AlterTable: bills
ALTER TABLE "bills"
  ALTER COLUMN "unitPrice" TYPE DECIMAL(12,2) USING ROUND("unitPrice"::numeric, 2),
  ALTER COLUMN "totalPrice" TYPE DECIMAL(12,2) USING ROUND("totalPrice"::numeric, 2),
  ALTER COLUMN "adminCommission" TYPE DECIMAL(12,2) USING ROUND("adminCommission"::numeric, 2),
  ALTER COLUMN "sellerRevenue" TYPE DECIMAL(12,2) USING ROUND("sellerRevenue"::numeric, 2);
