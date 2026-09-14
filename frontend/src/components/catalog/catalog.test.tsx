import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderRoute } from '../../test/render';
import type { StorefrontProduct } from '../StorefrontView';
import CatalogFilters, { emptyFilters } from './CatalogFilters';
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

const filterProducts: StorefrontProduct[] = [
  { id: 'iphone', name: 'iPhone 17 Pro', category: 'Phones', brand: 'Apple', price: 150000, rating: 5, reviews: 1, image: '', imageBackground: 'white', note: '', inStock: true },
  { id: 'speaker', name: 'Marshall Speaker', category: 'Audio', brand: 'Marshall', price: 30000, rating: 4, reviews: 1, image: '', imageBackground: 'white', note: '', inStock: false },
];

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

describe('catalog filters', () => {
  it('applies checkbox filters immediately without the price Apply button', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderRoute(<CatalogFilters products={filterProducts} value={emptyFilters} onChange={onChange} />);

    expect(within(screen.getByRole('group', { name: 'Price' })).getByRole('button', { name: 'Apply' })).toBeVisible();

    await user.click(screen.getByRole('checkbox', { name: 'In stock' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...emptyFilters, inStock: true });

    await user.click(screen.getByRole('checkbox', { name: 'Apple' }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...emptyFilters,
      brands: ['Apple'],
      priority: [{ field: 'brands', value: 'Apple' }],
    });

    await user.click(screen.getByRole('checkbox', { name: 'Audio' }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...emptyFilters,
      types: ['Audio'],
      priority: [{ field: 'types', value: 'Audio' }],
    });
  });
});
