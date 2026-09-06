import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { renderRoute } from '../test/render';
import ProductDetailsPage from './ProductDetailsPage';
import { compareStore } from '../lib/compareStore';

vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../components/NavBar', () => ({ default: () => <nav aria-label="Store navigation" /> }));

const get = vi.mocked(axios.get);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  compareStore.clear();
  get.mockImplementation(async url => {
    const path = String(url);
    if (path.includes('/user/details')) return {
      data: { user: { firstName: 'Test', lastName: 'Admin', email: 'admin@example.test' } },
    };
    if (path.includes('/reviews')) return { data: { reviews: [], averageRating: 0 } };
    if (path.includes('/recommendations')) return { data: { recommendations: [] } };
    return {
      data: {
        _id: 'product-1',
        name: 'Test product',
        category: 'Laptops',
        price: 100000,
        description: 'Product description',
        images: ['/images/product-placeholder.svg'],
        quantity: 1,
      },
    };
  });
});

describe('product details page', () => {
  it('opens at the top when navigating from a scrolled catalogue', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

    renderRoute(<ProductDetailsPage />, '/product-details-page?productId=product-1');

    expect(await screen.findByRole('heading', { name: 'Test product' })).toBeVisible();
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'instant' });
  });

  it('keeps in-stock cart and checkout actions available to an authenticated admin', async () => {
    const user = userEvent.setup();
    localStorage.setItem('token', 'session');
    localStorage.setItem('isAdmin', 'true');
    localStorage.setItem('isSeller', 'false');
    vi.mocked(axios.post).mockResolvedValue({ status: 201, data: { success: true } });

    renderRoute(<ProductDetailsPage />, '/product-details-page?productId=product-1');

    const addToCart = await screen.findByRole('button', { name: 'Add to Cart' });
    const buyNow = screen.getByRole('button', { name: 'Buy Now' });
    expect(addToCart).toBeEnabled();
    expect(buyNow).toBeEnabled();

    await user.click(addToCart);
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/cart/add'),
      { productId: 'product-1', quantity: 1, variants: {} },
      expect.any(Object),
    );

    await user.click(buyNow);
    expect(screen.getByRole('heading', { name: 'Checkout' })).toBeVisible();
  });

  it('slides the gallery to the chosen colour and shows a placeholder for an unphotographed one', async () => {
    const user = userEvent.setup();
    get.mockImplementation(async url => {
      const path = String(url);
      if (path.includes('/reviews')) return { data: { reviews: [], averageRating: 0 } };
      if (path.includes('/recommendations')) return { data: { recommendations: [] } };
      return {
        data: {
          _id: 'product-1',
          name: 'Two-tone laptop',
          category: 'Laptops',
          price: 100000,
          description: 'Product description',
          images: ['/images/general.jpg'],
          quantity: 10,
          colorVariants: [
            { color: 'Midnight', stock: 5, images: ['/images/midnight.jpg'] },
            { color: 'Starlight', stock: 5, images: [] },
          ],
        },
      };
    });

    renderRoute(<ProductDetailsPage />, '/product-details-page?productId=product-1');

    expect(await screen.findByRole('heading', { name: 'Two-tone laptop' })).toBeVisible();
    const track = screen.getByAltText('Two-tone laptop in Midnight').closest('div')!.parentElement!;
    expect(track).toHaveStyle({ transform: 'translateX(-0%)' });

    // The colour without photos still gets a frame, so the strip can slide to it.
    const placeholder = screen.getByAltText('Two-tone laptop in Starlight');
    expect(placeholder).toHaveAttribute('src', '/images/product-placeholder.svg');
    expect(screen.getByText('Photo coming soon')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Starlight' }));
    expect(track).toHaveStyle({ transform: 'translateX(-100%)' });
  });

  it('keeps a product picked on the catalogue in the compare tray on the product page', async () => {
    const user = userEvent.setup();
    // Standing in for a pick made on the catalogue before navigating here.
    compareStore.toggle({ id: 'other-phone', name: 'iPhone 16 Pro', category: 'iPhone', price: 120000, image: '/images/pro.jpg' });
    get.mockImplementation(async url => {
      const path = String(url);
      if (path.includes('/reviews')) return { data: { reviews: [], averageRating: 0 } };
      if (path.includes('/recommendations')) return { data: { recommendations: [] } };
      return {
        data: {
          _id: 'product-1',
          name: 'iPhone 16',
          category: 'Mobile Phones',
          price: 100000,
          description: 'Product description',
          images: ['/images/product-placeholder.svg'],
          quantity: 4,
        },
      };
    });

    renderRoute(<ProductDetailsPage />, '/product-details-page?productId=product-1');

    const tray = await screen.findByRole('region', { name: 'Compare products' });
    expect(within(tray).getByText('iPhone 16 Pro')).toBeVisible();
    expect(within(tray).getByRole('button', { name: 'Pick one more' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /Compare/ }));
    expect(compareStore.items().map(item => item.id)).toEqual(['other-phone', 'product-1']);

    await user.click(within(tray).getByRole('button', { name: 'Compare 2' }));
    const dialog = screen.getByRole('dialog', { name: 'Comparing iPhone' });
    expect(within(dialog).getByRole('columnheader', { name: /iPhone 16$/ })).toBeVisible();
    expect(within(dialog).getByRole('row', { name: /^Chip/ })).toHaveTextContent('A18');
  });

  it('renders color and storage only once when both stock variants and priced options exist', async () => {
    get.mockImplementation(async url => {
      const path = String(url);
      if (path.includes('/reviews')) return { data: { reviews: [], averageRating: 0 } };
      if (path.includes('/recommendations')) return { data: { recommendations: [] } };
      return {
        data: {
          _id: 'product-1',
          name: 'Configurable MacBook',
          category: 'Laptops',
          price: 100000,
          description: 'Product description',
          images: ['/images/product-placeholder.svg'],
          quantity: 10,
          colorVariants: [{ color: 'Sky Blue', stock: 5, images: [] }],
          storageVariants: [{ storage: '1TB', stock: 5 }],
          options: [
            { kind: 'color', value: 'Sky Blue', priceDelta: 0, stock: 5 },
            { kind: 'storage', value: '1TB', priceDelta: 5000, stock: 5 },
          ],
        },
      };
    });

    renderRoute(<ProductDetailsPage />, '/product-details-page?productId=product-1');

    expect(await screen.findByRole('heading', { name: 'Configurable MacBook' })).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'Sky Blue' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /1TB/ })).toHaveLength(1);
  });
});
