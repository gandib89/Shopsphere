import { Fragment, useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { BarChart3, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, ExternalLink, Home, LogOut, Menu, Package, Store, Tag, Users, X, type LucideIcon } from 'lucide-react';
import { logout } from '../../lib/session';
import NotificationBell from '../NotificationBell';
import OrbitMark from '../OrbitMark';
import { sellerName, useAdminSellerResource, type SellerList } from '../../lib/adminSellers';
import { AdminContext } from './AdminContext';
import './admin.css';

type SellerNavItem = { label: string; icon: LucideIcon } & ({ to: string } | { view: 'orders' | 'products' });
type AdminNavItem = { label: string; to: string; icon: LucideIcon; group?: string; children?: SellerNavItem[] };

const sections: AdminNavItem[] = [
  { label: 'Home', to: '/admin', icon: Home, group: 'Store management' },
  { label: 'Orders', to: '/admin/orders', icon: ClipboardList },
  { label: 'Products', to: '/all-products', icon: Package },
  { label: 'Sellers', to: '/admin/sellers', icon: Store, children: [
    { label: 'Seller directory', to: '/admin/sellers', icon: Store },
    { label: 'Orders', view: 'orders', icon: ClipboardList },
    { label: 'Products', view: 'products', icon: Package },
    { label: 'Seller approvals', to: '/admin/seller-approvals', icon: Store },
  ] },
  { label: 'Customer accounts', to: '/admin/users?role=user', icon: Users, group: 'Customers' },
  { label: 'Analytics', to: '/admin/revenue', icon: BarChart3, group: 'Business' },
  { label: 'Coupons', to: '/admin/promo-codes', icon: Tag },
];
const aliases: Record<string, string> = { '/admin-orders': '/admin/orders', '/admin/seller-approval': '/admin/seller-approvals', '/user-details': '/admin/users' };

export default function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  const selectedSellerId = location.pathname.match(/^\/admin\/sellers\/([^/]+)$/)?.[1];
  const sellerView = new URLSearchParams(location.search).get('view') === 'orders' ? 'orders' : 'products';
  const path = aliases[location.pathname] || (location.pathname.startsWith('/product-details-admin/') ? '/all-products' : location.pathname.startsWith('/admin/orders/') ? '/admin/orders' : location.pathname.startsWith('/admin/sellers/') ? '/admin/sellers' : location.pathname);
  const sellerSectionActive = path === '/admin/sellers' || path === '/admin/seller-approvals';
  const [sellerMenuOpen, setSellerMenuOpen] = useState(sellerSectionActive);
  const { data: sellerOptions, loading: sellersLoading, error: sellersError } = useAdminSellerResource<SellerList>('?page=1&limit=200');
  const current = selectedSellerId ? sellerView === 'orders' ? 'Orders' : 'Products' : sections.find(item => item.to.split('?')[0] === path)?.label || (path === '/admin/seller-approvals' ? 'Seller approvals' : 'Administration');

  useEffect(() => { setMobileOpen(false); window.scrollTo(0, 0); }, [location.pathname]);
  useEffect(() => { if (sellerSectionActive) setSellerMenuOpen(true); }, [sellerSectionActive]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && mobileOpen) { setMobileOpen(false); menuRef.current?.focus(); } };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [mobileOpen]);

  const signOut = async () => { setSigningOut(true); try { await logout(); navigate('/auth'); } finally { setSigningOut(false); } };
  return (
    <AdminContext.Provider value={true}>
      <div className={`admin-app${collapsed ? ' is-collapsed' : ''}${mobileOpen ? ' menu-open' : ''}`}>
        <a className="admin-skip" href="#admin-content" onClick={event => { event.preventDefault(); document.getElementById('admin-content')?.focus(); }}>Skip to admin content</a>
        <header className="admin-topbar">
          <Link to="/admin" className="admin-brand"><OrbitMark size={24} /><strong>ShopSphere</strong><span>Admin</span></Link>
          <Link className="admin-store-link" to="/"><ExternalLink size={14} aria-hidden="true" />Visit store</Link>
          <div className="admin-topbar-end"><NotificationBell /><span className="admin-account-label">Administrator</span><button onClick={signOut} disabled={signingOut} aria-label="Sign out"><LogOut size={17} aria-hidden="true" /></button></div>
        </header>
        <aside className="admin-sidebar" id="admin-navigation" aria-label="Admin workspace">
          <nav aria-label="Admin navigation">
            {sections.map(({ label, to, icon: Icon, group, children }) => <div key={to} className={group ? 'admin-nav-section-start' : undefined} role={children ? 'group' : undefined} aria-label={children ? `${label} section` : undefined}>
              {group && <p className="admin-nav-group">{group}</p>}
              {children ? <button className={`admin-nav-link admin-nav-menu-button${sellerSectionActive ? ' is-active' : ''}`} aria-label={`${label} menu`} aria-expanded={sellerMenuOpen} title={collapsed ? label : undefined} onClick={() => setSellerMenuOpen(value => !value)}><Icon size={18} aria-hidden="true" /><span>{label}</span><ChevronDown className={`admin-nav-menu-chevron${sellerMenuOpen ? ' is-open' : ''}`} size={15} aria-hidden="true" /></button>
                : <Link to={to} className={`admin-nav-link${path === to.split('?')[0] ? ' is-active' : ''}`} aria-current={path === to.split('?')[0] ? 'page' : undefined} title={collapsed ? label : undefined} onClick={() => setMobileOpen(false)}><Icon size={18} aria-hidden="true" /><span>{label}</span></Link>}
              {children && sellerMenuOpen && <div className="admin-nav-children">
                {children.map((child) => {
                if ('view' in child && !selectedSellerId) return null;
                const childTo = 'to' in child ? child.to : `/admin/sellers/${encodeURIComponent(selectedSellerId!)}?view=${child.view}`;
                const active = 'view' in child ? sellerView === child.view : child.to === '/admin/sellers' ? path === child.to && !selectedSellerId : path === child.to;
                const ChildIcon = child.icon;
                const isSellerDirectory = child.label === 'Seller directory';
                return <Fragment key={child.label}>
                  <Link to={childTo} className={`admin-nav-link${active ? ' is-active' : ''}`} aria-current={active ? 'page' : undefined} title={collapsed ? child.label : undefined} onClick={() => setMobileOpen(false)}><ChildIcon size={16} aria-hidden="true" /><span>{child.label}</span></Link>
                  {isSellerDirectory && <div className="admin-seller-picker">
                    <label htmlFor="admin-seller-picker">Open seller</label>
                    <select id="admin-seller-picker" value={selectedSellerId || ''} disabled={sellersLoading || !!sellersError} onChange={event => { if (event.target.value) { navigate(`/admin/sellers/${encodeURIComponent(event.target.value)}`); setMobileOpen(false); } }}>
                      <option value="">{sellersLoading ? 'Loading sellers…' : sellersError ? 'Seller list unavailable' : 'Choose a seller…'}</option>
                      {sellerOptions?.items?.map(seller => <option key={seller.id} value={seller.id}>{sellerName(seller)}</option>)}
                    </select>
                  </div>}
                </Fragment>;
              })}</div>}
            </div>)}
          </nav>
          <button className="admin-collapse" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>{collapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}<span>Collapse menu</span></button>
        </aside>
        <div className="admin-workspace">
          <div className="admin-location-bar">
            <button ref={menuRef} className="admin-mobile-toggle" onClick={() => setMobileOpen(!mobileOpen)} aria-label={mobileOpen ? 'Close admin navigation' : 'Open admin navigation'} aria-controls="admin-navigation" aria-expanded={mobileOpen}>{mobileOpen ? <X size={20} /> : <Menu size={20} />}</button>
            <nav aria-label="Breadcrumb"><Link to="/admin">ShopSphere</Link><ChevronRight size={14} aria-hidden="true" /><span>{current}</span></nav>
            <span className="admin-workspace-label">Store workspace</span>
          </div>
          <div id="admin-content" className="admin-content" tabIndex={-1}><Outlet /></div>
          <footer className="admin-footer">ShopSphere administration<span>Manage your marketplace with clarity.</span></footer>
        </div>
      </div>
    </AdminContext.Provider>
  );
}
