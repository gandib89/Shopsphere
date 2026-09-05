import type { CatalogProduct } from '../components/catalog/ProductCard';
import type { StorefrontProduct } from '../components/StorefrontView';
import { getImageUrl } from './utils';

export type LiveProduct = CatalogProduct & {
  id?: string;
  brand?: string;
  options?: Array<{ kind: string; value: string; priceDelta: number | string }>;
  variants?: Record<string, string[]>;
  variantStorage?: string[];
  variantColor?: string[];
  variantRam?: string[];
  variantScreenSize?: string[];
  variantProcessor?: string[];
  colorVariants?: { color: string; stock: number }[];
  storageVariants?: { storage: string; stock: number }[];
};

const categoryNames: Record<string, string> = {
  'Mobile Phones': 'iPhone', Laptops: 'MacBook', Tablets: 'iPad',
  Smartwatches: 'Apple Watch', 'Mac Mini': 'Mac mini',
};
export const storefrontCategory = (category: string) => categoryNames[category] || category;

export function toStorefrontProduct(product: LiveProduct): StorefrontProduct {
  const variantGroups = [product.colorVariants, product.storageVariants].filter(group => group?.length);
  const inStock = variantGroups.length
    ? variantGroups.every(group => group!.some(variant => variant.stock > 0))
    : product.quantity > 0;
  const requiresOptions = Boolean(variantGroups.length || [
    ...Object.values(product.variants || {}), product.variantStorage, product.variantColor,
    product.variantRam, product.variantScreenSize, product.variantProcessor,
  ].some(options => options?.length));
  const discount = Math.max(0, Math.min(100, Number(product.discount) || 0));
  const reviews = product.reviews || [];
  return {
    id: product._id || product.id || '',
    name: product.name,
    brand: product.brand,
    category: storefrontCategory(product.category),
    price: product.price * (1 - discount / 100),
    previousPrice: discount ? product.price : undefined,
    rating: reviews.length ? Number((reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length).toFixed(1)) : 0,
    reviews: reviews.length,
    image: product.images?.[0] ? getImageUrl(product.images[0]) : '/images/product-placeholder.svg',
    // Keep seller photographs accurate; do not substitute demo devices or finishes.
    imageBackground: 'white',
    note: !inStock ? 'Currently unavailable' : requiresOptions ? 'Choose your configuration' : storefrontCategory(product.category),
    description: product.description,
    inStock,
    requiresOptions,
    // Upgrades exist, so the catalogue price is a starting point rather than the price.
    priceFrom: (product.options || []).some(option => Number(option.priceDelta) > 0),
  };
}
