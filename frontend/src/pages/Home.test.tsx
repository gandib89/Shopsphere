import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { toast } from 'sonner';
import { useLocation } from 'react-router-dom';
import { renderRoute } from '../test/render';
import Home from './Home';
import type { LiveProduct } from '../lib/storefrontCatalog';

vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn(), isAxiosError: (error: { isAxiosError?: boolean }) => error?.isAxiosError === true } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../lib/session', () => ({ clearSession: vi.fn() }));
vi.mock('../components/NotificationBell', () => ({ default: () => <button>Notifications</button> }));

const listings: LiveProduct[] = [
  { _id: 'server-mac', name: 'Seller MacBook', category: 'Laptops', price: 100000, discount: 10, quantity: 4,
    description: 'Actual seller description', images: ['/uploads/mac.webp'], reviews: [{ rating: 5 }] },
  { _id: 'server-phone', name: 'Seller iPhone', category: 'Mobile Phones', price: 80000, quantity: 0,
    description: 'Sold-out device', images: ['/uploads/phone.webp'], reviews: [] },
  { _id: 'server-watch', name: 'Seller Watch', category: 'Smartwatches', price: 50000, quantity: 5,
    description: 'Pick a finish', images: ['/uploads/watch.webp'], colorVariants: [{ color: 'Silver', stock: 5 }] },
];
function RouteProbe() { const location = useLocation(); return <output data-testid="route">{location.pathname}{location.search}</output>; }
const renderHome = (path = '/') => renderRoute(<><Home /><RouteProbe /></>, path);
const get = vi.mocked(axios.get);
const post = vi.mocked(axios.post);
const signedIn = (role = 'buyer') => {
  localStorage.setItem('token', 'session');
  localStorage.setItem('isAdmin', String(role === 'admin'));
  localStorage.setItem('isSeller', String(role === 'seller'));
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  get.mockImplementation(async url => ({ data: String(url).endsWith('/cart/get') ? { data: { items: [{ quantity: 2 }] } } : listings }));
  post.mockResolvedValue({ data: { success: true, data: { items: [{ quantity: 3 }] } } });
});
afterEach(() => localStorage.clear());

