import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderRoute } from '../../test/render';
import { Money } from './Money';
import { ProductCard, type CatalogProduct } from './ProductCard';

const product: CatalogProduct = {
  _id: 'product-1',
  name: 'iPhone 17 Pro',
  category: 'Mobile Phones',
  price: 150000,
  quantity: 3,
  description: 'Flagship phone',
  images: ['/images/iphone17.jpg'],
  discount: 20,
  reviews: [{ rating: 5 }, { rating: 4 }],
};

describe('catalog presentation', () => {
  it('formats discounted NPR amounts without hiding the original price', () => {
    renderRoute(<Money amount={120000} previousAmount={150000} />);

    expect(screen.getByText('Rs. 120,000')).toBeVisible();
    expect(screen.getByText('Rs. 150,000')).toBeVisible();
  });

  it('states discount and low inventory in text', () => {
    renderRoute(<ProductCard product={product} onOpen={vi.fn()} />);

    expect(screen.getByText('20% off')).toBeVisible();
    expect(screen.getByText('Only 3 left')).toBeVisible();
    expect(screen.getByText('Rs. 120,000')).toBeVisible();
  });

  it('gives guests one clear product action', () => {
    renderRoute(<ProductCard product={product} onOpen={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'View iPhone 17 Pro' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /add/i })).not.toBeInTheDocument();
  });
});
