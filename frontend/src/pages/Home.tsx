import { useEffect, useMemo, useState } from 'react';
import { CreditCard, Headphones, Search, ShieldCheck, Truck } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import axios from 'axios';
import { toast } from 'sonner';
import Footer from '../components/Footer';
import NavBar from '../components/NavBar';
import { ProductCard, type CatalogProduct } from '../components/catalog/ProductCard';
import { Button } from '../components/ui/Button';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/AsyncState';

export type product = CatalogProduct;

const DISPLAY_TO_CATEGORY: Record<string, string> = {
  iPhone: 'Mobile Phones',
  MacBook: 'Laptops',
  'Mac Mini': 'Mac Mini',
  iPad: 'Tablets',
  'Apple Watch': 'Smartwatches',
  Accessories: 'Accessories',
};

const categoryDisplayName: Record<string, string> = Object.fromEntries(
  Object.entries(DISPLAY_TO_CATEGORY).map(([label, value]) => [value, label]),
);

const getCategoryLabel = (category: string) => categoryDisplayName[category] ?? category;

const getAverageRating = (item: product) => {
  if (!item.reviews?.length) return 0;
  return item.reviews.reduce((total, review) => total + review.rating, 0) / item.reviews.length;
};

function Home() {
  const token = localStorage.getItem('token');
  const isAdmin = localStorage.getItem('isAdmin') === 'true';
  const isSeller = localStorage.getItem('isSeller') === 'true';
  const canPurchase = Boolean(token && !isAdmin && !isSeller);
  const location = useLocation();

  const [data, setData] = useState<product[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchPerformed, setIsSearchPerformed] = useState(false);
  const [sortOrder, setSortOrder] = useState('top-rated');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [isLoading, setIsLoading] = useState(Boolean(token));
  const [loadError, setLoadError] = useState(false);

  const categories = useMemo(() => {
    const fetched = data.map((item) => item.category).filter(Boolean);
    return ['All', ...Array.from(new Set([...Object.values(DISPLAY_TO_CATEGORY), ...fetched]))];
  }, [data]);

  const openProduct = (item: product) => {
    window.location.hash = `/product-details-page?productId=${item._id}`;
  };

  const handleAddToCart = async (item: product) => {
    if (!token) {
      window.location.hash = '/auth';
      return;
    }

    try {
      await axios.post(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/cart/add`,
        { productId: item._id, productName: item.name, productPrice: item.price, quantity: 1 },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      toast.success(`${item.name} added to cart`, {
        description: 'You can review it before checkout.',
        duration: 3000,
      });
    } catch (error: any) {
      const status = error?.response?.status;
      if (status === 401 || status === 403) {
        toast.error('Your session has expired. Please sign in again.');
        localStorage.removeItem('token');
        localStorage.removeItem('isAdmin');
        localStorage.removeItem('isSeller');
        localStorage.removeItem('userId');
        window.location.hash = '/auth';
        return;
      }
      toast.error(error?.response?.data?.message || 'Could not add this product to your cart.');
    }
  };

  const handleSearch = async () => {
    if (!token) {
      window.location.hash = '/auth';
      return;
    }

    setIsLoading(true);
    setLoadError(false);
    try {
      const response = await axios.get(`${import.meta.env.VITE_BACKEND_URL}/api/v1/product/search`, {
        params: { type: 'name', query: searchQuery },
        headers: { Authorization: `Bearer ${token}` },
      });
      setData(response.data || []);
      setIsSearchPerformed(true);
      setSelectedCategory('All');
    } catch {
      setData([]);
      setIsSearchPerformed(true);
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  };

  const getData = async () => {
    if (!token) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setLoadError(false);
    try {
      const response = await axios.get(`${import.meta.env.VITE_BACKEND_URL}/api/v1/product/get`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setData(response.data || []);
    } catch {
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    getData();
  }, []);

  useEffect(() => {
    const categoryParam = new URLSearchParams(location.search).get('category');
    if (!categoryParam) return;
    const decoded = decodeURIComponent(categoryParam);
    setSelectedCategory(DISPLAY_TO_CATEGORY[decoded] || decoded);
    setIsSearchPerformed(false);
  }, [location.search]);

  const sortedData = [...data]
    .filter((item) => selectedCategory === 'All' || item.category === selectedCategory)
    .sort((a, b) => {
      if (sortOrder === 'low-to-high') return a.price - b.price;
      if (sortOrder === 'high-to-low') return b.price - a.price;
      return getAverageRating(b) - getAverageRating(a);
    });

  return (
    <>
      <NavBar />
      <main className="min-h-screen bg-paper">
        <section className="border-b border-hairline bg-paper-raised">
          <div className="container-store grid items-center gap-8 py-10 md:grid-cols-[1.05fr_0.95fr] md:gap-14 md:py-16 lg:py-20">
            <div className="max-w-2xl">
              <p className="mb-4 text-sm font-semibold text-brass">Premium Apple marketplace · Nepal</p>
              <h1 className="max-w-xl text-4xl font-semibold leading-[1.03] tracking-[-0.045em] text-ink sm:text-5xl lg:text-6xl">
                Premium tech, sold with clarity.
              </h1>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-muted sm:text-lg">
                Shop genuine devices and accessories from vetted sellers, with transparent stock, secure eSewa payment, and local support.
              </p>

              <div className="mt-8 flex max-w-xl rounded-[var(--radius-control)] border border-hairline bg-paper-raised p-1.5 focus-within:border-brass">
                <label htmlFor="store-search" className="sr-only">Search the ShopSphere catalogue</label>
                <Search aria-hidden="true" className="ml-3 mt-3 h-4 w-4 shrink-0 text-ink-muted" />
                <input
                  id="store-search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && handleSearch()}
                  placeholder="Search iPhone, MacBook, accessories…"
                  className="min-w-0 flex-1 bg-transparent px-3 text-sm text-ink outline-none placeholder:text-ink-muted/70"
                />
                <Button onClick={handleSearch} className="shrink-0">Search</Button>
              </div>
              {!token && <p className="mt-3 text-xs text-ink-muted">Sign in to view live inventory and seller listings.</p>}
            </div>

            <div className="relative mx-auto w-full max-w-xl overflow-hidden rounded-[var(--radius-surface)] bg-paper">
              <div className="aspect-[5/4] p-5 sm:p-8">
                <img src="/images/iphone17pm.jpg" alt="iPhone models available on ShopSphere" width="1000" height="1000" loading="eager" decoding="async" className="h-full w-full object-contain" />
              </div>
              <div className="absolute inset-x-4 bottom-4 flex items-center justify-between rounded-[var(--radius-control)] border border-hairline bg-paper-raised/95 px-4 py-3 sm:inset-x-6 sm:bottom-6">
                <div>
                  <p className="text-xs text-ink-muted">Curated for ShopSphere</p>
                  <p className="text-sm font-semibold text-ink">Current-generation devices</p>
                </div>
                <span className="text-xs font-semibold text-brass">Vetted sellers</span>
              </div>
            </div>
          </div>
        </section>

        <section aria-labelledby="catalog-title" className="container-store py-10 md:py-14">
          <div className="flex flex-col gap-5 border-b border-hairline pb-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 id="catalog-title" className="text-2xl font-semibold tracking-[-0.03em] text-ink sm:text-3xl">
                {isSearchPerformed ? 'Search results' : selectedCategory === 'All' ? 'Explore the catalogue' : getCategoryLabel(selectedCategory)}
              </h2>
              <p className="mt-1 text-sm text-ink-muted">
                {token ? `${sortedData.length} ${sortedData.length === 1 ? 'product' : 'products'}` : 'Live inventory is available after sign-in'}
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex max-w-full gap-1 overflow-x-auto pb-1 scrollbar-hide" aria-label="Product categories">
                {categories.map((category) => (
                  <button
                    key={category}
                    type="button"
                    onClick={() => { setSelectedCategory(category); setIsSearchPerformed(false); }}
                    aria-pressed={selectedCategory === category}
                    className={`min-h-10 shrink-0 rounded-[var(--radius-control)] px-3 text-sm font-medium transition-colors ${selectedCategory === category ? 'bg-ink text-white' : 'text-ink-muted hover:bg-paper-raised hover:text-ink'}`}
                  >
                    {category === 'All' ? 'All' : getCategoryLabel(category)}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-2 text-sm text-ink-muted">
                <span className="shrink-0">Sort</span>
                <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} className="min-h-10 rounded-[var(--radius-control)] border border-hairline bg-paper-raised px-3 text-sm text-ink">
                  <option value="top-rated">Top rated</option>
                  <option value="low-to-high">Price: low to high</option>
                  <option value="high-to-low">Price: high to low</option>
                </select>
              </label>
            </div>
          </div>

          {isLoading ? (
            <LoadingState description="Loading current inventory…" />
          ) : loadError ? (
            <ErrorState title="We couldn’t load the catalogue" description="Check your connection and try again." action={<Button onClick={getData}>Try again</Button>} />
          ) : sortedData.length ? (
            <div className="mt-7 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {sortedData.map((item) => (
                <ProductCard key={item._id} product={item} canPurchase={canPurchase} onOpen={openProduct} onAddToCart={handleAddToCart} />
              ))}
            </div>
          ) : (
            <EmptyState
              title={isSearchPerformed ? 'No matching products' : token ? 'No products available' : 'Sign in to see live products'}
              description={isSearchPerformed ? 'Try a broader search or another category.' : token ? 'Inventory will appear here as soon as sellers add it.' : 'ShopSphere shows current stock and seller information to signed-in buyers.'}
              action={isSearchPerformed ? (
                <Button variant="secondary" onClick={() => { setIsSearchPerformed(false); setSelectedCategory('All'); getData(); }}>Clear search</Button>
              ) : !token ? (
                <Button onClick={() => { window.location.hash = '/auth'; }}>Sign in to browse</Button>
              ) : undefined}
            />
          )}
        </section>

        <section aria-labelledby="trust-title" className="border-y border-hairline bg-paper-raised">
          <div className="container-store py-9 md:py-11">
            <div className="max-w-xl">
              <p className="text-sm font-semibold text-brass">Built for confident purchases</p>
              <h2 id="trust-title" className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-ink">The essentials, handled properly.</h2>
            </div>
            <div className="mt-7 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { icon: ShieldCheck, title: 'Vetted sellers', detail: 'Seller access is reviewed before products go live.' },
                { icon: CreditCard, title: 'Secure eSewa payment', detail: 'A familiar local payment flow with clear outcomes.' },
                { icon: Truck, title: 'Nepal delivery', detail: 'Delivery details and order status stay visible.' },
                { icon: Headphones, title: 'Local support', detail: 'Help from ShopSphere in Pokhara when you need it.' },
              ].map(({ icon: Icon, title, detail }) => (
                <div key={title} className="flex gap-3">
                  <Icon aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-brass" />
                  <div>
                    <h3 className="text-sm font-semibold text-ink">{title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-ink-muted">{detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

export default Home;