describe('live storefront integration', () => {
  it('preserves native wheel input across the storefront, including small deltas and momentum', async () => {
    const { container } = renderHome();
    await screen.findByRole('button', { name: 'Seller MacBook' });
    const targets = [
      container.querySelector('.ux-demo-hero-stage')!,
      screen.getByRole('region', { name: 'Shop By Category' }),
      container.querySelector('.ux-demo-product-grid--scroll')!,
      container.querySelector('.storefront-catalog-page-slider')!,
      container.querySelector('#why-shopsphere')!,
    ];
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    try {
      for (const target of targets) {
        for (const init of [{ deltaY: 5 }, { deltaY: 120 }, { deltaY: 30 }, { deltaY: -120 }, { deltaX: 120 }, { deltaY: 120, shiftKey: true }]) {
          const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
          fireEvent(target, event);
          expect(event.defaultPrevented, `Wheel input at ${target.className}: ${JSON.stringify(init)}`).toBe(false);
        }
      }
      expect(scrollTo).not.toHaveBeenCalled();
    } finally {
      scrollTo.mockRestore();
    }
  });

  it('shows real listings to guests with the approved hero and no demo products', async () => {
    const { container } = renderHome();
    expect(screen.getByRole('heading', { name: 'Choose Better Technology.' })).toBeVisible();
    const card = await screen.findByRole('button', { name: 'Seller MacBook' });
    expect(card.closest('article')?.querySelector('img')).toHaveAttribute('src', '/uploads/mac.webp');
    expect(within(card.closest('article')!).getByText('NPR 90,000')).toBeVisible();
    expect(screen.queryByText('iPhone 17 Pro Max')).not.toBeInTheDocument();
    expect(screen.queryByText(/Demo bag only/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ShopSphere home' })).toHaveAttribute('href', '/');
    // Hero, Shop by category, popular products, full catalogue, about and footer.
    expect(container.querySelectorAll('[data-scroll-section]')).toHaveLength(6);
    const categories = screen.getByRole('region', { name: 'Shop By Category' });
    expect(within(categories).getByRole('link', { name: /MacBook/ })).toHaveAttribute('href', '/?category=MacBook');
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('keeps Popular Right Now top-rated and independent from catalogue controls', async () => {
    const user = userEvent.setup();
    renderHome();
    await screen.findByRole('button', { name: 'Seller MacBook' });
    expect(screen.queryByLabelText('Sort products')).not.toBeInTheDocument();
    const popular = screen.getByRole('region', { name: 'Popular Right Now' });
    const cards = popular.querySelectorAll('article');
    expect(cards[0]).toHaveTextContent('Seller MacBook');
    const popularStrip = popular.querySelector('.ux-demo-product-grid--scroll') as HTMLElement;
    const popularScrollCalls = () => vi.mocked(popularStrip.scrollTo).mock.contexts.filter(context => context === popularStrip).length;
    await waitFor(() => expect(popularScrollCalls()).toBeGreaterThan(0));
    const callsBeforeFiltering = popularScrollCalls();
    await user.click(screen.getByRole('checkbox', { name: 'In stock' }));
    expect(popularScrollCalls()).toBe(callsBeforeFiltering);
    const input = screen.getByRole('searchbox');
    await user.type(input, 'Seller');
    await user.click(within(screen.getByRole('group', { name: 'Search by category' })).getByRole('button', { name: 'MacBook' }));
    const results = screen.getByRole('region', { name: 'Search results for “Seller”' });
    expect(within(results).getByRole('heading', { name: 'Seller MacBook' })).toBeVisible();
    expect(within(results).queryByRole('heading', { name: 'Seller Watch' })).not.toBeInTheDocument();
    expect(within(popular).getByRole('heading', { name: 'Seller Watch' })).toBeVisible();
  });

  it('preserves category links from the footer', async () => {
    renderHome('/?category=Apple+Watch');
    const results = screen.getByRole('region', { name: 'Apple Watch' });
    expect(await within(results).findByRole('heading', { name: 'Seller Watch' })).toBeVisible();
    expect(within(results).queryByRole('heading', { name: 'Seller MacBook' })).not.toBeInTheDocument();
  });

  it('sends guests to sign in without making a cart request', async () => {
    const user = userEvent.setup();
    renderHome();
    await user.click(await screen.findByRole('button', { name: 'Add to cart: Seller MacBook' }));
    await waitFor(() => expect(screen.getByTestId('route')).toHaveTextContent('/auth'));
    expect(post).not.toHaveBeenCalled();
  });

  it('supports skipping to content without changing the application route', async () => {
    const user = userEvent.setup();
    renderHome();
    await user.click(screen.getByRole('link', { name: 'Skip to store content' }));
    expect(screen.getByRole('main')).toHaveFocus();
    expect(screen.getByTestId('route')).toHaveTextContent(/^\/$/);
  });

  it('replaces broken seller images with a neutral placeholder', async () => {
    renderHome();
    const card = await screen.findByRole('button', { name: 'Seller MacBook' });
    const image = card.closest('article')!.querySelector('img')!;
    fireEvent.error(image);
    expect(image).toHaveAttribute('src', '/images/product-placeholder.svg');
  });

  it('redirects an expired session after a rejected cart request', async () => {
    signedIn();
    post.mockRejectedValueOnce({ isAxiosError: true, response: { status: 401 } });
    const user = userEvent.setup();
    renderHome();
    await user.click(await screen.findByRole('button', { name: 'Add to cart: Seller MacBook' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/auth');
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('adds a real product once, waits for confirmation and updates the server bag count', async () => {
    signedIn();
    let complete: (response: unknown) => void = () => {};
    post.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const user = userEvent.setup();
    renderHome();
    expect(await screen.findByRole('button', { name: 'Shopping bag with 2 items' })).toBeVisible();
    const add = await screen.findByRole('button', { name: 'Add to cart: Seller MacBook' });
    await user.click(add);
    expect(add).toBeDisabled();
    expect(add).toHaveTextContent('Adding…');
    await user.click(add);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(expect.stringContaining('/cart/add'), { productId: 'server-mac', quantity: 1 });
    await act(async () => complete({ data: { data: { items: [{ quantity: 3 }] } } }));
    expect(add).toHaveTextContent('Added to bag');
    await user.click(screen.getByRole('button', { name: 'Shopping bag with 3 items' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/cart');
    expect(screen.queryByRole('dialog', { name: 'Your bag' })).not.toBeInTheDocument();
  });

  it('does not report success when cart updates fail and allows retry', async () => {
    signedIn();
    post.mockRejectedValueOnce(new Error('Connection failed'));
    const user = userEvent.setup();
    renderHome();
    const add = await screen.findByRole('button', { name: 'Add to cart: Seller MacBook' });
    await user.click(add);
    expect(add).toHaveTextContent('Add to cart');
    expect(add).toBeEnabled();
    expect(toast.error).toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    await user.click(add);
    expect(toast.success).toHaveBeenCalled();
  });

  it('disables sold-out purchases and routes option selection through the existing detail page', async () => {
    signedIn();
    const user = userEvent.setup();
    renderHome();
    expect(await screen.findByRole('button', { name: 'Sold out: Seller iPhone' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Choose options: Seller Watch' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/products/server-watch');
    expect(post).not.toHaveBeenCalled();
  });

  it('shows real quick-view information and links to full product details', async () => {
    const user = userEvent.setup();
    renderHome();
    await user.click(await screen.findByRole('button', { name: 'Seller iPhone' }));
    const dialog = screen.getByRole('dialog', { name: 'Seller iPhone' });
    expect(within(dialog).getByText('No reviews yet')).toBeVisible();
    expect(within(dialog).getByText('Sold out')).toBeVisible();
    expect(within(dialog).getByText('Sold-out device')).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: /^View details ·/ })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'View full product details' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/products/server-phone');
  });

  it('shows only the full-details action in quick view when a product requires options', async () => {
    signedIn();
    const user = userEvent.setup();
    renderHome();
    await user.click(await screen.findByRole('button', { name: 'Seller Watch' }));
    const dialog = screen.getByRole('dialog', { name: 'Seller Watch' });
    expect(within(dialog).getByRole('button', { name: 'View full product details' })).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: /^Choose options ·/ })).not.toBeInTheDocument();
  });

  it('uses the same single full-details action for directly purchasable quick views', async () => {
    signedIn();
    const user = userEvent.setup();
    renderHome();
    await user.click(await screen.findByRole('button', { name: 'Seller MacBook' }));
    const dialog = screen.getByRole('dialog', { name: 'Seller MacBook' });
    expect(within(dialog).getByRole('button', { name: 'View full product details' })).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: /^Add to cart ·/ })).not.toBeInTheDocument();
  });

  it.each([['admin', '/admin'], ['seller', '/seller-panel'], ['buyer', '/profile']])('preserves the %s account route', async (role, path) => {
    signedIn(role);
    const user = userEvent.setup();
    renderHome();
    await screen.findByRole('button', { name: 'Seller MacBook' });
    if (role !== 'buyer') expect(screen.queryByRole('button', { name: 'Add to cart: Seller MacBook' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Your account' }));
    expect(screen.getByTestId('route')).toHaveTextContent(path);
  });

  it('has a retryable catalogue error rather than substituting demo inventory', async () => {
    get.mockRejectedValueOnce(new Error('offline'));
    const user = userEvent.setup();
    renderHome();
    expect(await screen.findByText('We couldn’t load the catalogue')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Seller MacBook' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Seller MacBook' })).toBeVisible();
  });

  it('shows an honest empty catalogue and does not invent an empty bag on a cart read failure', async () => {
    signedIn();
    get.mockImplementation(async url => {
      if (String(url).endsWith('/cart/get')) throw new Error('offline');
      return { data: [] };
    });
    renderHome();
    expect(await screen.findByText('No products available')).toBeVisible();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Shopping bag' })).toBeVisible());
    expect(screen.queryByRole('button', { name: 'Shopping bag with 0 items' })).not.toBeInTheDocument();
  });
});


describe('catalog sidebar filters', () => {
  it('shows six-product catalogue pages with filters before switching to the full grid', async () => {
    const user = userEvent.setup();
    renderHome();
    await screen.findByRole('button', { name: 'Seller MacBook' });

    expect(screen.getByLabelText('Minimum price')).toBeVisible();
    expect(document.querySelector('.storefront-catalog-page')).toBeInTheDocument();
    expect(document.querySelector('.ux-demo-products-panel--catalogue')).toHaveAttribute('data-section-scroll-ignore');

    await user.click(screen.getByRole('button', { name: 'Show all products' }));
    expect(screen.getByLabelText('Minimum price')).toBeVisible();
    expect(document.querySelector('.storefront-catalog-full-grid')).toBeInTheDocument();
    expect(document.querySelector('.ux-demo-products-panel--catalogue')).toHaveAttribute('data-section-scroll-ignore');
    expect(screen.getByRole('button', { name: 'Show slider' })).toBeVisible();
  });

  it('applies discounted price bounds, combines stock and brand, and resets results', async () => {
    const user = userEvent.setup();
    renderHome();
    await screen.findByRole('button', { name: 'Seller MacBook' });
    const minimum = screen.getByLabelText('Minimum price');
    await user.clear(minimum);
    await user.type(minimum, '85000');
    expect(screen.getByRole('button', { name: 'Seller iPhone' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.queryByRole('button', { name: 'Seller iPhone' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Seller MacBook' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reset filters' }));
    await user.click(screen.getByRole('checkbox', { name: 'Apple' }));
    expect(screen.getByRole('button', { name: 'Seller Watch' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.queryByRole('button', { name: 'Seller Watch' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'In stock' }));
    expect(screen.getByRole('button', { name: 'Seller iPhone' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.queryByRole('button', { name: 'Seller iPhone' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'iPhone' }));
    expect(screen.getByRole('button', { name: 'Seller MacBook' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByText('No matching products')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show all products' }));
    expect(screen.getByRole('button', { name: 'Seller Watch' })).toBeInTheDocument();
  });

  it('prioritizes the most recently selected filter option after Apply', async () => {
    const user = userEvent.setup();
    renderHome();
    await screen.findByRole('button', { name: 'Seller MacBook' });
    const catalogue = screen.getByRole('region', { name: 'Shop All Products' });

    await user.click(screen.getByRole('checkbox', { name: 'MacBook' }));
    await user.click(screen.getByRole('checkbox', { name: 'iPhone' }));
    expect(catalogue.querySelectorAll('article')[0]).toHaveTextContent('Seller MacBook');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(catalogue.querySelectorAll('article')[0]).toHaveTextContent('Seller iPhone');
  });

  it('rejects inverted price bounds and keeps slider inputs synchronized', async () => {
    const user = userEvent.setup();
    renderHome();
    await screen.findByRole('button', { name: 'Seller MacBook' });
    fireEvent.change(screen.getByLabelText('Minimum price slider'), { target: { value: '70000' } });
    expect(screen.getByLabelText('Minimum price')).toHaveValue(70000);
    fireEvent.change(screen.getByLabelText('Maximum price'), { target: { value: '60000' } });
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Seller MacBook' })).toBeInTheDocument();
    await user.click(screen.getByText('Filters', { selector: 'summary' }));
    expect(screen.getByText('Filters', { selector: 'summary' }).parentElement).not.toHaveAttribute('open');
  });
});
