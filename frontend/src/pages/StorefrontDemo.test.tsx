import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderRoute } from '../test/render';
import StorefrontDemo from './StorefrontDemo';
import { useLocation } from 'react-router-dom';

function Location() { return <output aria-label="Current route">{useLocation().pathname}</output>; }

describe('UX demo redesign header', () => {
  it('sizes the hero below the header and recalculates its offset when resizing mid-scroll', () => {
    let top = 105;
    const scroll = vi.spyOn(window, 'scrollY', 'get').mockReturnValue(0);
    const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return new DOMRect(0, this.classList.contains('ux-demo-hero-section') ? top - window.scrollY : 0, 1280, 0);
    });
    try {
      const { container, unmount } = renderRoute(<StorefrontDemo />);
      const hero = container.querySelector<HTMLElement>('.ux-demo-hero-section')!;
      expect(hero.style.getPropertyValue('--ux-demo-hero-top')).toBe('105px');
      expect(hero.querySelector('[data-scroll-section]')).toHaveClass('ux-demo-hero-stage');
      scroll.mockReturnValue(500);
      top = 163;
      window.dispatchEvent(new Event('resize'));
      expect(hero.style.getPropertyValue('--ux-demo-hero-top')).toBe('163px');
      unmount();
      top = 200;
      window.dispatchEvent(new Event('resize'));
      expect(hero.style.getPropertyValue('--ux-demo-hero-top')).toBe('163px');
    } finally {
      bounds.mockRestore();
      scroll.mockRestore();
    }
  });

  it('registers the hero, products, about and footer as scroll destinations', () => {
    const { container } = renderRoute(<StorefrontDemo />);
    const sections = container.querySelectorAll('[data-scroll-section]');
    expect(sections).toHaveLength(5);
    expect(sections[0]).toContainElement(screen.getByRole('heading', { name: 'Choose Better Technology.' }));
    expect(sections[1]).toBe(screen.getByRole('region', { name: 'Popular Right Now' }));
    expect(sections[2]).toBe(screen.getByRole('region', { name: 'Shop All Products' }));
    expect(sections[2].querySelector('.storefront-catalog-heading')).toContainElement(screen.getByRole('heading', { name: 'Shop All Products' }));
    expect(sections[3]).toHaveAttribute('id', 'why-shopsphere');
    expect(sections[4]).toHaveAttribute('id', 'contact-us');
  });

  it('uses white backgrounds for dark products and charcoal for light products', () => {
    renderRoute(<StorefrontDemo />);
    for (const [name, background] of [
      ['iPhone 17 Pro Max', 'white'],
      ['MacBook Air M4', 'white'],
      ['Apple Watch Series 10', 'dark'],
      ['3-in-1 MagSafe charger', 'dark'],
      ['Mac mini M4', 'dark'],
      ['Magic Keyboard with Touch ID', 'dark'],
    ]) {
      const card = screen.getByRole('button', { name }).closest('article');
      expect(card?.querySelector('.ux-demo-product-image')).toHaveAttribute('data-background', background);
    }
  });

  it('keeps the same image and background in quick view and bag thumbnails', async () => {
    const user = userEvent.setup();
    renderRoute(<StorefrontDemo />);
    const card = screen.getByRole('button', { name: 'Apple Watch Series 10' });
    const imagePath = card.closest('article')?.querySelector('img')?.getAttribute('src');
    await user.click(card);
    const details = screen.getByRole('dialog', { name: 'Apple Watch Series 10' });
    const image = within(details).getByRole('img', { name: 'Apple Watch Series 10' });
    expect(image).toHaveAttribute('src', imagePath);
    expect(image.parentElement).toHaveAttribute('data-background', 'dark');
    expect(image).toHaveClass('object-contain');
    await user.click(within(details).getByRole('button', { name: /Add to cart/ }));
    await user.click(screen.getByRole('button', { name: 'Shopping bag with 1 items' }));
    const thumbnail = screen.getByRole('dialog', { name: 'Your bag' }).querySelector('img');
    expect(thumbnail).toHaveAttribute('src', imagePath);
    expect(thumbnail).toHaveAttribute('data-background', 'dark');
    expect(thumbnail).toHaveClass('object-contain');
  });

  it('keeps navigation and searches from the visible header field', async () => {
    const user = userEvent.setup();
    renderRoute(<StorefrontDemo />, '/ux-demo');
    const nav = screen.getByRole('navigation', { name: 'Demo navigation' });
    expect(within(nav).getAllByRole('button').map((button) => button.textContent)).toEqual(['Shop', 'About us', 'Contact']);
    expect(screen.getByRole('link', { name: 'ShopSphere demo home' })).toHaveAttribute('href', '/ux-demo');
    const search = screen.getByRole('search', { name: 'Product search' });
    const input = within(search).getByRole('searchbox', { name: 'Search products' });
    expect(input).toHaveAttribute('placeholder', 'Search products...');
    await user.type(input, 'MacBook');
    expect(screen.getByRole('region', { name: 'Popular Right Now' })).toBeVisible();
    await user.click(within(search).getByRole('button', { name: 'Search' }));
    const results = screen.getByRole('region', { name: 'Search results for “MacBook”' });
    expect(within(results).getByRole('heading', { name: 'MacBook Air M4' })).toBeVisible();
    expect(within(results).queryByRole('heading', { name: 'iPhone 17 Pro Max' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('submits with Enter and clears the search', async () => {
    const user = userEvent.setup();
    renderRoute(<StorefrontDemo />);
    const input = screen.getByRole('searchbox', { name: 'Search products' });
    await user.type(input, '  macbook  {Enter}');
    const results = screen.getByRole('region', { name: 'Search results for “macbook”' });
    expect(within(results).getByRole('heading', { name: 'MacBook Air M4' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(input).toHaveValue('');
    expect(screen.getByRole('region', { name: 'Popular Right Now' })).toBeVisible();
  });

  it('handles no matches and an empty search', async () => {
    const user = userEvent.setup();
    renderRoute(<StorefrontDemo />);
    const input = screen.getByRole('searchbox', { name: 'Search products' });
    await user.type(input, 'no-such-device{Enter}');
    expect(screen.getByRole('heading', { name: 'No demo products match' })).toBeVisible();
    await user.clear(input);
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(screen.getByRole('region', { name: 'Popular Right Now' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'No demo products match' })).not.toBeInTheDocument();
  });

  it('stays in light mode without a theme toggle and preserves the dark hero', () => {
    const { container } = renderRoute(<StorefrontDemo />);
    expect(container.querySelector('.ux-demo')).toHaveAttribute('data-theme', 'light');
    expect(container.querySelector('.ux-demo-header-theme')).toHaveClass('theme-light');
    expect(container.querySelector('.theme-dark')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Use (dark|light) theme/, hidden: true })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Choose Better Technology.' })).toBeVisible();
    expect(screen.getByRole('img', { name: /arranged on a dark studio surface/ })).toHaveAttribute('src', '/images/shopsphere-redesign-hero.webp');
  });

  it('shows the existing cart items in the header bag and removes them', async () => {
    const user = userEvent.setup();
    renderRoute(<StorefrontDemo />);
    await user.click(screen.getByRole('button', { name: 'Shopping bag with 0 items' }));
    expect(screen.getByText('Your bag is empty')).toBeVisible();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const catalogue = screen.getByRole('region', { name: 'Popular Right Now' });
    await user.click(within(catalogue).getByRole('button', { name: 'Popular product: iPhone 17 Pro Max' }));
    await user.click(within(screen.getByRole('dialog', { name: 'iPhone 17 Pro Max' })).getByRole('button', { name: /Add to cart/ }));
    await user.click(screen.getByRole('button', { name: 'Shopping bag with 1 items' }));
    const bag = screen.getByRole('dialog', { name: 'Your bag' });
    expect(within(bag).getByRole('heading', { name: 'iPhone 17 Pro Max' })).toBeVisible();
    expect(within(bag).getByText('Quantity: 1')).toBeVisible();
    await user.click(within(bag).getByRole('button', { name: 'Remove iPhone 17 Pro Max from bag' }));
    expect(within(bag).getByText('Your bag is empty')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Shopping bag with 0 items' })).toBeInTheDocument();
  });

  it('keeps Shop connected to products and uses the hero CTA for sign in', async () => {
    const user = userEvent.setup();
    renderRoute(<><StorefrontDemo /><Location /></>);
    const input = screen.getByRole('searchbox', { name: 'Search products' });
    await user.type(input, 'MacBook{Enter}');
    await user.click(within(screen.getByRole('navigation', { name: 'Demo navigation' })).getByRole('button', { name: 'Shop' }));
    expect(input).toHaveValue('');
    expect(within(screen.getByRole('region', { name: 'Popular Right Now' })).getByRole('heading', { name: 'iPhone 17 Pro Max' })).toBeVisible();
    await user.type(input, 'MacBook{Enter}');
    await user.click(screen.getByRole('button', { name: 'Sign in to ShopSphere' }));
    expect(screen.getByRole('status', { name: 'Current route' })).toHaveTextContent('/auth');
  });

  it('closes the compact mobile menu after navigation', async () => {
    const user = userEvent.setup();
    renderRoute(<StorefrontDemo />);
    // Responsive visibility is checked in-browser; jsdom does not evaluate media queries.
    await user.click(screen.getByLabelText('Open menu'));
    const mobileNav = screen.getByLabelText('Mobile demo navigation');
    await user.click(within(mobileNav).getByText('Contact', { exact: true }));
    expect(screen.queryByLabelText('Mobile demo navigation')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Open menu')).toHaveAttribute('aria-expanded', 'false');
  });

  it('flows directly from the hero to products without categories or the delivery promotion', () => {
    renderRoute(<StorefrontDemo />);
    expect(screen.queryByText('Delivery that matches the purchase')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /See delivery details/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Shop by category' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Shop by categories' })).not.toBeInTheDocument();
    expect(screen.queryByText('Start with what you need')).not.toBeInTheDocument();
    const hero = screen.getByRole('heading', { name: 'Choose Better Technology.' }).closest('section');
    expect(hero?.nextElementSibling).toBe(screen.getByRole('region', { name: 'Popular Right Now' }));
  });

  it('removes the hero trust strip while preserving the information section', () => {
    renderRoute(<StorefrontDemo />);
    const hero = screen.getByRole('heading', { name: 'Choose Better Technology.' }).closest('section') as HTMLElement;
    expect(within(hero).queryByText('Approved sellers')).not.toBeInTheDocument();
    expect(within(hero).queryByText('Secure eSewa')).not.toBeInTheDocument();
    expect(within(hero).queryByText('Delivery across Nepal')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Approved sellers' })).toBeVisible();
  });

  it('uses image-led product cards with quick add and details in the drawer', async () => {
    const user = userEvent.setup();
    renderRoute(<StorefrontDemo />);
    const catalogue = screen.getByRole('region', { name: 'Popular Right Now' });
    const card = within(catalogue).getByRole('button', { name: 'Popular product: MacBook Air M4' });
    expect(card).toHaveAccessibleDescription('13-inch · 16GB memory');
    expect(card).toHaveAttribute('aria-haspopup', 'dialog');
    expect(card.closest('article')?.querySelector('img')).toHaveAttribute('src', '/images/macairmidnight.jpg');
    expect(within(catalogue).getByRole('button', { name: 'Popular product: Add to cart: MacBook Air M4' })).toBeInTheDocument();
    expect(within(catalogue).queryByText(/NPR/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next products' })).not.toBeInTheDocument();
    await user.click(card);
    const details = screen.getByRole('dialog', { name: 'MacBook Air M4' });
    expect(within(details).getByText('NPR 164,500')).toBeVisible();
    expect(within(details).getByText('In stock')).toBeVisible();
    expect(within(details).getByRole('button', { name: /Add to cart/ })).toBeVisible();
    await user.click(within(details).getByRole('button', { name: 'Close quick view' }));
    expect(card).toHaveFocus();
  });

  it('leaves wheel gestures native and advances one visible group per button click', async () => {
    const user = userEvent.setup();
    const clientWidth = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('ux-demo-product-grid--scroll') ? 768 : 0;
    });
    const scrollWidth = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('ux-demo-product-grid--scroll') ? 2000 : 0;
    });
    try {
      const { container } = renderRoute(<StorefrontDemo />);
      const strip = container.querySelector<HTMLElement>('.ux-demo-product-grid--scroll')!;
      const stripScrollBy = vi.mocked(strip.scrollBy);

      fireEvent.wheel(strip, { deltaY: 120 });
      fireEvent.wheel(strip, { deltaX: 120 });
      expect(stripScrollBy).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: 'Show more products' }));
      expect(stripScrollBy).toHaveBeenCalledTimes(1);
      expect(stripScrollBy).toHaveBeenLastCalledWith({ left: 784, behavior: 'smooth' });
    } finally {
      clientWidth.mockRestore();
      scrollWidth.mockRestore();
    }
  });

  it('adds directly from a product card without opening quick view and supports repeat adds', async () => {
    const user = userEvent.setup();
    renderRoute(<StorefrontDemo />);
    const add = screen.getByRole('button', { name: 'Add to cart: MacBook Air M4' });
    await user.click(add);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(add).toHaveTextContent('Added to bag');
    expect(screen.getByRole('button', { name: 'Shopping bag with 1 items' })).toBeInTheDocument();
    await user.click(add);
    await user.click(screen.getByRole('button', { name: 'Shopping bag with 2 items' }));
    const bag = screen.getByRole('dialog', { name: 'Your bag' });
    expect(within(bag).getByRole('heading', { name: 'MacBook Air M4' })).toBeVisible();
    expect(within(bag).getByText('Quantity: 2')).toBeVisible();
  });

  it('supports keyboard quick add and does not return focus to a previously opened product', async () => {
    const user = userEvent.setup();
    renderRoute(<StorefrontDemo />);
    await user.click(screen.getByRole('button', { name: 'iPhone 17 Pro Max' }));
    await user.click(screen.getByRole('button', { name: 'Close quick view' }));
    screen.getByRole('button', { name: 'MacBook Air M4' }).focus();
    await user.tab();
    const add = screen.getByRole('button', { name: 'Add to cart: MacBook Air M4' });
    expect(add).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(add).toHaveFocus();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Shopping bag with 1 items' })).toBeInTheDocument();
  });

  it('opens product cards with the keyboard and restores focus after closing', async () => {
    const user = userEvent.setup();
    renderRoute(<StorefrontDemo />);
    const card = screen.getByRole('button', { name: 'Apple Watch Series 10' });
    card.focus();
    await user.keyboard('{Enter}');
    const details = screen.getByRole('dialog', { name: 'Apple Watch Series 10' });
    const close = within(details).getByRole('button', { name: 'Close quick view' });
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(within(details).getByRole('button', { name: /Add to cart/ })).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(card).toHaveFocus();
  });

  it('opens category choices from search and filters to the selected category', async () => {
    const user = userEvent.setup();
    renderRoute(<StorefrontDemo />);
    expect(screen.queryByRole('group', { name: 'Search by category' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('searchbox', { name: 'Search products' }));
    const options = screen.getByRole('group', { name: 'Search by category' });
    expect(within(options).getAllByRole('button').map((button) => button.textContent)).toEqual(['All categories', 'iPhone', 'MacBook', 'Apple Watch', 'Accessories', 'Mac mini']);
    await user.click(within(options).getByRole('button', { name: 'MacBook' }));
    expect(screen.queryByRole('group', { name: 'Search by category' })).not.toBeInTheDocument();
    const results = screen.getByRole('region', { name: 'MacBook' });
    expect(within(results).getByRole('button', { name: 'MacBook Air M4' })).toBeVisible();
    expect(within(results).queryByRole('button', { name: 'iPhone 17 Pro Max' })).not.toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toHaveAttribute('placeholder', 'Search MacBook...');
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('region', { name: 'Popular Right Now' })).toBeVisible();
    expect(screen.getByRole('searchbox')).toHaveAttribute('placeholder', 'Search products...');
  });

  it('combines typed search with category selection and can return to all categories', async () => {
    const user = userEvent.setup();
    renderRoute(<StorefrontDemo />);
    await user.type(screen.getByRole('searchbox'), 'MacBook');
    await user.click(within(screen.getByRole('group', { name: 'Search by category' })).getByRole('button', { name: 'iPhone' }));
    expect(screen.getByRole('heading', { name: 'No demo products match' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Search by category' }));
    const options = screen.getByRole('group', { name: 'Search by category' });
    expect(within(options).getByRole('button', { name: 'iPhone' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(options).getByRole('button', { name: 'All categories' }));
    const results = screen.getByRole('region', { name: 'Search results for “MacBook”' });
    expect(within(results).getByRole('button', { name: 'MacBook Air M4' })).toBeVisible();
  });

  it('opens categories from an empty Search button and dismisses on Escape or outside click', async () => {
    const user = userEvent.setup();
    renderRoute(<StorefrontDemo />);
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(screen.getByRole('group', { name: 'Search by category' })).toBeVisible();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('group', { name: 'Search by category' })).not.toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toHaveFocus();
    await user.click(screen.getByRole('searchbox'));
    await user.click(screen.getByRole('heading', { name: 'Choose Better Technology.' }));
    expect(screen.queryByRole('group', { name: 'Search by category' })).not.toBeInTheDocument();
  });

  it('supports arrow-key category selection', async () => {
    const user = userEvent.setup();
    renderRoute(<StorefrontDemo />);
    await user.click(screen.getByRole('searchbox'));
    await user.keyboard('{ArrowDown}');
    expect(await screen.findByRole('button', { name: 'All categories' })).toHaveFocus();
    await user.keyboard('{ArrowRight}{ArrowRight}{Enter}');
    expect(screen.getByRole('region', { name: 'MacBook' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Search by category' })).toHaveFocus();
  });
  it('compares products within one category and locks out every other category', async () => {
    const user = userEvent.setup();
    renderRoute(<StorefrontDemo />);
    await user.click(screen.getByRole('button', { name: 'Compare 3-in-1 MagSafe charger' }));
    expect(screen.getByRole('button', { name: 'Compare Apple Watch Series 10' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Compare Magic Keyboard with Touch ID' })).toBeEnabled();
    const tray = screen.getByRole('region', { name: 'Compare products' });
    expect(within(tray).getByRole('button', { name: 'Pick one more' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Compare Magic Keyboard with Touch ID' }));
    await user.click(within(tray).getByRole('button', { name: 'Compare 2' }));
    const dialog = screen.getByRole('dialog', { name: 'Comparing Accessories' });
    expect(within(dialog).getByRole('columnheader', { name: /3-in-1 MagSafe charger/ })).toBeVisible();
    expect(within(dialog).getByRole('columnheader', { name: /Magic Keyboard with Touch ID/ })).toBeVisible();
    expect(within(dialog).getByRole('row', { name: /Price/ })).toHaveTextContent('NPR 12,500');
    expect(within(dialog).queryByRole('columnheader', { name: /Apple Watch/ })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Close comparison' }));
    await user.click(within(tray).getByRole('button', { name: 'Clear' }));
    expect(screen.queryByRole('region', { name: 'Compare products' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Compare Apple Watch Series 10' })).toBeEnabled();
  });
});
