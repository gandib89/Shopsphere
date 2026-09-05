import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import axios from 'axios';
import { renderRoute } from '../test/render';
import { authFetch } from '../lib/session';
import SellerLayout from '../components/seller/SellerLayout';
import SellerPanel from './SellerPanel';
import SellerProducts from './SellerProducts';
import SellerOrders from './SellerOrders';
import SellerProductDetails from './SellerProductDetails';
import type { SellerOrder, SellerProduct } from '../lib/sellerData';

vi.mock('../lib/session', () => ({ authFetch: vi.fn(), logout: vi.fn() }));
vi.mock('../components/NotificationBell', () => ({ default: () => <button>Notifications</button> }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const product = (id: string, quantity: number, name = 'MacBook ' + id): SellerProduct => ({ _id: id, name, category: 'Laptops', price: 1000, quantity, images: [] });
const order = (id: string, status = 'Confirmed'): SellerOrder => ({ _id: id, firstName: 'Asha', lastName: id, email: id + '@example.test', quantity: 1, totalPrice: 100, status, createdAt: new Date().toISOString(), product: { name: 'MacBook ' + id } });

beforeEach(() => { vi.resetAllMocks(); vi.spyOn(window, 'confirm').mockReturnValue(true); vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); });

describe('seller workspace shell', () => {
  it('names the shop, marks the open screen, and hides the storefront navbar', async () => {
    vi.mocked(authFetch).mockResolvedValue(response({ shopName: 'Asha Devices', isVerified: true }));
    renderRoute(<Routes><Route element={<SellerLayout />}><Route path="*" element={<p>Workspace content</p>} /></Route></Routes>, '/seller-orders');
    expect(await screen.findAllByText('Asha Devices')).not.toHaveLength(0);
    expect(screen.getByRole('link', { name: 'Orders' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
    expect(screen.getByText('Workspace content')).toBeVisible();
    expect(screen.queryByRole('link', { name: /Cart/ })).not.toBeInTheDocument();
  });
  it('has one product destination and returns focus when mobile navigation closes', async () => {
    vi.mocked(authFetch).mockResolvedValue(response({ shopName: 'Asha Devices', isVerified: true }));
    const user = userEvent.setup();
    renderRoute(<Routes><Route element={<SellerLayout />}><Route path="*" element={<p>Workspace content</p>} /></Route></Routes>, '/seller-products');
    expect(screen.getAllByRole('link', { name: 'Products' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Products' })).toHaveAttribute('aria-current', 'page');
    // JSDOM does not apply responsive media queries.
    (document.querySelector('.admin-mobile-toggle') as HTMLElement).style.display = 'grid';
    await user.click(screen.getByRole('button', { name: 'Open seller navigation' }));
    expect(screen.getByRole('link', { name: 'Home' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Open seller navigation' })).toHaveFocus();
  });
  it('tells an unapproved seller their listings are not live yet', async () => {
    vi.mocked(authFetch).mockResolvedValue(response({ shopName: 'Asha Devices', isVerified: false }));
    renderRoute(<Routes><Route element={<SellerLayout />}><Route path="*" element={<p>Workspace content</p>} /></Route></Routes>, '/seller-panel');
    expect(await screen.findByRole('status')).toHaveTextContent('waiting for admin approval');
  });
});

describe('seller home', () => {
  it('counts open work from real orders and stock instead of guessing', async () => {
    vi.mocked(authFetch).mockImplementation(async path => response(String(path).includes('my-orders')
      ? { orders: [order('one'), order('two', 'Return Requested'), order('three', 'Delivered')] }
      : { products: [product('mac', 0), product('air', 3), product('pro', 40)] }));
    renderRoute(<SellerPanel />);
    expect(await screen.findByRole('link', { name: /Restock sold-out products/ })).toHaveTextContent('1');
    expect(screen.getByRole('link', { name: /Review low stock/ })).toHaveTextContent('1');
    expect(screen.getByRole('link', { name: /Answer return requests/ })).toHaveTextContent('1');
    expect(screen.getByRole('link', { name: /Fulfil customer orders/ })).toHaveAttribute('href', '/seller-orders?status=processing');
  });
  it('shows unavailable metrics rather than fake zeroes on failure', async () => {
    vi.mocked(authFetch).mockResolvedValue(response({}, 500));
    renderRoute(<SellerPanel />);
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
    expect(screen.getByRole('region', { name: 'Shop performance' })).toHaveTextContent('—');
  });
});

describe('seller products', () => {
  it('filters by stock state and deletes only the selected rows', async () => {
    const user = userEvent.setup();
    vi.mocked(authFetch).mockResolvedValue(response({ products: [product('mac', 0), product('air', 3), product('pro', 40)] }));
    renderRoute(<SellerProducts />);
    expect(await screen.findByRole('button', { name: /Out of stock \(1\)/ })).toBeVisible();
    await user.click(screen.getByRole('button', { name: /Low stock \(1\)/ }));
    expect(screen.getAllByRole('row')).toHaveLength(2); // header + MacBook air
    await user.click(screen.getByRole('button', { name: /All \(3\)/ }));

    vi.mocked(authFetch).mockClear().mockResolvedValue(response({}));
    await user.click(screen.getByRole('checkbox', { name: 'Select MacBook mac' }));
    await user.click(screen.getByRole('button', { name: 'Delete selected' }));
    expect(vi.mocked(authFetch)).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(authFetch).mock.calls[0][0])).toContain('/product/seller/delete/mac');
    expect(screen.queryByText('MacBook mac')).not.toBeInTheDocument();
    expect(screen.getByText('MacBook air')).toBeVisible();
  });
});

describe('seller orders', () => {
  it('offers only the next pipeline stage and applies it to the row', async () => {
    const user = userEvent.setup();
    vi.mocked(authFetch).mockResolvedValue(response({ orders: [order('one', 'Shipped')] }));
    renderRoute(<SellerOrders />);
    await user.click(await screen.findByRole('button', { name: /Preview order/ }));
    expect(screen.queryByRole('button', { name: 'Mark Processing' })).not.toBeInTheDocument();

    vi.mocked(authFetch).mockResolvedValue(response({ message: 'ok' }));
    await user.click(screen.getByRole('button', { name: 'Mark Delivered' }));
    expect(within(screen.getAllByRole('row')[1]).getByText('Delivered')).toBeVisible();
  });
  it('lets the seller answer a return but not push it further down the pipeline', async () => {
    const user = userEvent.setup();
    vi.mocked(authFetch).mockResolvedValue(response({ orders: [order('one', 'Return Requested')] }));
    renderRoute(<SellerOrders />);
    await user.click(await screen.findByRole('button', { name: /Preview order/ }));
    expect(screen.getByRole('button', { name: 'Approve return' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /^Mark / })).not.toBeInTheDocument();
  });
});

describe('seller product details', () => {
  it('reads through the seller-scoped endpoint, never the public one', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: { _id: 'mac', name: 'MacBook mac', category: 'Laptops', price: 1000, quantity: 4, images: [], description: '', sellerId: 'me' } });
    renderRoute(<Routes><Route path="/seller-products/:id" element={<SellerProductDetails />} /></Routes>, '/seller-products/mac');
    expect(await screen.findByRole('heading', { name: 'MacBook mac' })).toBeVisible();
    expect(String(vi.mocked(axios.get).mock.calls[0][0])).toContain('/product/seller/product/mac');
    expect(String(vi.mocked(axios.get).mock.calls[0][0])).not.toContain('/product/get/');
  });
  it("shows nothing editable when the product is not the seller's own", async () => {
    vi.mocked(axios.get).mockRejectedValue(new Error('Not found'));
    renderRoute(<Routes><Route path="/seller-products/:id" element={<SellerProductDetails />} /></Routes>, '/seller-products/someone-else');
    expect(await screen.findByText('Product not found')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Edit|Save|Delete/ })).not.toBeInTheDocument();
  });
});
