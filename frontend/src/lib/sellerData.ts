import { authFetch } from './session';

export type SellerProduct = {
  _id: string; name: string; category: string; price: number; quantity: number;
  images: string[]; discount?: number; createdAt?: string;
  colorVariants?: { color: string; stock: number }[];
  storageVariants?: { storage: string; stock: number }[];
};

export type SellerOrder = {
  _id: string; firstName: string; lastName: string; email: string; phone?: string;
  quantity: number; totalPrice: number; status: string; createdAt?: string; deliveryDate?: string;
  product?: { _id?: string; name?: string; price?: number };
  color?: string; variants?: { color?: string; storage?: string };
  deliveryAddress?: { street?: string; city?: string; state?: string; zipCode?: string; country?: string };
  returnReason?: string; returnImage?: string;
};

export type SellerProfile = { shopName?: string; firstName?: string; lastName?: string; email?: string; isVerified?: boolean };

// The seller endpoints answer with a single unpaginated envelope ({ products } / { orders })
// rather than the admin { items, total } shape, so they need their own reader.
export async function getSellerCollection<T>(path: string, key: 'products' | 'orders', signal?: AbortSignal): Promise<T[]> {
  const response = await authFetch(`${import.meta.env.VITE_BACKEND_URL}${path}`, { signal });
  if (!response.ok) throw new Error(response.status === 401 ? 'Your session has expired. Please sign in again.' : 'Could not load this information. Please try again.');
  const body = await response.json();
  const rows = Array.isArray(body) ? body : body[key];
  if (!Array.isArray(rows)) throw new Error('The server returned an unexpected response. Please try again.');
  return rows as T[];
}

export const LOW_STOCK = 5;
export const stockState = (product: SellerProduct) => product.quantity <= 0 ? 'outofstock' : product.quantity <= LOW_STOCK ? 'lowstock' : 'instock';
export const stockLabel = (product: SellerProduct) => product.quantity <= 0 ? 'Out of stock' : `${product.quantity} in stock`;

// Display names for the storefront's internal category keys.
const categoryNames: Record<string, string> = { 'Mobile Phones': 'iPhone', Laptops: 'MacBook', Smartwatches: 'Apple Watch', Tablets: 'iPad' };
export const categoryName = (category?: string) => category ? categoryNames[category] ?? category : 'Uncategorized';

export const productFilters = [
  { key: 'all', label: 'All' },
  { key: 'instock', label: 'In stock' },
  { key: 'lowstock', label: 'Low stock' },
  { key: 'outofstock', label: 'Out of stock' },
] as const;

export const orderFilters = [
  { key: 'all', label: 'All', statuses: [] as string[] },
  { key: 'processing', label: 'Processing', statuses: ['Pending', 'Confirmed', 'Processing'] },
  { key: 'shipped', label: 'Shipped', statuses: ['Shipped'] },
  { key: 'completed', label: 'Completed', statuses: ['Delivered'] },
  { key: 'cancelled', label: 'Cancelled', statuses: ['Cancelled'] },
  { key: 'returns', label: 'Returns', statuses: ['Return Requested', 'Return Approved', 'Return Rejected', 'Refund Released'] },
];

export const matchesOrderFilter = (order: SellerOrder, key: string) =>
  key === 'all' || !!orderFilters.find(filter => filter.key === key)?.statuses.includes(order.status);

export const matchesProductFilter = (product: SellerProduct, key: string) =>
  key === 'all' || stockState(product) === key;

// The one-step-at-a-time pipeline the seller order route enforces; the seller can only move
// an order to the stage that directly follows its current one.
export const nextDeliveryStage = (status: string) => ({ Confirmed: 'Processing', Processing: 'Shipped', Shipped: 'Delivered' } as Record<string, string>)[status];
// One entry per real delivery status, so a step index is the status's own position and the
// stepper never has to guess which step an in-between status belongs to.
export const deliverySteps = ['Pending', 'Confirmed', 'Processing', 'Shipped', 'Delivered'];
export const deliveryProgress = (status: string) => deliverySteps.indexOf(status);

export const formatAddress = (address?: SellerOrder['deliveryAddress']) => {
  const parts = [address?.street, address?.city, address?.state, address?.zipCode, address?.country].filter(Boolean);
  return parts.length ? parts.join(', ') : '—';
};
