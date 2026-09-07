import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { toast } from 'sonner';
import axios from 'axios';
import { renderRoute } from '../test/render';
import { authFetch } from '../lib/session';
import { type AdminOrder } from '../lib/adminData';
import AdminLayout from '../components/admin/AdminLayout';
import AdminPanel from './AdminPanel';
import AdminOrders from './AdminOrders';
import AllProducts from './AllProducts';
import AdminUserManagement from './AdminUserManagement';
import PromoManagement from './PromoManagement';

vi.mock('../lib/session', () => ({ authFetch: vi.fn(), logout: vi.fn() }));
vi.mock('../components/NotificationBell', () => ({ default: () => <button>Notifications</button> }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
const response = (body: unknown, status=200) => new Response(JSON.stringify(body), {status});
const order = (id: string, status='Pending', totalPrice=100): AdminOrder => ({_id:id,firstName:'Asha',lastName:id,email:id+'@example.test',quantity:1,totalPrice,status,createdAt:new Date().toISOString(),product:{name:'MacBook '+id}});
const loadOrders = (rows: AdminOrder[]) => vi.mocked(authFetch).mockResolvedValue(response(rows));
beforeEach(() => { vi.resetAllMocks(); vi.spyOn(window,'confirm').mockReturnValue(false); vi.spyOn(window,'scrollTo').mockImplementation(() => {}); });

describe('admin home', () => {
  it('shows real order values and actionable task links', async () => {
    vi.mocked(authFetch).mockImplementation(async path => response(String(path).includes('unverified') ? [{_id:'seller'}] : [order('one'),order('two','Delivered',250),order('three','Cancelled',400)]));
    renderRoute(<AdminPanel/>);
    expect(await screen.findByText('NPR 350')).toBeVisible();
    expect(screen.getByRole('link',{name:/Fulfil customer orders/})).toHaveAttribute('href','/admin/orders?status=active');
    expect(screen.getByRole('link',{name:/Review seller applications/})).toHaveTextContent('1');
    expect(screen.getByText(/not settled revenue/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
  });
  it('shows unavailable metrics rather than fake zeroes on failure', async () => {
    vi.mocked(authFetch).mockResolvedValue(response({},500));
    renderRoute(<AdminPanel/>);
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
    expect(screen.queryByText('NPR 0')).not.toBeInTheDocument();
    expect(screen.getByRole('region',{name:'Store performance'})).toHaveTextContent('—');
  });
});

describe('admin order management', () => {
  it('deep-links filters, searches, previews, and clears filters', async () => {
    loadOrders([order('pending'),order('delivered','Delivered')]);
    const user=userEvent.setup(); renderRoute(<AdminOrders/>,'/admin/orders?status=active');
    expect((await screen.findAllByText('MacBook pending'))[0]).toBeVisible();
    expect(screen.queryByText('MacBook delivered')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:'Preview order pending'}));
    expect(screen.getByRole('link',{name:'View full order'})).toHaveAttribute('href','/admin/orders/pending');
    await user.type(screen.getByRole('searchbox',{name:'Search orders'}),'missing');
    expect(screen.getByRole('heading', { name: 'No matching orders' })).toBeVisible();
    await user.click(screen.getByRole('button',{name:'Clear filters'}));
    expect(screen.getAllByText('MacBook delivered')[0]).toBeVisible();
  });
  it('paginates and exposes screen options', async () => {
    loadOrders(Array.from({length:21},(_,i)=>order('order'+i)));
    const user=userEvent.setup();renderRoute(<AdminOrders/>);
    await screen.findByText('Page 1 of 2');
    await user.click(screen.getByRole('button',{name:'Next page'}));
    expect(screen.getByText('Page 2 of 2')).toBeVisible();
    await user.click(screen.getByText('Screen options'));
    await user.click(screen.getByRole('checkbox',{name:'Order date'}));
    expect(screen.queryByRole('columnheader',{name:'Date'})).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Orders per page'),'50');
    expect(screen.getByText('Page 1 of 1')).toBeVisible();
  });
  it('keeps cancellation behind confirmation', async () => {
    loadOrders([order('one')]);const user=userEvent.setup();renderRoute(<AdminOrders/>);
    await user.click(await screen.findByRole('button',{name:'Preview order one'}));
    await user.click(screen.getByRole('button',{name:'Cancel order'}));
    expect(window.confirm).toHaveBeenCalled();
    expect(authFetch).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText('Pending')[0]).toBeVisible();
  });
  it.each([
    ['Pending','Cancel order','/cancel/','Cancelled',undefined],
    ['Return Requested','Approve return','/admin/return/','Return Approved','approve'],
    ['Return Requested','Reject return','/admin/return/','Return Rejected','reject'],
    ['Return Approved','Complete sandbox refund · NPR 100','/admin/refund/','Refund Released',undefined],
  ])('preserves the %s action endpoint', async (status,label,path,next,action) => {
    vi.mocked(authFetch).mockResolvedValueOnce(response([order('one',status)])).mockResolvedValueOnce(response({success:true}));
    vi.mocked(window.confirm).mockReturnValue(true);
    const user=userEvent.setup();renderRoute(<AdminOrders/>);
    await user.click(await screen.findByRole('button',{name:'Preview order one'}));
    await user.click(screen.getByRole('button',{name:label}));
    expect(authFetch).toHaveBeenLastCalledWith(expect.stringContaining(path+'one'),expect.objectContaining({method:'PUT',...(action?{body:JSON.stringify({action})}:{})}));
    expect(await screen.findByRole('cell',{name:next})).toBeVisible();
  });
  it('prevents duplicate requests and retains status after server failure', async () => {
    let finish!: (value:Response)=>void;
    vi.mocked(authFetch).mockResolvedValueOnce(response([order('one')])).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    vi.mocked(window.confirm).mockReturnValue(true);
    const user=userEvent.setup();renderRoute(<AdminOrders/>);
    await user.click(await screen.findByRole('button',{name:'Preview order one'}));
    await user.dblClick(screen.getByRole('button',{name:'Cancel order'}));
    expect(screen.getByRole('button',{name:'Cancel order'})).toBeDisabled();
    expect(authFetch).toHaveBeenCalledTimes(2);
    await act(async()=>finish(response({message:'Order changed; refresh first'},409)));
    expect(toast.error).toHaveBeenCalledWith('Order changed; refresh first');
    expect(screen.getAllByText('Pending')[0]).toBeVisible();
  });
});

describe('admin catalogue', () => {
  it('filters category, stock, seller search and retains edit destinations', async () => {
    vi.mocked(authFetch).mockResolvedValue(response([
      {_id:'mac',name:'MacBook',category:'Laptops',quantity:4,price:100,images:[],seller:{shopName:'Asha Store'}},
      {_id:'phone',name:'iPhone',category:'Phones',quantity:0,price:200,images:[],seller:{shopName:'Other Store'}},
    ]));
    const user=userEvent.setup();renderRoute(<AllProducts/>);
    expect(await screen.findByRole('link',{name:'MacBook'})).toHaveAttribute('href','/product-details-admin/mac');
    await user.selectOptions(screen.getByLabelText('Filter product stock'),'out');
    expect(screen.queryByRole('link',{name:'MacBook'})).not.toBeInTheDocument();
    expect(screen.getByRole('link',{name:'iPhone'})).toBeVisible();
    await user.click(screen.getByRole('button',{name:'Clear filters'}));
    await user.selectOptions(screen.getByLabelText('Filter product category'),'Laptops');
    expect(screen.queryByRole('link',{name:'iPhone'})).not.toBeInTheDocument();
    await user.type(screen.getByRole('searchbox',{name:'Search products'}),'missing');
    expect(screen.getByRole('heading', { name: 'No matching products' })).toBeVisible();
  });
});

describe('admin customers', () => {
  it('opens the customer section filtered to customer accounts', async () => {
    localStorage.setItem('token','test-token'); localStorage.setItem('isAdmin','true');
    vi.mocked(axios.get).mockImplementation(async url => ({ data: String(url).endsWith('/stats')
      ? {totalUsers:1,totalSellers:1,verifiedSellers:1,unverifiedSellers:0,totalAdmins:1,totalAccounts:3}
      : [
        {_id:'customer',firstName:'Customer',lastName:'One',email:'customer@example.test',role:'user',createdAt:'2026-08-01'},
        {_id:'seller',firstName:'Seller',lastName:'Two',email:'seller@example.test',role:'seller',createdAt:'2026-08-01'},
      ] }));
    renderRoute(<AdminUserManagement/>,'/admin/users?role=user');
    expect(await screen.findByRole('heading',{name:'Customers'})).toBeVisible();
    expect(screen.getAllByText('Customer One')[0]).toBeVisible();
    expect(screen.queryByText('Seller Two')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add seller' })).toHaveClass('admin-button');
    expect(screen.getByRole('button', { name: 'Add customer' })).toHaveClass('admin-button');
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
  });
});

describe('admin promotions', () => {
  it('shows field-level feedback before creating an invalid code', async () => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('isAdmin', 'true');
    vi.mocked(axios.get).mockResolvedValue({ data: { promoCodes: [] } });
    const user = userEvent.setup();
    renderRoute(<PromoManagement />, '/admin/promo-codes');

    await screen.findByRole('heading', { name: 'Promo Code Management' });
    await user.click(screen.getByRole('button', { name: 'Create New Promo Code' }));
    await user.click(screen.getByRole('button', { name: 'Create Promo Code', exact: true }));

    expect(screen.getByRole('alert')).toHaveTextContent('Review the highlighted fields');
    expect(screen.getByLabelText('Code *')).toHaveAccessibleDescription('Use 3–20 letters, numbers, hyphens, or underscores.');
    expect(axios.post).not.toHaveBeenCalled();
  });
});

describe('admin navigation', () => {
  it('switches sellers directly while preserving the orders view', async () => {
    const user = userEvent.setup();
    vi.mocked(authFetch).mockImplementation(async () => response({ items: [{ id: 'seller-two', shopName: 'Mountain Tech', firstName: 'Asha', lastName: 'Rai' }], total: 1, page: 1, pageSize: 10 }));
    renderRoute(<Routes><Route element={<AdminLayout/>}><Route path="*" element={<p>Workspace content</p>}/></Route></Routes>, '/admin/sellers/seller-one?view=orders');
    await user.click(screen.getByRole('button', { name: 'Switch seller' }));
    expect(await screen.findByRole('link', { name: /Mountain Tech/ })).toHaveAttribute('href', '/admin/sellers/seller-two?view=orders');
    await user.type(screen.getByRole('searchbox', { name: 'Find a seller' }), 'Mountain');
    await user.click(screen.getByRole('button', { name: 'Search sellers in menu' }));
    expect(authFetch).toHaveBeenLastCalledWith(expect.stringContaining('q=Mountain'), expect.anything());
    await user.click(await screen.findByRole('link', { name: /Mountain Tech/ }));
    expect(screen.getByRole('button', { name: 'Switch seller' })).toHaveAttribute('aria-expanded', 'false');
    await user.click(screen.getByRole('button', { name: 'Switch seller' }));
    expect(await screen.findByRole('link', { name: /Mountain Tech/ })).toHaveAttribute('aria-current', 'page');
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Switch seller' })).toHaveFocus();
    expect(screen.queryByRole('searchbox', { name: 'Find a seller' })).not.toBeInTheDocument();
  });

  it('keeps seller navigation stable on an individual profile', () => {
    renderRoute(<Routes><Route element={<AdminLayout/>}><Route path="*" element={<p>Workspace content</p>}/></Route></Routes>,'/admin/sellers/507f1f77bcf86cd799439011');
    const sellerSection = within(screen.getByRole('group',{name:'Sellers section'}));
    expect(sellerSection.getByRole('button',{name:'Sellers menu'})).toHaveAttribute('aria-expanded','true');
    expect(sellerSection.getAllByRole('link')).toHaveLength(2);
    expect(sellerSection.getByRole('link',{name:'Seller directory'})).toHaveClass('is-active');
    expect(sellerSection.getByRole('link',{name:'Seller directory'})).not.toHaveAttribute('aria-current');
    expect(sellerSection.getByRole('link',{name:'Seller approvals'})).toHaveAttribute('href','/admin/seller-approvals');
  });
  it('supports keyboard disclosure and identifies the current destination without fetching sellers', async () => {
    const user=userEvent.setup();
    renderRoute(<Routes><Route element={<AdminLayout/>}><Route path="*" element={<p>Workspace content</p>}/></Route></Routes>,'/admin');
    const sellerMenu = screen.getByRole('button',{name:'Sellers menu'});
    expect(sellerMenu).toHaveAttribute('aria-expanded','false');
    expect(screen.queryByRole('link',{name:'Seller directory'})).not.toBeInTheDocument();
    sellerMenu.focus();
    await user.keyboard('{Enter}');
    expect(sellerMenu).toHaveAttribute('aria-expanded','true');
    expect(document.getElementById(sellerMenu.getAttribute('aria-controls')!)).toBeVisible();
    await user.keyboard('{Tab}{Tab}{Enter}');
    expect(screen.getByRole('link',{name:'Seller directory'})).toHaveAttribute('aria-current','page');
    await user.click(screen.getByRole('link',{name:'Seller approvals'}));
    expect(screen.getByRole('link',{name:'Seller approvals'})).toHaveAttribute('aria-current','page');
    expect(screen.getByRole('link',{name:'Seller directory'})).not.toHaveAttribute('aria-current');
    sellerMenu.focus();
    await user.keyboard(' ');
    expect(sellerMenu).toHaveAttribute('aria-expanded','false');
    expect(screen.queryByRole('link',{name:'Seller approvals'})).not.toBeInTheDocument();
    expect(authFetch).not.toHaveBeenCalled();
    expect(screen.getByRole('link',{name:'Customer accounts'})).toHaveAttribute('href','/admin/users?role=user');
  });
  it.each(['/admin','/admin-orders','/admin/orders/one'])('does not offer unscoped seller links at %s', path => {
    renderRoute(<Routes><Route element={<AdminLayout/>}><Route path="*" element={<p>Order content</p>}/></Route></Routes>,path);
    const navigation = within(screen.getByRole('navigation',{name:'Admin navigation'}));
    expect(navigation.queryByRole('link',{name:'Orders'})).not.toBeInTheDocument();
    expect(navigation.queryByRole('link',{name:'Products'})).not.toBeInTheDocument();
  });
  it('collapses navigation, supports mobile Escape, and skips to content without changing routes', async () => {
    const user=userEvent.setup();renderRoute(<Routes><Route element={<AdminLayout/>}><Route path="*" element={<p>Workspace content</p>}/></Route></Routes>,'/admin');
    await user.click(screen.getByRole('button',{name:'Collapse sidebar'}));
    expect(screen.getByRole('button',{name:'Expand sidebar'})).toBeVisible();
    // JSDOM does not evaluate responsive media queries; reveal the mobile control.
    (document.querySelector('.admin-mobile-toggle') as HTMLElement).style.display='grid';
    await user.click(screen.getByRole('button',{name:'Open admin navigation'}));
    expect(screen.getByRole('button',{name:'Close admin navigation'})).toHaveAttribute('aria-expanded','true');
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button',{name:'Open admin navigation'})).toHaveFocus();
    await user.click(screen.getByRole('link',{name:'Skip to admin content'}));
    expect(document.getElementById('admin-content')).toHaveFocus();
    expect(screen.getByText('Workspace content')).toBeVisible();
  });
});

