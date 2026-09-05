import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { renderRoute } from '../test/render';
import { authFetch } from '../lib/session';
import AdminSellers from './AdminSellers';
import AdminSellerDetails from './AdminSellerDetails';
import AdminLayout from '../components/admin/AdminLayout';

vi.mock('../lib/session', () => ({ authFetch: vi.fn(), logout: vi.fn() }));
vi.mock('../components/NotificationBell', () => ({ default: () => null }));
const response = (body: unknown, status=200) => new Response(JSON.stringify(body), { status });
const seller = { id: '66a100000000000000000001', firstName: 'Aarav', lastName: 'Shrestha', email: 'seller@example.test', shopName: 'Orbit Store', isVerified: true, createdAt: '2026-08-01' };
const detail = { seller, items: [], total: 0, page: 1, pageSize: 20, view: 'products' };
const showProfile = (path='/admin/sellers/'+seller.id) => renderRoute(<Routes><Route element={<AdminLayout/>}><Route path="/admin/sellers/:sellerId" element={<AdminSellerDetails/>}/></Route></Routes>, path);
beforeEach(() => { vi.resetAllMocks(); vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); });

describe('seller directory', () => {
  it('links to an individual profile, searches, filters, and paginates', async () => {
    vi.mocked(authFetch).mockImplementation(async () => response({ items: [seller], total: 21, page: 1, pageSize: 20 }));
    const user = userEvent.setup(); renderRoute(<AdminSellers/>);
    expect(await screen.findByRole('link', { name: 'View seller Orbit Store' })).toHaveAttribute('href', '/admin/sellers/'+seller.id);
    await user.type(screen.getByRole('searchbox', { name: 'Search sellers' }), 'Orbit');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(authFetch).toHaveBeenLastCalledWith(expect.stringContaining('q=Orbit'), expect.anything());
    await user.selectOptions(screen.getByLabelText('Filter sellers by status'), 'unverified');
    expect(authFetch).toHaveBeenLastCalledWith(expect.stringContaining('status=unverified'), expect.anything());
    await user.click(await screen.findByRole('button', { name: 'Next page' }));
    expect(authFetch).toHaveBeenLastCalledWith(expect.stringContaining('page=2'), expect.anything());
  });
  it('shows empty and recoverable error states', async () => {
    vi.mocked(authFetch).mockResolvedValueOnce(response({},500)).mockResolvedValueOnce(response({ items: [], total: 0, page: 1, pageSize: 20 }));
    const user = userEvent.setup(); renderRoute(<AdminSellers/>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Seller accounts will appear here once they register.')).toBeVisible();
  });
});

describe('seller profiles', () => {
  it('shows contact details, verification and missing-field fallbacks with Sellers active', async () => {
    vi.mocked(authFetch).mockResolvedValue(response(detail)); showProfile();
    expect(await screen.findByRole('heading', { name: 'Orbit Store' })).toBeVisible();
    expect(screen.getByRole('link', { name: seller.email })).toHaveAttribute('href','mailto:'+seller.email);
    expect(screen.getByText('No shop description provided.')).toBeVisible();
    expect(screen.getByText('Not provided')).toBeVisible();
    expect(within(screen.getByRole('navigation', { name:'Admin navigation' })).getByRole('button', {name:'Sellers menu'})).toHaveAttribute('aria-expanded','true');
    expect(screen.getByRole('link',{name:'All sellers'})).toHaveAttribute('href','/admin/sellers');
  });
  it('opens products and loads only the selected seller orders', async () => {
    vi.mocked(authFetch).mockImplementation(async path => response(String(path).includes('view=orders') ? { ...detail, view:'orders', total:1, items:[{_id:'order123',firstName:'Asha',lastName:'Gurung',status:'Pending',totalPrice:250,createdAt:'2026-08-01',product:{name:'MacBook'}}] } : {...detail,total:1,items:[{id:'product123',name:'MacBook',category:'Laptop',price:250,quantity:2,images:[]}]}));
    const user=userEvent.setup(); showProfile();
    expect(await screen.findByRole('link',{name:'View / edit'})).toHaveAttribute('href','/product-details-admin/product123');
    await user.click(screen.getByRole('button',{name:'Orders'}));
    expect(await screen.findByRole('link',{name:/#order123/})).toHaveAttribute('href','/admin/orders/order123');
    expect(authFetch).toHaveBeenLastCalledWith(expect.stringContaining('/sellers/'+seller.id+'?view=orders'),expect.anything());
    expect(screen.queryByRole('link',{name:'View / edit'})).not.toBeInTheDocument();
  });
  it.each([404,403])('shows a clear %s state without a stale profile', async status => {
    vi.mocked(authFetch).mockResolvedValue(response({},status));showProfile();
    expect(await screen.findByRole('alert')).toHaveTextContent(status===404?'Seller not found':'Administrator access');
    expect(screen.queryByRole('region',{name:'Seller profile'})).not.toBeInTheDocument();
  });
  it('ignores late responses after switching activity views', async () => {
    let finish!: (value: Response) => void;
    vi.mocked(authFetch).mockImplementation(path => String(path).includes('view=orders')
      ? new Promise(resolve => { finish = resolve; })
      : Promise.resolve(response(detail)));
    const user=userEvent.setup();showProfile();await screen.findByText('This seller has not listed any products.');
    await user.click(screen.getByRole('button',{name:'Orders'}));
    // A pending response is aborted when navigating away; it must not restore a profile.
    await user.click(screen.getByRole('link',{name:'All sellers'}));
    await act(async()=>finish(response({...detail,view:'orders'})));
    expect(screen.queryByRole('heading',{name:'Orbit Store'})).not.toBeInTheDocument();
  });
});
