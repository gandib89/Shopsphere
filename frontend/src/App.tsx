import { useEffect, Suspense, lazy } from 'react';
import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { LoadingState } from './components/ui/AsyncState';
import { refreshSession } from './lib/session';
import { ProtectedRoute } from './components/auth/ProtectedRoute';

// Lazy-load every page so only the current route's JS is downloaded on first load
const Home = lazy(() => import('./pages/Home'));
const AuthLanding = lazy(() => import('./pages/AuthLanding'));
const UserAuth = lazy(() => import('./pages/UserAuth'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const AdminAuth = lazy(() => import('./pages/AdminAuth'));
const AddProduct = lazy(() => import('./pages/AddProduct'));
const Cart = lazy(() => import('./pages/Cart'));
const BuyProduct = lazy(() => import('./pages/BuyProduct'));
const CartCheckout = lazy(() => import('./pages/CartCheckout'));
const ProductDetailsPage = lazy(() => import('./pages/ProductDetailsPage'));
const ProductDetailsAdmin = lazy(() => import('./pages/ProductDetailsAdmin'));
const AllProducts = lazy(() => import('./pages/AllProducts'));
const AdminPanel = lazy(() => import('./pages/AdminPanel'));
const AdminSellerApproval = lazy(() => import('./pages/AdminSellerApproval'));
const AdminRevenueDashboard = lazy(() => import('./pages/AdminRevenueDashboard'));
const AdminUserManagement = lazy(() => import('./pages/AdminUserManagement'));
const PromoManagement = lazy(() => import('./pages/PromoManagement'));
const OrderDetails = lazy(() => import('./pages/OrderDetails'));
const UserDetails = lazy(() => import('./pages/UserDetails'));
const UserBillHistory = lazy(() => import('./pages/UserBillHistory'));
const MyOrders = lazy(() => import('./pages/MyOrders'));
const MyOrdersNew = lazy(() => import('./pages/MyOrdersNew'));
const AdminOrders = lazy(() => import('./pages/AdminOrders'));
const Success = lazy(() => import('./pages/Success'));
const Failure = lazy(() => import('./pages/Failure'));
const SellerPanel = lazy(() => import('./pages/SellerPanel'));
const SellerProducts = lazy(() => import('./pages/SellerProducts'));
const SellerProductDetails = lazy(() => import('./pages/SellerProductDetails'));
const SellerOrders = lazy(() => import('./pages/SellerOrders'));
const SellerRevenueDashboard = lazy(() => import('./pages/SellerRevenueDashboard'));
const Profile = lazy(() => import('./pages/Profile'));
const TrackOrder = lazy(() => import('./pages/TrackOrder'));
const ChatWidget = lazy(() => import('./components/ChatWidget'));

function App() {
  const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '727040751924-qkthupthtsqnm97dubl7i4hsillldvqh.apps.googleusercontent.com';
  const isDemo = import.meta.env.VITE_DEMO_MODE !== 'false';

  useEffect(() => {
    // Access tokens live in memory only, so a hard reload starts with none —
    // this trades the refresh cookie for a fresh one if the session is still valid.
    if (localStorage.getItem('token')) refreshSession();
  }, []);

  useEffect(() => {
    // visualViewport.height shrinks to the area ABOVE the keyboard.
    // We compare the bottom of the focused element against that height
    // and scroll the page by exactly the overlap so the input is visible.
    const nudgeIntoView = () => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || !['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;

      const vv = window.visualViewport;
      if (!vv) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

      const rect = el.getBoundingClientRect();
      // Use a larger buffer for textareas — cursor may be at the bottom row
      const BUFFER = el.tagName === 'TEXTAREA' ? 80 : 24;
      const overlap = rect.bottom - (vv.height - BUFFER);
      if (overlap > 0) {
        window.scrollBy({ top: overlap, behavior: 'smooth' });
      }
    };

    // Fire at multiple points during keyboard animation to catch any stage
    const onFocusIn = () => {
      setTimeout(nudgeIntoView, 50);
      setTimeout(nudgeIntoView, 250);
      setTimeout(nudgeIntoView, 500);
      setTimeout(nudgeIntoView, 800);
    };

    // Also react as the viewport resizes (keyboard fully open)
    window.visualViewport?.addEventListener('resize', nudgeIntoView);
    document.addEventListener('focusin', onFocusIn);

    return () => {
      window.visualViewport?.removeEventListener('resize', nudgeIntoView);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, []);

  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <Router>
        {isDemo && (
          <div className="fixed inset-x-0 top-0 z-[100] bg-brass px-3 py-1.5 text-center text-xs font-semibold text-white shadow-sm">
            Demo · synthetic data · sandbox payments only · no real orders or refunds
          </div>
        )}
        <div className={isDemo ? 'pt-8' : ''}>
        <Suspense fallback={<div className="min-h-screen bg-paper"><LoadingState description="Loading ShopSphere…" /></div>}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/auth-landing" element={<AuthLanding />} />
          <Route path="/user-auth" element={<UserAuth />} />
          <Route path="/seller-auth" element={<UserAuth />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/admin-auth" element={<AdminAuth />} />
          <Route path="/auth" element={<AuthLanding />} />
          <Route path="/signin" element={<AuthLanding />} />
          <Route path="/signup" element={<AuthLanding />} />
          <Route path="/add-product" element={<ProtectedRoute role="seller"><AddProduct /></ProtectedRoute>} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/buy-product" element={<BuyProduct />} />
          <Route path="/product-details-page" element={<ProductDetailsPage />} />
          <Route path="/product-details" element={<ProductDetailsPage />} />
          <Route path="/product-details-admin/:id" element={<ProtectedRoute role="admin"><ProductDetailsAdmin /></ProtectedRoute>} />
          <Route path="/all-products" element={<AllProducts />} />
          <Route path="/cart-checkout" element={<CartCheckout />} />
          <Route path="/checkout" element={<CartCheckout />} />
          <Route path="/orders" element={<OrderDetails />} />
          <Route path="/order-details" element={<OrderDetails />} />
          <Route path="/order/:orderId" element={<OrderDetails />} />
          <Route path="/admin" element={<ProtectedRoute role="admin"><AdminPanel /></ProtectedRoute>} />
          <Route path="/admin/seller-approvals" element={<ProtectedRoute role="admin"><AdminSellerApproval /></ProtectedRoute>} />
          <Route path="/admin/seller-approval" element={<ProtectedRoute role="admin"><AdminSellerApproval /></ProtectedRoute>} />
          <Route path="/admin/revenue" element={<ProtectedRoute role="admin"><AdminRevenueDashboard /></ProtectedRoute>} />
          <Route path="/admin/users" element={<ProtectedRoute role="admin"><AdminUserManagement /></ProtectedRoute>} />
          <Route path="/admin/promo-codes" element={<ProtectedRoute role="admin"><PromoManagement /></ProtectedRoute>} />
          <Route path="/admin/orders" element={<ProtectedRoute role="admin"><AdminOrders /></ProtectedRoute>} />
          <Route path="/admin-orders" element={<ProtectedRoute role="admin"><AdminOrders /></ProtectedRoute>} />
          <Route path="/my-orders" element={<MyOrders />} />
          <Route path="/my-orders-new" element={<MyOrdersNew />} />
          <Route path="/user/bills" element={<UserBillHistory />} />
          <Route path="/bill-history" element={<UserBillHistory />} />
          <Route path="/user-details" element={<ProtectedRoute role="admin"><UserDetails /></ProtectedRoute>} />
          <Route path="/success/:orderId" element={<Success />} />
          <Route path="/failure/:orderId" element={<Failure />} />
          <Route path="/seller-panel" element={<ProtectedRoute role="seller"><SellerPanel /></ProtectedRoute>} />
          <Route path="/seller-products" element={<ProtectedRoute role="seller"><SellerProducts /></ProtectedRoute>} />
          <Route path="/seller-products/:id" element={<ProtectedRoute role="seller"><SellerProductDetails /></ProtectedRoute>} />
          <Route path="/seller-product-details" element={<ProtectedRoute role="seller"><SellerProductDetails /></ProtectedRoute>} />
          <Route path="/seller-orders" element={<ProtectedRoute role="seller"><SellerOrders /></ProtectedRoute>} />
          <Route path="/seller/revenue" element={<ProtectedRoute role="seller"><SellerRevenueDashboard /></ProtectedRoute>} />
          <Route path="/seller-revenue" element={<ProtectedRoute role="seller"><SellerRevenueDashboard /></ProtectedRoute>} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/track-order/:orderId" element={<TrackOrder />} />
        </Routes>
        <ChatWidget />
        </Suspense>
        </div>
      </Router>
    </GoogleOAuthProvider>
  );
}

export default App;
