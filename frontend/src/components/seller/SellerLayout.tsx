import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { BarChart3, ChevronLeft, ChevronRight, ClipboardList, ExternalLink, Home, LogOut, Menu, Package, Plus, UserCircle, X, type LucideIcon } from 'lucide-react';
import { authFetch, logout } from '../../lib/session';
import NotificationBell from '../NotificationBell';
import OrbitMark from '../OrbitMark';
import { AdminContext } from '../admin/AdminContext';
import type { SellerProfile } from '../../lib/sellerData';
// Both roles share the same workspace design system.
import '../admin/admin.css';

type NavItem = { label: string; to: string; icon: LucideIcon; group?: string; children?: { label: string; to: string; icon: LucideIcon }[] };

const sections: NavItem[] = [
  { label: 'Home', to: '/seller-panel', icon: Home, group: 'Shop management' },
  { label: 'Orders', to: '/seller-orders', icon: ClipboardList },
  { label: 'Products', to: '/seller-products', icon: Package },
  { label: 'Add product', to: '/add-product', icon: Plus },
  { label: 'Account settings', to: '/seller/account', icon: UserCircle, group: 'Your account' },
  { label: 'Analytics', to: '/seller/revenue', icon: BarChart3, group: 'Business' },
];
const aliases: Record<string, string> = { '/seller-revenue': '/seller/revenue', '/seller-product-details': '/seller-products' };
const titles: Record<string, string> = { '/seller/account': 'Account settings', '/seller-panel': 'Home', '/seller-orders': 'Orders', '/seller-products': 'Products', '/add-product': 'Add new product', '/seller/revenue': 'Analytics' };

export default function SellerLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [profile, setProfile] = useState<SellerProfile | null>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const path = aliases[location.pathname] || (location.pathname.startsWith('/seller-products/') ? '/seller-products' : location.pathname);
  const current = titles[path] || 'Seller workspace';

  const loadProfile = useCallback(async (signal: AbortSignal) => {
    try {
      const response = await authFetch(`${import.meta.env.VITE_BACKEND_URL}/api/v1/auth/me`, { signal });
      if (!response.ok) return;
      const data: SellerProfile = await response.json();
      if (!signal.aborted) setProfile(data);
    } catch { /* the shell still works without the shop name */ }
  }, []);
  useEffect(() => { const controller = new AbortController(); void loadProfile(controller.signal); return () => controller.abort(); }, [loadProfile]);
  useEffect(() => { setMobileOpen(false); window.scrollTo(0, 0); }, [location.pathname]);
  useEffect(() => {
    if (mobileOpen) document.querySelector<HTMLAnchorElement>('#seller-navigation nav a')?.focus();
  }, [mobileOpen]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && mobileOpen) { setMobileOpen(false); menuRef.current?.focus(); } };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [mobileOpen]);

  const signOut = async () => { setSigningOut(true); try { await logout(); navigate('/auth'); } finally { setSigningOut(false); } };
  const shop = profile?.shopName || 'Your shop';
  const pendingApproval = profile !== null && profile.isVerified === false;

  return (
    <AdminContext.Provider value={true}>
      <div className={`admin-app seller-app${collapsed ? ' is-collapsed' : ''}${mobileOpen ? ' menu-open' : ''}`}>
        <a className="admin-skip" href="#seller-content" onClick={event => { event.preventDefault(); document.getElementById('seller-content')?.focus(); }}>Skip to shop content</a>
        <header className="admin-topbar">
          <Link to="/seller-panel" className="admin-brand"><OrbitMark size={24} /><strong>ShopSphere</strong><span>Seller</span></Link>
          <Link className="admin-store-link" to="/"><ExternalLink size={14} aria-hidden="true" />Visit store</Link>
          <div className="admin-topbar-end"><NotificationBell /><span className="admin-account-label">{shop}</span><button onClick={signOut} disabled={signingOut} aria-label="Sign out"><LogOut size={17} aria-hidden="true" /></button></div>
        </header>
        <aside className="admin-sidebar" id="seller-navigation" aria-label="Seller workspace">
          <div className="admin-identity"><span className="admin-identity-mark" aria-hidden="true">{shop.charAt(0).toUpperCase()}</span><div><strong>{shop}</strong><small>Seller workspace</small></div></div>
          <nav aria-label="Seller navigation">
            {sections.map(({ label, to, icon: Icon, group, children }) => <div key={to} className={group ? 'admin-nav-section-start' : undefined}>
              {group && <p className="admin-nav-group">{group}</p>}
              <Link to={to} className={`admin-nav-link${path === to ? ' is-active' : ''}`} aria-current={path === to ? 'page' : undefined} title={collapsed ? label : undefined}><Icon size={18} aria-hidden="true" /><span>{label}</span></Link>
              {children && <div className="admin-nav-children">{children.map(child => {
                const ChildIcon = child.icon;
                const active = path === child.to;
                return <Link key={child.to} to={child.to} className={`admin-nav-link${active ? ' is-active' : ''}`} aria-current={active ? 'page' : undefined} title={collapsed ? child.label : undefined}><ChildIcon size={16} aria-hidden="true" /><span>{child.label}</span></Link>;
              })}</div>}
            </div>)}
          </nav>
          <div className="admin-sidebar-footer"><Link to="/"><ExternalLink size={16} aria-hidden="true" /><span>Open storefront</span></Link></div>
          <button className="admin-collapse" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>{collapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}<span>Collapse menu</span></button>
        </aside>
        <div className="admin-workspace">
          <div className="admin-location-bar">
            <button ref={menuRef} className="admin-mobile-toggle" onClick={() => setMobileOpen(!mobileOpen)} aria-label={mobileOpen ? 'Close seller navigation' : 'Open seller navigation'} aria-controls="seller-navigation" aria-expanded={mobileOpen}>{mobileOpen ? <X size={20} /> : <Menu size={20} />}</button>
            <nav aria-label="Breadcrumb"><Link to="/seller-panel">{shop}</Link><ChevronRight size={14} aria-hidden="true" /><span>{current}</span></nav>
            <span className="admin-workspace-label">Seller workspace</span>
          </div>
          <div id="seller-content" className="admin-content" tabIndex={-1}>
            {pendingApproval && <p className="admin-notice admin-notice--pending" role="status">Your shop is waiting for admin approval. You can prepare listings now, but they stay hidden from the storefront until your account is approved.</p>}
            <Outlet />
          </div>
          <footer className="admin-footer">ShopSphere seller centre<span>Run your shop with clarity.</span></footer>
        </div>
      </div>
    </AdminContext.Provider>
  );
}
