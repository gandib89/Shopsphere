// Bounded static public-catalog projection for search_products / compare_products.
//
// The MCP process holds no database credentials (see docs/mcp.md §1), so it
// cannot query Prisma directly. This module is the narrow stand-in: every
// record already excludes archived products and private fields (sellerId,
// exact stock counts, seller metadata) at the source, and the query helpers
// below enforce paging/comparison caps server-side. No caller input ever
// reaches a database filter — only fixed comparisons against allowlisted keys.

const AVAILABILITY_IN_STOCK = "In stock";
const AVAILABILITY_SOLD_OUT = "Sold out";

export const DEFAULT_SEARCH_LIMIT = 20;
export const MAX_SEARCH_LIMIT = 50;
export const MAX_COMPARE_PRODUCTS = 5;

// Internal rows: `archived` and `inStock` never leave this module. The public
// projection exposes only an availability label, never exact stock counts.
const CATALOG_ROWS = Object.freeze([
  { id: "prod_001", name: "MacBook Air M2", price: 129900.0, images: ["https://shop.example/img/mba-m2.jpg"], category: "MacBook", inStock: true, archived: false },
  { id: "prod_002", name: "MacBook Pro 14", price: 199900.0, images: ["https://shop.example/img/mbp-14.jpg"], category: "MacBook", inStock: true, archived: false },
  { id: "prod_003", name: "iPhone 15", price: 99900.0, images: ["https://shop.example/img/iphone-15.jpg"], category: "iPhone", inStock: true, archived: false },
  { id: "prod_004", name: "iPhone 14", price: 84900.0, images: ["https://shop.example/img/iphone-14.jpg"], category: "iPhone", inStock: false, archived: false },
  { id: "prod_005", name: "Apple Watch SE", price: 24900.0, images: ["https://shop.example/img/watch-se.jpg"], category: "Apple Watch", inStock: true, archived: false },
  { id: "prod_006", name: "AirPods Pro", price: 24900.0, images: ["https://shop.example/img/airpods-pro.jpg"], category: "Accessories", inStock: true, archived: false },
  { id: "prod_007", name: "Magic Keyboard", price: 14900.0, images: ["https://shop.example/img/magic-keyboard.jpg"], category: "Accessories", inStock: true, archived: false },
  { id: "prod_008", name: "Mac Mini M2", price: 59900.0, images: ["https://shop.example/img/mac-mini.jpg"], category: "Mac mini", inStock: true, archived: false },
  // Archived: must never surface in search or comparison results.
  { id: "prod_009", name: "MacBook Air M2 Refurbished", price: 99900.0, images: ["https://shop.example/img/mba-m2-refurb.jpg"], category: "MacBook", inStock: true, archived: true },
]);

const toPublicProduct = (row) => ({
  id: row.id,
  name: row.name,
  price: row.price,
  images: [...row.images],
  category: row.category,
  availability: row.inStock ? AVAILABILITY_IN_STOCK : AVAILABILITY_SOLD_OUT,
});

const visibleRows = () => CATALOG_ROWS.filter((row) => !row.archived);

const applySort = (rows, sort) => {
  const sorted = [...rows];
  if (sort === "price-asc") sorted.sort((a, b) => a.price - b.price);
  else if (sort === "price-desc") sorted.sort((a, b) => b.price - a.price);
  else if (sort === "name-desc") sorted.sort((a, b) => b.name.localeCompare(a.name));
  else sorted.sort((a, b) => a.name.localeCompare(b.name)); // name-asc default
  return sorted;
};

export const searchCatalog = ({ q, category, minPrice, maxPrice, sort, page, limit } = {}) => {
  const needle = q?.toLowerCase();
  const filtered = visibleRows().filter(
    (row) =>
      (!needle || row.name.toLowerCase().includes(needle)) &&
      (!category || row.category.toLowerCase() === category.toLowerCase()) &&
      (minPrice === undefined || row.price >= minPrice) &&
      (maxPrice === undefined || row.price <= maxPrice),
  );
  const total = filtered.length;
  const pageSize = Math.min(Math.max(limit ?? DEFAULT_SEARCH_LIMIT, 1), MAX_SEARCH_LIMIT);
  const currentPage = Math.max(page ?? 1, 1);
  const items = applySort(filtered, sort)
    .slice((currentPage - 1) * pageSize, currentPage * pageSize)
    .map(toPublicProduct);
  return { items, total, page: currentPage, pageSize };
};

export const compareCatalog = (productIds = []) => {
  const ids = productIds.slice(0, MAX_COMPARE_PRODUCTS);
  const byId = new Map(visibleRows().map((row) => [row.id, row]));
  // Unknown or archived ids are dropped: same generic shape, no existence oracle.
  return ids.filter((id) => byId.has(id)).map((id) => toPublicProduct(byId.get(id)));
};
