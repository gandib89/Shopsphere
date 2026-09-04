import { describe, expect, it } from 'vitest';
import { toStorefrontProduct, type LiveProduct } from './storefrontCatalog';

const product: LiveProduct = { _id: 'real-id', name: 'Seller device', category: 'Laptops', price: 100000,
  quantity: 8, description: 'Seller description', images: ['/uploads/real-device.webp'], reviews: [{ rating: 4 }, { rating: 5 }] };

describe('real catalogue presentation', () => {
  it('uses the seller image, real id, ratings and discounted price without demo substitutions', () => {
    expect(toStorefrontProduct({ ...product, discount: 10 })).toMatchObject({
      id: 'real-id', name: 'Seller device', image: '/uploads/real-device.webp', category: 'MacBook',
      price: 90000, previousPrice: 100000, rating: 4.5, reviews: 2, inStock: true, requiresOptions: false,
    });
  });

  it('does not fabricate stock or ratings and provides a neutral missing-image placeholder', () => {
    expect(toStorefrontProduct({ ...product, quantity: 0, reviews: [], images: [] })).toMatchObject({
      inStock: false, note: 'Currently unavailable', rating: 0, reviews: 0, image: '/images/product-placeholder.svg',
    });
  });

  it.each([
    { variants: { storage: ['256GB'] } }, { variantColor: ['Blue'] },
    { colorVariants: [{ color: 'Blue', stock: 4 }] }, { storageVariants: [{ storage: '256GB', stock: 4 }] },
  ])('requires option selection for configurable products: %j', variant => {
    expect(toStorefrontProduct({ ...product, ...variant }).requiresOptions).toBe(true);
  });

  it('does not claim availability when a required variant group is sold out', () => {
    expect(toStorefrontProduct({ ...product, colorVariants: [{ color: 'Blue', stock: 4 }],
      storageVariants: [{ storage: '256GB', stock: 0 }] }).inStock).toBe(false);
  });
});
