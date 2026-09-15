// Seller catalog and inventory reads for issue #14.
// Scoping uses present-day Product.sellerId = subject only and never depends
// on historical order attribution (no sellerIdAtPurchase, revenue, or order
// lookups). Owned active and archived products are visible to their owner;
// another seller's private fields are denied with generic not-found behavior.
// Public catalog visibility stays separate: this module always returns exact
// private stock, while the public projection exposes availability labels only.
import { createCursorCodec } from "./assistantCursor.js";
import { centsToAmount, money, signedMoney, toCents, toSignedCents } from "./assistantMoney.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const DEFAULT_THRESHOLD = 5;
const MAX_THRESHOLD = 50;

const notFound = () => Object.assign(new Error("Resource not found"), { statusCode: 404, code: "not_found" });

const { decode: decodeCursor, encode: encodeCursor } = createCursorCodec({ operation: "products.listMine" });

const productListSelect = {
  id: true,
  name: true,
  price: true,
  quantity: true,
  category: true,
  isArchived: true,
  createdAt: true,
};

const minimizeProduct = (row) => ({
  id: row.id,
  name: String(row.name).slice(0, 200),
  price: money(toCents(row.price?.toString?.() ?? String(row.price))),
  quantity: row.quantity,
  category: String(row.category ?? "Uncategorized").slice(0, 100),
  isArchived: Boolean(row.isArchived),
});

export const listMyProducts = async (
  { cursor, limit = DEFAULT_LIMIT } = {},
  { client, principal, cursorSecret },
) => {
  const boundedLimit = Math.min(Math.max(1, limit ?? DEFAULT_LIMIT), MAX_LIMIT);
  const query = { limit: boundedLimit };
  const position = decodeCursor(cursor, principal, query, cursorSecret);
  const rows = await client.product.findMany({
    where: {
      sellerId: principal.subject,
      ...(position ? {
        OR: [
          { createdAt: { lt: new Date(position.createdAt) } },
          { createdAt: new Date(position.createdAt), id: { lt: position.id } },
        ],
      } : {}),
    },
    select: productListSelect,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: boundedLimit + 1,
  });
  const page = rows.slice(0, boundedLimit);
  return {
    products: page.map(minimizeProduct),
    nextCursor: rows.length > boundedLimit ? encodeCursor(page.at(-1), principal, query, cursorSecret) : null,
  };
};

const productDetailSelect = {
  id: true,
  name: true,
  price: true,
  quantity: true,
  category: true,
  description: true,
  images: true,
  discount: true,
  isArchived: true,
  createdAt: true,
  options: { select: { kind: true, value: true, priceDelta: true, stock: true } },
};

export const getMyProduct = async ({ productId }, { client, principal }) => {
  if (!productId || typeof productId !== "string" || productId.length > 100) throw notFound();
  const row = await client.product.findFirst({
    where: { id: productId, sellerId: principal.subject },
    select: productDetailSelect,
  });
  if (!row) throw notFound();
  return {
    ...minimizeProduct(row),
    description: String(row.description ?? row.name).slice(0, 2000),
    images: Array.isArray(row.images) ? row.images.slice(0, 20) : [],
    // Percentage string, not money: Decimal(5,2) percent-scale like the
    // storefront pricing helpers consume it.
    discount: centsToAmount(toCents(row.discount?.toString?.() ?? String(row.discount ?? "0"))),
    createdAt: row.createdAt?.toISOString?.() ?? null,
    options: (row.options ?? []).map((option) => {
      const delta = toSignedCents(option.priceDelta?.toString?.() ?? String(option.priceDelta ?? "0"));
      return {
        kind: String(option.kind).slice(0, 50),
        value: String(option.value).slice(0, 100),
        priceDelta: signedMoney(delta),
        stock: option.stock ?? null,
      };
    }),
  };
};

export const getMyInventorySummary = async ({ threshold = DEFAULT_THRESHOLD } = {}, { client, principal }) => {
  const boundedThreshold = Math.min(Math.max(1, threshold ?? DEFAULT_THRESHOLD), MAX_THRESHOLD);
  const scope = { sellerId: principal.subject };
  const [totalProducts, aggregate, lowStock] = await Promise.all([
    client.product.count({ where: scope }),
    client.product.aggregate({ where: scope, _sum: { quantity: true } }),
    client.product.findMany({
      where: { ...scope, quantity: { lte: boundedThreshold } },
      select: { id: true, name: true, quantity: true },
      orderBy: [{ quantity: "asc" }, { id: "asc" }],
      take: MAX_LIMIT,
    }),
  ]);
  return {
    threshold: boundedThreshold,
    totalProducts,
    totalUnits: aggregate?._sum?.quantity ?? 0,
    lowStockCount: lowStock.length,
    lowStock: lowStock.map((row) => ({
      productId: row.id,
      name: String(row.name).slice(0, 200),
      quantity: row.quantity,
    })),
  };
};
