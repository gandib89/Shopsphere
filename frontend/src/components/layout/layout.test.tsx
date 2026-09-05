import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderRoute } from '../../test/render';
import ChatWidget from '../ChatWidget';
import Footer from '../Footer';
import NavBar from '../NavBar';

describe('global ShopSphere chrome', () => {
  beforeEach(() => localStorage.clear());

  it('exposes the mobile menu state to assistive technology', async () => {
    const user = userEvent.setup();
    renderRoute(<NavBar />);

    const trigger = screen.getByRole('button', { name: 'Open menu' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.click(trigger);
    expect(screen.getByRole('button', { name: 'Close menu' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('marks the current customer page in navigation', () => {
    localStorage.setItem('token', 'test-session');
    renderRoute(<NavBar />, '/cart');
    expect(screen.getByRole('link', { name: 'Cart' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
  });

  it('renders a single semantic footer', () => {
    renderRoute(<Footer />);
    expect(screen.getAllByRole('contentinfo')).toHaveLength(1);
  });

  it('opens and closes the assistant with named controls', async () => {
    const user = userEvent.setup();
    renderRoute(<ChatWidget />);

    await user.click(screen.getByRole('button', { name: 'Open ShopSphere assistant' }));
    expect(screen.getByRole('dialog', { name: 'ShopSphere assistant' })).toBeVisible();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'ShopSphere assistant' })).not.toBeInTheDocument();
  });
});
