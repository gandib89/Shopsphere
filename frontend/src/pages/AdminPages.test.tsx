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
    expect(await screen.findByText('MacBook pending')).toBeVisible();
    expect(screen.queryByText('MacBook delivered')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:'Preview order pending'}));
    expect(screen.getByRole('link',{name:'View full order'})).toHaveAttribute('href','/admin/orders/pending');
    await user.type(screen.getByRole('searchbox',{name:'Search orders'}),'missing');
    expect(screen.getByText('No orders match these filters.')).toBeVisible();
    await user.click(screen.getByRole('button',{name:'Clear filters'}));
    expect(screen.getByText('MacBook delivered')).toBeVisible();
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
    expect(screen.getByText('Pending')).toBeVisible();
  });
  it.each([
    ['Pending','Cancel order','/cancel/','Cancelled',undefined],
    ['Return Requested','Approve return','/admin/return/','Return Approved','approve'],
    ['Return Requested','Reject return','/admin/return/','Return Rejected','reject'],
    ['Return Approved','Release refund · NPR 100','/admin/refund/','Refund Released',undefined],
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
    expect(screen.getByText('Pending')).toBeVisible();
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
    expect(screen.getByText('No products match these filters.')).toBeVisible();
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
    expect(screen.getByText('Customer One')).toBeVisible();
    expect(screen.queryByText('Seller Two')).not.toBeInTheDocument();
  });
});

describe('admin navigation', () => {
  it('nests seller-scoped Orders and Products inside the selected Sellers section', () => {
    const sellerId = '507f1f77bcf86cd799439011';
    renderRoute(<Routes><Route element={<AdminLayout/>}><Route path="*" element={<p>Workspace content</p>}/></Route></Routes>,'/admin/sellers/'+sellerId);
    const sellerSection = within(screen.getByRole('group',{name:'Sellers section'}));
    expect(sellerSection.getByRole('button',{name:'Sellers menu'})).toHaveAttribute('aria-expanded','true');
    expect(sellerSection.getByRole('link',{name:'Seller directory'})).toHaveAttribute('href','/admin/sellers');
    expect(sellerSection.getByRole('link',{name:'Orders'})).toHaveAttribute('href','/admin/sellers/'+sellerId+'?view=orders');
    expect(sellerSection.getByRole('link',{name:'Products'})).toHaveAttribute('href','/admin/sellers/'+sellerId+'?view=products');
  });
  it('provides seller dropdown access and a separate customer section', async () => {
    const user=userEvent.setup();
    const sellerId = '507f1f77bcf86cd799439011';
    vi.mocked(authFetch).mockResolvedValue(response({items:[{id:sellerId,firstName:'Asha',lastName:'Rai',email:'asha@example.test',shopName:'Asha Store',isVerified:true,createdAt:'2026-08-01'}],total:1,page:1,pageSize:200}));
    renderRoute(<Routes><Route element={<AdminLayout/>}><Route path="*" element={<p>Workspace content</p>}/></Route></Routes>,'/admin');
    const sellerMenu = screen.getByRole('button',{name:'Sellers menu'});
    expect(sellerMenu).toHaveAttribute('aria-expanded','false');
    await user.click(sellerMenu);
    expect(sellerMenu).toHaveAttribute('aria-expanded','true');
    const sellerPicker = await screen.findByRole('combobox',{name:'Open seller'});
    expect(within(sellerPicker).getByRole('option',{name:'Asha Store'})).toHaveValue(sellerId);
    await user.selectOptions(sellerPicker,sellerId);
    expect(screen.getByRole('link',{name:'Products'})).toHaveAttribute('href','/admin/sellers/'+sellerId+'?view=products');
    expect(screen.getByRole('link',{name:'Orders'})).toHaveAttribute('href','/admin/sellers/'+sellerId+'?view=orders');
    expect(screen.getByRole('link',{name:'Seller directory'})).toHaveAttribute('href','/admin/sellers');
    expect(screen.getByRole('link',{name:'Seller approvals'})).toHaveAttribute('href','/admin/seller-approvals');
    expect(screen.getByText('Customers')).toBeVisible();
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
