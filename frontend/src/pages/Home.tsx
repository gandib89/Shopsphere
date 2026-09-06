import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { toast } from 'sonner';
import StorefrontView, { type StorefrontProduct } from '../components/StorefrontView';
import NotificationBell from '../components/NotificationBell';
import { Button } from '../components/ui/Button';
import { ErrorState, LoadingState } from '../components/ui/AsyncState';
import type { CatalogProduct } from '../components/catalog/ProductCard';
import { clearSession } from '../lib/session';
import { storefrontCategory, toStorefrontProduct, type LiveProduct } from '../lib/storefrontCatalog';

export type product = CatalogProduct;
const API = `${import.meta.env.VITE_BACKEND_URL || ''}/api/v1`;
type CartResponse = { data?: { items?: { quantity: number }[] } };
const cartQuantity = (response: CartResponse): number | null => Array.isArray(response.data?.items)
  ? response.data.items.reduce((total, item) => total + item.quantity, 0) : null;

export default function Home() {
  const navigate = useNavigate();
  const location = useLocation();
  const signedIn = Boolean(localStorage.getItem('token'));
  const isAdmin = localStorage.getItem('isAdmin') === 'true';
  const isSeller = localStorage.getItem('isSeller') === 'true';
  const buyer = signedIn && !isAdmin && !isSeller;
  const [products, setProducts] = useState<LiveProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [bagCount, setBagCount] = useState<number | null>(buyer ? null : 0);
  const [pendingProduct, setPendingProduct] = useState<string | null>(null);
  const pending = useRef(false);
  const cartRevision = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(false);
    // This endpoint is public. Authentication stays at the purchase boundary.
    axios.get<LiveProduct[]>(`${API}/product/get`, { signal: controller.signal })
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        if (!Array.isArray(data)) throw new Error('Unexpected catalogue response');
        setProducts(data);
      })
      .catch(() => { if (!controller.signal.aborted) setLoadError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [retry]);

  useEffect(() => {
    if (!buyer) { setBagCount(0); return; }
    const controller = new AbortController();
    const revision = cartRevision.current;
    axios.get<CartResponse>(`${API}/cart/get`, { signal: controller.signal })
      .then(({ data }) => {
        if (!controller.signal.aborted && revision === cartRevision.current) setBagCount(cartQuantity(data));
      })
      .catch(() => {
        if (!controller.signal.aborted && revision === cartRevision.current) setBagCount(null);
      });
    return () => controller.abort();
  }, [buyer]);

  const data = useMemo(() => products.map(toStorefrontProduct), [products]);

  const openDetails = (item: StorefrontProduct) => navigate(`/product-details-page?productId=${encodeURIComponent(item.id)}`);
  const addToCart = async (item: StorefrontProduct): Promise<boolean> => {
    if (!signedIn) { navigate('/auth'); return false; }
    if (!buyer || !item.inStock || pending.current) return false;
    if (item.requiresOptions) { openDetails(item); return false; }
    pending.current = true;
    cartRevision.current += 1;
    setPendingProduct(item.id);
    try {
      // The backend resolves the price. Never send the demo price or a client total.
      const response = await axios.post<CartResponse>(`${API}/cart/add`, { productId: item.id, quantity: 1 });
      setBagCount(cartQuantity(response.data));
      toast.success(`${item.name} added to cart`, { description: 'Review your bag before checkout.' });
      return true;
    } catch (error: unknown) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        clearSession();
        toast.error('Your session has expired. Please sign in again.');
        navigate('/auth');
      } else {
        const message = axios.isAxiosError<{ message?: string }>(error) ? error.response?.data?.message : undefined;
        toast.error(message || 'Could not add this product to your cart. Please try again.');
      }
      return false;
    } finally {
      pending.current = false;
      setPendingProduct(null);
    }
  };

  const params = new URLSearchParams(location.search);
  const category = storefrontCategory(params.get('category') || '');
  const query = params.get('q') || '';
  return (
    <StorefrontView products={data} live={{
      bagCount,
      canPurchase: !isAdmin && !isSeller,
      pendingProduct,
      onAddToCart: addToCart,
      onDetails: openDetails,
      onAccount: () => navigate(!signedIn ? '/auth' : isAdmin ? '/admin' : isSeller ? '/seller-panel' : '/profile'),
      onBag: () => navigate(signedIn ? '/cart' : '/auth'),
      accountActions: signedIn ? <div data-section-scroll-ignore><NotificationBell /></div> : undefined,
      category,
      query,
      catalogStatus: loading ? <LoadingState description="Loading current inventory…" /> : loadError ? (
        <ErrorState title="We couldn’t load the catalogue" description="Check your connection and try again."
          action={<Button onClick={() => setRetry(value => value + 1)}>Try again</Button>} />
      ) : undefined,
    }} />
  );
}
