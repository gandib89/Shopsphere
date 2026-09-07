import { useEffect, Suspense, lazy } from 'react';
import { HashRouter as Router, Navigate, Routes, Route, useLocation } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { LoadingState } from './components/ui/AsyncState';
import { SessionRecovery } from './components/auth/SessionRecovery';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { productPath } from './lib/routes';

// Lazy-load every page so only the current route's JS is downloaded on first load
const Home = lazy(() => import('./pages/Home'));
const StorefrontDemo = lazy(() => import('./pages/StorefrontDemo'));
const UiRedesignDemo = lazy(() => import('./pages/UiRedesignDemo'));
const AuthLanding = lazy(() => import('./pages/AuthLanding'));
const UserAuth = lazy(() => import('./pages/UserAuth'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const AdminAuth = lazy(() => import('./pages/AdminAuth'));
const AddProduct = lazy(() => import('./pages/AddProduct'));
const Cart = lazy(() => import('./pages/Cart'));
const CartCheckout = lazy(() => import('./pages/CartCheckout'));
const ProductDetailsPage = lazy(() => import('./pages/ProductDetailsPage'));
const ProductDetailsAdmin = lazy(() => import('./pages/ProductDetailsAdmin'));
const AllProducts = lazy(() => import('./pages/AllProducts'));
const AdminLayout = lazy(() => import('./components/admin/AdminLayout'));
const AdminPanel = lazy(() => import('./pages/AdminPanel'));
const AdminSellerApproval = lazy(() => import('./pages/AdminSellerApproval'));
const AdminSellers = lazy(() => import('./pages/AdminSellers'));
const AdminSellerDetails = lazy(() => import('./pages/AdminSellerDetails'));
const AdminAddSellerProduct = lazy(() => import('./pages/AdminAddSellerProduct'));
const AdminRevenueDashboard = lazy(() => import('./pages/AdminRevenueDashboard'));
const AdminUserManagement = lazy(() => import('./pages/AdminUserManagement'));
const PromoManagement = lazy(() => import('./pages/PromoManagement'));
const OrderDetails = lazy(() => import('./pages/OrderDetails'));
const UserBillHistory = lazy(() => import('./pages/UserBillHistory'));
const MyOrders = lazy(() => import('./pages/MyOrders'));
const AdminOrders = lazy(() => import('./pages/AdminOrders'));
const Success = lazy(() => import('./pages/Success'));
const Failure = lazy(() => import('./pages/Failure'));
const SellerLayout = lazy(() => import('./components/seller/SellerLayout'));
const SellerPanel = lazy(() => import('./pages/SellerPanel'));
const SellerProducts = lazy(() => import('./pages/SellerProducts'));
const SellerProductDetails = lazy(() => import('./pages/SellerProductDetails'));
const SellerOrders = lazy(() => import('./pages/SellerOrders'));
const SellerRevenueDashboard = lazy(() => import('./pages/SellerRevenueDashboard'));
const Profile = lazy(() => import('./pages/Profile'));
const TrackOrder = lazy(() => import('./pages/TrackOrder'));
const NotFound = lazy(() => import('./pages/NotFound'));
const ChatWidget = lazy(() => import('./components/ChatWidget'));

function LegacyProductRedirect() {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const productId = params.get('productId');
  if (!productId) return <Navigate to="/" replace />;
  params.delete('productId');
  const remainingSearch = params.toString();
  return <Navigate to={`${productPath(productId)}${remainingSearch ? `?${remainingSearch}` : ''}`} replace />;
}

function App() {
  const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '727040751924-qkthupthtsqnm97dubl7i4hsillldvqh.apps.googleusercontent.com';
  const isDemo = import.meta.env.VITE_DEMO_MODE !== 'false';

  useEffect(() => {
    // visualViewport.height shrinks to the area ABOVE the keyboard.
    // We compare the bottom of the focused element against that height
    // and scroll the page by exactly the overlap so the input is visible.
    const nudgeIntoView = () => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || !['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;

      const vv = window.visualViewport;
      if (!vv) return;

      const rect = el.getBoundingClientRect();
      // Use a larger buffer for textareas — cursor may be at the bottom row
      const BUFFER = el.tagName === 'TEXTAREA' ? 80 : 24;
      const viewportTop = vv.offsetTop + BUFFER;
      const viewportBottom = vv.offsetTop + vv.height - BUFFER;
      if (rect.bottom > viewportBottom) {
        window.scrollBy({ top: rect.bottom - viewportBottom, behavior: 'smooth' });
      } else if (rect.top < viewportTop) {
        window.scrollBy({ top: rect.top - viewportTop, behavior: 'smooth' });
      }
    };

    let frame: number | null = null;
    const scheduleVisibilityCheck = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        nudgeIntoView();
      });
    };

    window.visualViewport?.addEventListener('resize', scheduleVisibilityCheck);
    window.visualViewport?.addEventListener('scroll', scheduleVisibilityCheck);
    document.addEventListener('focusin', scheduleVisibilityCheck);

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      window.visualViewport?.removeEventListener('resize', scheduleVisibilityCheck);
      window.visualViewport?.removeEventListener('scroll', scheduleVisibilityCheck);
      document.removeEventListener('focusin', scheduleVisibilityCheck);
    };
  }, []);

  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <SessionRecovery>
      <Router>
        {isDemo && (
          <div className="fixed inset-x-0 top-0 z-[100] bg-brass px-3 py-1.5 text-center text-xs font-semibold text-white shadow-sm">
            Demo · synthetic data · sandbox payments only · no real orders or refunds
          </div>
        )}
        <div className={isDemo ? 'pt-8' : ''} data-demo-banner={isDemo ? 'true' : 'false'}>
        <Suspense fallback={<div className="min-h-screen bg-paper"><LoadingState description="Loading ShopSphere…" /></div>}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/ux-demo" element={<StorefrontDemo />} />
          <Route path="/ui-redesign-demo" element={<UiRedesignDemo />} />
          <Route path="/auth-landing" element={<AuthLanding />} />
          <Route path="/user-auth" element={<UserAuth />} />
          <Route path="/seller-auth" element={<UserAuth />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/admin-auth" element={<AdminAuth />} />
          <Route path="/auth" element={<AuthLanding />} />
          <Route path="/signin" element={<AuthLanding />} />
          <Route path="/signup" element={<AuthLanding />} />
          <Route path="/products/:productId" element={<ProductDetailsPage />} />
          <Route path="/product-details-page" element={<LegacyProductRedirect />} />
          <Route path="/product-details" element={<LegacyProductRedirect />} />
          <Route element={<ProtectedRoute role="customer" />}>
            <Route path="/cart" element={<Cart />} />
            <Route path="/cart-checkout" element={<CartCheckout />} />
            <Route path="/my-orders" element={<MyOrders />} />
            <Route path="/user/bills" element={<UserBillHistory />} />
            <Route path="/order/:orderId" element={<OrderDetails />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/track-order/:orderId" element={<TrackOrder />} />
            <Route path="/success/:orderId" element={<Success />} />
            <Route path="/failure/:orderId" element={<Failure />} />
            <Route path="/buy-product" element={<Navigate to="/cart-checkout" replace />} />
            <Route path="/checkout" element={<Navigate to="/cart-checkout" replace />} />
            <Route path="/orders" element={<Navigate to="/my-orders" replace />} />
            <Route path="/order-details" element={<Navigate to="/my-orders" replace />} />
            <Route path="/my-orders-new" element={<Navigate to="/my-orders" replace />} />
            <Route path="/bill-history" element={<Navigate to="/user/bills" replace />} />
          </Route>
          <Route element={<ProtectedRoute role="seller"><SellerLayout /></ProtectedRoute>}>
            <Route path="/seller/account" element={<Profile />} />
            <Route path="/seller-panel" element={<SellerPanel />} />
            <Route path="/seller-products" element={<SellerProducts />} />
            <Route path="/seller-products/:id" element={<SellerProductDetails />} />
            <Route path="/seller-product-details" element={<Navigate to="/seller-products" replace />} />
            <Route path="/seller-orders" element={<SellerOrders />} />
            <Route path="/add-product" element={<AddProduct />} />
            <Route path="/seller/revenue" element={<SellerRevenueDashboard />} />
            <Route path="/seller-revenue" element={<Navigate to="/seller/revenue" replace />} />
          </Route>
          <Route element={<ProtectedRoute role="admin"><AdminLayout /></ProtectedRoute>}>
            <Route path="/product-details-admin/:id" element={<ProductDetailsAdmin />} />
            <Route path="/all-products" element={<AllProducts />} />
            <Route path="/admin" element={<AdminPanel />} />
            <Route path="/admin/sellers" element={<AdminSellers />} />
            <Route path="/admin/sellers/:sellerId" element={<AdminSellerDetails />} />
            <Route path="/admin/sellers/:sellerId/products/new" element={<AdminAddSellerProduct />} />
            <Route path="/admin/seller-approvals" element={<AdminSellerApproval />} />
            <Route path="/admin/seller-approval" element={<Navigate to="/admin/seller-approvals" replace />} />
            <Route path="/admin/revenue" element={<AdminRevenueDashboard />} />
            <Route path="/admin/users" element={<AdminUserManagement />} />
            <Route path="/admin/promo-codes" element={<PromoManagement />} />
            <Route path="/admin/orders" element={<AdminOrders />} />
            <Route path="/admin-orders" element={<Navigate to="/admin/orders" replace />} />
            <Route path="/user-details" element={<Navigate to="/admin/users" replace />} />
            <Route path="/admin/orders/:orderId" element={<OrderDetails />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
        <ChatWidget />
        </Suspense>
        </div>
      </Router>
      </SessionRecovery>
    </GoogleOAuthProvider>
  );
}

export default App;
