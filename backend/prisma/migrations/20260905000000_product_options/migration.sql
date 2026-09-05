-- One table for every selectable option, carrying the price difference that option adds.
CREATE TABLE "product_options" (
    "id" TEXT NOT NULL,
    "productId" VARCHAR(24) NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "priceDelta" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "stock" INTEGER,
    CONSTRAINT "product_options_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "product_options_productId_kind_idx" ON "product_options"("productId", "kind");
CREATE UNIQUE INDEX "product_options_productId_kind_value_key" ON "product_options"("productId", "kind", "value");

ALTER TABLE "product_options" ADD CONSTRAINT "product_options_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: stock-bearing variant rows first so their inventory survives, then the plain
-- variant lists for everything they do not already cover. Every backfilled option starts at a
-- zero price delta, so prices are unchanged until a seller sets one.
INSERT INTO "product_options" ("id", "productId", "kind", "value", "priceDelta", "stock")
SELECT gen_random_uuid()::text, "productId", 'color', "color", 0, "stock"
FROM "product_color_variants" WHERE "color" IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO "product_options" ("id", "productId", "kind", "value", "priceDelta", "stock")
SELECT gen_random_uuid()::text, "productId", 'storage', "storage", 0, "stock"
FROM "product_storage_variants" WHERE "storage" IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO "product_options" ("id", "productId", "kind", "value", "priceDelta", "stock")
SELECT gen_random_uuid()::text, p."id", k."kind", v, 0, NULL
FROM "products" p
CROSS JOIN LATERAL (VALUES
    ('color', p."variantColor"),
    ('storage', p."variantStorage"),
    ('ram', p."variantRam"),
    ('screenSize', p."variantScreenSize"),
    ('processor', p."variantProcessor")
) AS k("kind", "values")
CROSS JOIN LATERAL unnest(k."values") AS v
ON CONFLICT DO NOTHING;
