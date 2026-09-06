import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import CompareBar from './CompareBar';
import { useCompare, MAX_COMPARE, type CompareItem } from '../lib/compareStore';
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Headphones,
  PackageCheck,
  Scale,
  Search,
  ShieldCheck,
  ShoppingBag,
  Star,
  X,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import DemoHeader from './DemoHeader';
import Footer from './Footer';
import CatalogFilters, { catalogFilterRank, emptyFilters, matchesCatalogFilters, type CatalogFilterValue } from './catalog/CatalogFilters';
import { Button, IconButton } from './ui/Button';
import '../pages/ui-redesign-demo.css';
import '../pages/storefront-demo.css';

export type StorefrontProduct = {
  id: string;
  name: string;
  category: string;
  brand?: string;
  price: number;
  rating: number;
  reviews: number;
  image: string;
  imageBackground: 'white' | 'dark';
  imageFit?: 'cover';
  note: string;
  description?: string;
  inStock?: boolean;
  previousPrice?: number;
  priceFrom?: boolean;
  requiresOptions?: boolean;
};

type LiveStorefront = {
  bagCount: number | null;
  canPurchase: boolean;
  pendingProduct: string | null;
  onAddToCart: (product: StorefrontProduct) => Promise<boolean>;
  onDetails: (product: StorefrontProduct) => void;
  onAccount: () => void;
  onBag: () => void;
  catalogStatus?: ReactNode;
  accountActions?: ReactNode;
  category: string;
  query?: string;
};

const formatNpr = (amount: number) => `NPR ${new Intl.NumberFormat('en-NP').format(amount)}`;
const CATALOGUE_PAGE_SIZE = 6;

export default function StorefrontView({ products, live }: { products: StorefrontProduct[]; live?: LiveStorefront }) {
  const searchCategories = ['All', ...new Set(products.map((product) => product.category))];
  const navigate = useNavigate();
  const [bagOpen, setBagOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<CatalogFilterValue>(emptyFilters);
  const [showFullCatalogue, setShowFullCatalogue] = useState(false);
  const [searchCategory, setSearchCategory] = useState('All');
  const [categoryOpen, setCategoryOpen] = useState(false);
  const searchForm = useRef<HTMLFormElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const categoryToggle = useRef<HTMLButtonElement>(null);
  const categoryOptions = useRef<Array<HTMLButtonElement | null>>([]);
  const [cartItems, setCartItems] = useState<string[]>([]);
  const [addedProductId, setAddedProductId] = useState<string | null>(null);
  const [quickView, setQuickView] = useState<StorefrontProduct | null>(null);
  const quickViewTrigger = useRef<HTMLButtonElement | null>(null);
  const compare = useCompare();
  const catalogue = useRef<HTMLElement>(null);
  const demoRoot = useRef<HTMLDivElement>(null);
  const productScroller = useRef<HTMLDivElement | null>(null);
  const catalogueScroller = useRef<HTMLDivElement | null>(null);
  const productScrollerObserver = useRef<ResizeObserver | null>(null);
  const [cardStep, setCardStep] = useState<number | null>(null);
  const [scrollState, setScrollState] = useState({ atStart: true, atEnd: true });
  const [catalogueScrollState, setCatalogueScrollState] = useState({ atStart: true, atEnd: true });
  const cardGap = 16;
  const targetCardWidth = 240;

  // Product-data changes replace the Popular strip, so return it to the beginning. Catalogue
  // search and filter state must not affect this independent section.
  useEffect(() => {
    productScroller.current?.scrollTo({ left: 0 });
  }, [products]);

  useEffect(() => {
    catalogueScroller.current?.scrollTo({ left: 0 });
  }, [products, filters, query, searchCategory]);

  // Size cards so an exact whole number fill the strip's width — no card is ever left
  // half-cut at the trailing edge. The strip only exists in the DOM once products have loaded
  // (it's inside the `visibleProducts.length ? ... : <empty state>` branch), so a plain
  // useLayoutEffect keyed on mount would run too early and never fire again. A callback ref
  // measures exactly when the node actually appears (or its size changes) instead.
  const measureCardStep = useCallback((el: HTMLDivElement) => {
    const width = el.clientWidth;
    if (!width) return;
    const count = Math.max(1, Math.floor((width + cardGap) / (targetCardWidth + cardGap)));
    setCardStep((width - (count - 1) * cardGap) / count + cardGap);
  }, []);
  // Memoized so React treats it as the same ref across re-renders — an inline callback ref
  // gets torn down and reattached (disconnecting the observer) on every render, including the
  // very state update the measurement itself triggers, which meant it never stuck.
  const setProductScroller = useCallback((el: HTMLDivElement | null) => {
    productScrollerObserver.current?.disconnect();
    productScroller.current = el;
    if (!el) return;
    // The element can still read a 0 width at the instant the ref attaches (layout not yet
    // committed by the browser); a follow-up measurement next frame catches the real size.
    measureCardStep(el);
    requestAnimationFrame(() => measureCardStep(el));
    const observer = new ResizeObserver(() => measureCardStep(el));
    observer.observe(el);
    productScrollerObserver.current = observer;
  }, [measureCardStep]);

  const updateScrollEdges = () => {
    const el = productScroller.current;
    if (!el) return;
    setScrollState({
      atStart: el.scrollLeft <= 1,
      atEnd: el.scrollLeft >= el.scrollWidth - el.clientWidth - 1,
    });
  };
  useEffect(updateScrollEdges, [cardStep, products]);

  // Advance by one complete visible group while keeping the next group aligned to a card.
  // The extra gap accounts for the gap after the final card in the current group.
  const slideProducts = (direction: 1 | -1) => {
    const el = productScroller.current;
    if (!el || !cardStep) return;
    el.scrollBy({ left: direction * (el.clientWidth + cardGap), behavior: 'smooth' });
  };

  const updateCatalogueScrollEdges = () => {
    const el = catalogueScroller.current;
    if (!el) return;
    setCatalogueScrollState({
      atStart: el.scrollLeft <= 1,
      atEnd: el.scrollLeft >= el.scrollWidth - el.clientWidth - 1,
    });
  };

  const slideCatalogueProducts = (direction: 1 | -1) => {
    const el = catalogueScroller.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth, behavior: 'smooth' });
  };


  useEffect(() => {
    if (showFullCatalogue) return;
    updateCatalogueScrollEdges();
    const el = catalogueScroller.current;
    if (!el) return;
    const frame = requestAnimationFrame(updateCatalogueScrollEdges);
    const observer = new ResizeObserver(updateCatalogueScrollEdges);
    observer.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [products, cardStep, filters, query, searchCategory, showFullCatalogue]);

  useLayoutEffect(() => {
    const root = demoRoot.current;
    const hero = root?.querySelector<HTMLElement>('.ux-demo-hero-section');
    const header = root?.querySelector('.ux-demo-header-theme');
    if (!hero || !header) return;
    // Measure the hero's normal document position, even when resizing mid-scroll.
    const sizeHero = () => {
      const top = hero.getBoundingClientRect().top + window.scrollY;
      hero.style.setProperty('--ux-demo-hero-top', `${top}px`);
    };
    sizeHero();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(sizeHero);
    observer?.observe(header);
    window.addEventListener('resize', sizeHero);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', sizeHero);
    };
  }, []);

  const routeCategory = live?.category;
  const routeQuery = live?.query ?? '';
  useEffect(() => {
    if (routeCategory === undefined) return;
    setFilters(emptyFilters);
    setSearchCategory(routeCategory || 'All');
    setSearchTerm(routeQuery);
    setQuery(routeQuery);
    // The header search lives outside this view, so a ?q= arrival has to land on the catalogue too.
    if (routeCategory || routeQuery) requestAnimationFrame(() => catalogue.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, [routeCategory, routeQuery]);

  useEffect(() => {
    if (!addedProductId) return;
    const timeout = window.setTimeout(() => setAddedProductId(null), 1600);
    return () => window.clearTimeout(timeout);
  }, [addedProductId, cartItems.length]);

  useEffect(() => {
    if (!categoryOpen) return;
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !searchForm.current?.contains(event.target)) setCategoryOpen(false);
    };
    document.addEventListener('pointerdown', dismissOutside);
    return () => document.removeEventListener('pointerdown', dismissOutside);
  }, [categoryOpen]);

  const visibleProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return products
      .map((product, sourceIndex) => ({ product, sourceIndex }))
      .filter(({ product }) => {
        const matchesQuery = !normalizedQuery || `${product.name} ${product.category}`.toLowerCase().includes(normalizedQuery);
        return matchesQuery && (searchCategory === 'All' || product.category === searchCategory) && matchesCatalogFilters(product, filters);
      })
      .sort((a, b) => catalogFilterRank(b.product, filters) - catalogFilterRank(a.product, filters) || a.sourceIndex - b.sourceIndex)
      .map(({ product }) => product);
  }, [products, query, searchCategory, filters]);

  // One tile per category the catalogue actually carries, illustrated by its first product —
  // category navigation is the path most shoppers take, and the header dropdown alone hides it.
  const categoryTiles = useMemo(() => {
    const tiles = new Map<string, { category: string; count: number; image: string; background: StorefrontProduct['imageBackground'] }>();
    for (const product of products) {
      const tile = tiles.get(product.category);
      if (tile) tile.count += 1;
      else tiles.set(product.category, { category: product.category, count: 1, image: product.image, background: product.imageBackground });
    }
    return [...tiles.values()].sort((a, b) => b.count - a.count);
  }, [products]);

  const browseProducts = () => {
    setFilters(emptyFilters);
    setQuery('');
    setSearchTerm('');
    setSearchCategory('All');
    setShowFullCatalogue(false);
    setCategoryOpen(false);
    // Drop ?category= as well, or the cleared view still reloads and shares as that category.
    if (live?.category) navigate('/');
    requestAnimationFrame(() => catalogue.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const submitSearch = () => {
    setQuery(searchTerm.trim());
    setCategoryOpen(false);
    requestAnimationFrame(() => catalogue.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const selectSearchCategory = (category: string) => {
    setFilters(emptyFilters);
    setSearchCategory(category);
    categoryToggle.current?.focus();
    submitSearch();
  };

  const closeQuickView = () => {
    setQuickView(null);
    quickViewTrigger.current?.focus();
  };

  const addToCart = async (product: StorefrontProduct) => {
    if (live) {
      if (!live.canPurchase || product.requiresOptions) { live.onDetails(product); return; }
      if (product.inStock === false || live.pendingProduct) return;
      setAddedProductId(null);
      if (!await live.onAddToCart(product)) return;
    } else {
      setCartItems((current) => [...current, product.id]);
    }
    setAddedProductId(product.id);
    if (quickView) closeQuickView();
  };

  const actionLabel = (product: StorefrontProduct) => {
    if (live && !live.canPurchase) return 'View details';
    if (product.inStock === false) return 'Sold out';
    if (product.requiresOptions) return 'Choose options';
    if (live?.pendingProduct === product.id) return 'Adding…';
    return addedProductId === product.id ? 'Added to bag' : 'Add to cart';
  };

  const disablePurchase = (product: StorefrontProduct) => Boolean(live?.canPurchase && (product.inStock === false || live.pendingProduct));

  // The list itself lives in the shared store, so a product added here is still selected after
  // the shopper opens a product page.
  const toCompareItem = (product: StorefrontProduct): CompareItem => ({
    id: product.id,
    name: product.name,
    category: product.category,
    price: product.price,
    previousPrice: product.previousPrice,
    rating: product.rating,
    reviews: product.reviews,
    image: product.image,
    imageBackground: product.imageBackground,
    inStock: product.inStock,
    description: product.description || product.note,
  });

  const compareCategory = compare.category;
  const compareFull = compare.items.length >= MAX_COMPARE;
  const comparing = (product: StorefrontProduct) => compare.has(product.id);
  const compareLocked = (product: StorefrontProduct) => compare.locked(toCompareItem(product));
  const toggleCompare = (product: StorefrontProduct) => compare.toggle(toCompareItem(product));

  const renderProductCard = (product: StorefrontProduct, placement: 'popular' | 'catalogue') => {
    const elementId = `${placement}-${product.id}`;
    const popularLabel = placement === 'popular' ? 'Popular product: ' : '';

    return (
    <article key={product.id} className="ux-demo-product-card">
      <div className={`ux-demo-product-media ux-demo-product-image${product.imageFit === 'cover' ? ' ux-demo-product-image-cover' : ''}`} data-background={product.imageBackground}>
        <img src={product.image} alt="" loading="lazy" onError={(event) => {
          if (live && !event.currentTarget.src.endsWith('/images/product-placeholder.svg')) event.currentTarget.src = '/images/product-placeholder.svg';
        }} />
      </div>
      <div className="ux-demo-product-copy">
        <h3 id={`${elementId}-name`}>{product.name}</h3>
        <p id={`${elementId}-note`}>{product.note}</p>
        {live && <p className="storefront-price">{product.priceFrom ? `From ${formatNpr(product.price)}` : formatNpr(product.price)} {product.previousPrice && <del>{formatNpr(product.previousPrice)}</del>}</p>}
        <ChevronRight aria-hidden="true" />
      </div>
      <button
        type="button"
        className="ux-demo-product-open"
        aria-label={placement === 'popular' ? `${popularLabel}${product.name}` : undefined}
        aria-labelledby={placement === 'catalogue' ? `${elementId}-name` : undefined}
        aria-describedby={`${elementId}-note`}
        aria-haspopup="dialog"
        onClick={(event) => { quickViewTrigger.current = event.currentTarget; setQuickView(product); }}
      />
      <div className="ux-demo-product-actions">
        <button
          type="button"
          className="ux-demo-product-add"
          aria-label={`${popularLabel}${live ? actionLabel(product) : 'Add to cart'}: ${product.name}`}
          disabled={disablePurchase(product)}
          aria-busy={live?.pendingProduct === product.id}
          onClick={() => addToCart(product)}
        >
          {addedProductId === product.id ? <Check aria-hidden="true" /> : <ShoppingBag aria-hidden="true" />}
          <span>{actionLabel(product)}</span>
        </button>
        <button
          type="button"
          className="ux-demo-product-compare"
          aria-pressed={comparing(product)}
          aria-label={`${popularLabel}Compare ${product.name}`}
          disabled={compareLocked(product)}
          title={compareLocked(product)
            ? compareFull
              ? `Comparing ${MAX_COMPARE} products already`
              : `Only ${compareCategory} products can join this comparison`
            : undefined}
          onClick={() => toggleCompare(product)}
        >
          <Scale aria-hidden="true" />
          <span>{comparing(product) ? 'Selected' : 'Compare'}</span>
        </button>
      </div>
    </article>
    );
  };

  const popularProductCards = [...products]
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 8)
    .map((product) => renderProductCard(product, 'popular'));
  const catalogueProductCards = visibleProducts.map((product) => renderProductCard(product, 'catalogue'));
  const cataloguePages = Array.from(
    { length: Math.ceil(visibleProducts.length / CATALOGUE_PAGE_SIZE) },
    (_, pageIndex) => catalogueProductCards.slice(
      pageIndex * CATALOGUE_PAGE_SIZE,
      (pageIndex + 1) * CATALOGUE_PAGE_SIZE,
    ),
  );

  return (
    <div ref={demoRoot} className={`ux-demo min-h-screen bg-paper text-ink ${live ? 'storefront-live' : 'pt-2.5 sm:pt-0'}`} data-theme="light">
      <a href="#demo-main" onClick={(event) => {
        event.preventDefault();
        const main = demoRoot.current?.querySelector<HTMLElement>('main');
        main?.focus({ preventScroll: true });
        main?.scrollIntoView({ behavior: 'instant', block: 'start' });
      }} className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-12 focus:z-50 focus:bg-paper-raised focus:px-4 focus:py-3">
        {live ? 'Skip to store content' : 'Skip to demo content'}
      </a>

      <div className="ui-redesign ux-demo-header-theme palette-emerald theme-light">
        <DemoHeader
          homePath={live ? '/' : '/ux-demo'}
          homeLabel={live ? 'ShopSphere home' : 'ShopSphere demo home'}
          navigationLabel={live ? 'Main navigation' : 'Demo navigation'}
          bagCount={live ? live.bagCount : cartItems.length}
          accountActions={live?.accountActions}
          headerSearch={
            <form
              ref={searchForm}
              role="search"
              aria-label="Product search"
              className="ux-demo-header-search"
              onSubmit={(event) => { event.preventDefault(); submitSearch(); }}
              onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setCategoryOpen(false); }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  searchInput.current?.focus();
                  setCategoryOpen(false);
                }
              }}
            >
              <input
                ref={searchInput}
                type="search"
                name="q"
                aria-label="Search products"
                placeholder={searchCategory === 'All' ? 'Search products...' : `Search ${searchCategory}...`}
                value={searchTerm}
                onFocus={() => setCategoryOpen(true)}
                onClick={() => setCategoryOpen(true)}
                onChange={(event) => { setSearchTerm(event.target.value); setCategoryOpen(true); }}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    setCategoryOpen(true);
                    requestAnimationFrame(() => categoryOptions.current[0]?.focus());
                  }
                }}
                enterKeyHint="search"
                className="ux-demo-search-input"
              />
              <button
                ref={categoryToggle}
                type="button"
                className="ux-demo-category-toggle"
                aria-label="Search by category"
                aria-expanded={categoryOpen}
                aria-controls="search-category-dropdown"
                onClick={() => setCategoryOpen((open) => !open)}
              ><ChevronDown aria-hidden="true" /></button>
              <button
                type="submit"
                className="ux-demo-search-submit"
                onClick={(event) => {
                  if (!searchTerm.trim() && !query && searchCategory === 'All') {
                    event.preventDefault();
                    setCategoryOpen(true);
                  }
                }}
              >Search</button>
              {categoryOpen && (
                <div id="search-category-dropdown" className="ux-demo-search-categories" role="group" aria-labelledby="search-category-title">
                  <p id="search-category-title">Search by category</p>
                  <div className="ux-demo-search-category-options">
                    {searchCategories.map((category, index) => (
                      <button
                        key={category}
                        ref={(element) => { categoryOptions.current[index] = element; }}
                        type="button"
                        aria-pressed={searchCategory === category}
                        onClick={() => selectSearchCategory(category)}
                        onKeyDown={(event) => {
                          const delta = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0;
                          if (delta) {
                            event.preventDefault();
                            categoryOptions.current[(index + delta + searchCategories.length) % searchCategories.length]?.focus();
                          }
                        }}
                      >
                        {category === 'All' ? 'All categories' : category}
                        {searchCategory === category && <Check aria-hidden="true" />}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </form>
          }
          onShop={browseProducts}
          onAbout={() => document.getElementById('why-shopsphere')?.scrollIntoView({ behavior: 'smooth' })}
          onContact={() => document.getElementById('contact-us')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          onAccount={live?.onAccount ?? (() => navigate('/auth'))}
          onBag={live?.onBag ?? (() => setBagOpen(true))}
        />
      </div>

      <main id="demo-main" tabIndex={-1} className="ux-demo-main">
        <section className="ux-demo-hero-section">
          <div className="ux-demo-hero-shell container-store">
            <div data-scroll-section className="ux-demo-hero-stage relative overflow-hidden rounded-[var(--radius-surface)] border border-black/10 bg-[#111719]">
              <img
                src="/images/shopsphere-redesign-hero.webp"
                alt="MacBook, iPhone, Apple Watch, and AirPods arranged on a dark studio surface"
                width="1672"
                height="941"
                fetchPriority="high"
                className="absolute inset-0 h-full w-full object-cover object-[58%_center] sm:object-center"
              />
              <div
                className="absolute inset-0"
                style={{
                  background:
                    'linear-gradient(90deg, rgba(9, 18, 19, 0.98) 0%, rgba(9, 18, 19, 0.88) 28%, rgba(9, 18, 19, 0.42) 52%, rgba(9, 18, 19, 0.05) 76%)',
                }}
              />
              <div className="ux-demo-hero-copy relative z-10 flex max-w-[42rem] flex-col justify-center px-6 py-10 sm:px-12 lg:px-20">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#79c7b3] sm:text-sm">
                  A better way to buy Apple
                </p>
                <h1 className="mt-5 max-w-[12ch] text-[clamp(3rem,6vw,5.5rem)] font-semibold leading-[0.95] tracking-[-0.055em] text-[#edf2f1]">
                  Choose Better Technology.
                </h1>
                <p className="mt-6 max-w-lg text-base leading-relaxed text-[#bec8c7] sm:text-lg">
                  Verified Apple products, local support, and clear delivery for every purchase in Nepal.
                </p>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={live?.onAccount ?? (() => navigate('/auth'))}
                    className="inline-flex min-h-12 items-center justify-center gap-3 whitespace-nowrap rounded-xl bg-[#0d725d] px-6 font-semibold text-[#f7fbfa] transition-colors hover:bg-[#075745] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#79c7b3] focus-visible:ring-offset-2 focus-visible:ring-offset-[#111719]"
                  >
                    {live?.accountActions ? 'My account' : 'Sign in to ShopSphere'} <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => document.getElementById('why-shopsphere')?.scrollIntoView({ behavior: 'smooth' })}
                    className="inline-flex min-h-12 items-center justify-center whitespace-nowrap rounded-xl border border-[#edf2f1]/80 bg-[#f6f8f7]/90 px-6 font-semibold text-[#151a1b] transition-colors hover:bg-[#edf2f1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#79c7b3] focus-visible:ring-offset-2 focus-visible:ring-offset-[#111719]"
                  >
                    How buying works
                  </button>
                </div>
              </div>
            </div>

          </div>
        </section>


        {live && categoryTiles.length > 1 && (
          <section data-scroll-section aria-labelledby="categories-title" className="ux-demo-categories container-store scroll-mt-28">
            <p className="text-sm font-semibold text-brass">Browse the catalogue</p>
            <h2 id="categories-title" className="mt-1 text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">Shop By Category</h2>
            <ul className="ux-demo-category-grid">
              {categoryTiles.map((tile) => (
                <li key={tile.category}>
                  <Link to={`/?category=${encodeURIComponent(tile.category)}`} className="ux-demo-category-tile">
                    <span className="ux-demo-product-media ux-demo-category-media" data-background={tile.background}>
                      <img src={tile.image} alt="" loading="lazy" />
                    </span>
                    <span className="ux-demo-category-name">{tile.category}</span>
                    <span className="ux-demo-category-count">{tile.count} {tile.count === 1 ? 'product' : 'products'}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {products.length > 0 && (
        <section data-scroll-section aria-labelledby="popular-products-title" className="ux-demo-products-panel ux-demo-products-panel--popular container-store scroll-mt-28">
          <div className="flex flex-col gap-5 border-b border-hairline pb-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-brass">Selected by ShopSphere</p>
              <h2 id="popular-products-title" className="mt-1 text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">Popular Right Now</h2>
            </div>
          </div>

          <div className="ux-demo-product-slider">
            <div
              ref={setProductScroller}
              onScroll={updateScrollEdges}
              style={cardStep ? { '--ux-demo-card-w': `${cardStep - cardGap}px` } as CSSProperties : undefined}
              className="ux-demo-product-grid ux-demo-product-grid--scroll"
            >
              {popularProductCards}
            </div>
            {!scrollState.atStart && (
              <button type="button" className="ux-demo-product-slider-nav ux-demo-product-slider-prev" aria-label="Show previous products" onClick={() => slideProducts(-1)}>
                <ChevronLeft aria-hidden="true" />
              </button>
            )}
            {!scrollState.atEnd && (
              <button type="button" className="ux-demo-product-slider-nav ux-demo-product-slider-next" aria-label="Show more products" onClick={() => slideProducts(1)}>
                <ChevronRight aria-hidden="true" />
              </button>
            )}
          </div>
        </section>
        )}

        <section ref={catalogue} data-scroll-section data-section-scroll-ignore aria-labelledby="products-title" className="ux-demo-products-panel ux-demo-products-panel--catalogue container-store scroll-mt-28">
          <div className="storefront-catalog-heading">
            <div>
              <p className="text-sm font-semibold text-brass">Browse the catalogue</p>
              <h2 id="products-title" aria-live="polite" className="mt-1 text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">{query ? `Search results for “${query}”` : searchCategory !== 'All' ? searchCategory : 'Shop All Products'}</h2>
              {searchCategory !== 'All' && <p className="mt-1 text-sm text-ink-muted">Searching in {searchCategory}</p>}
            </div>
            <div className="storefront-catalog-heading-actions">
              {live && !live.catalogStatus && <p className="storefront-result-count" role="status">{visibleProducts.length} {visibleProducts.length === 1 ? 'product' : 'products'}</p>}
              {(query || searchCategory !== 'All') && <Button variant="quiet" onClick={browseProducts}>Clear filters</Button>}
              {live && !live.catalogStatus && visibleProducts.length > 0 && (
                <Button variant="secondary" onClick={() => setShowFullCatalogue((current) => !current)}>
                  {showFullCatalogue ? 'Show slider' : 'Show all products'}
                </Button>
              )}
            </div>
          </div>

          {live?.catalogStatus ?? (visibleProducts.length ? (
            showFullCatalogue ? (
              <div className="storefront-catalog-layout">
                {live && <CatalogFilters products={products.filter(product => searchCategory === 'All' || product.category === searchCategory)} value={filters} onChange={setFilters} />}
                <div className="storefront-catalog-results">
                  <div className="ux-demo-product-grid storefront-catalog-full-grid">{catalogueProductCards}</div>
                </div>
              </div>
            ) : (
              <div className={live ? 'storefront-catalog-layout storefront-catalog-layout--paged' : 'storefront-catalog-results storefront-catalog-results--standalone'}>
                {live && <CatalogFilters products={products.filter(product => searchCategory === 'All' || product.category === searchCategory)} value={filters} onChange={setFilters} />}
                <div className="storefront-catalog-results">
                  <div className="ux-demo-product-slider storefront-catalog-page-slider-shell">
                    <div ref={catalogueScroller} onScroll={updateCatalogueScrollEdges} className="storefront-catalog-page-slider">
                      {cataloguePages.map((page, pageIndex) => (
                        <div
                          key={pageIndex}
                          className="storefront-catalog-page"
                          aria-label={`Product group ${pageIndex + 1} of ${cataloguePages.length}`}
                        >
                          {page}
                        </div>
                      ))}
                    </div>
                    {!catalogueScrollState.atStart && (
                      <button type="button" className="ux-demo-product-slider-nav ux-demo-product-slider-prev" aria-label="Show previous catalogue products" onClick={() => slideCatalogueProducts(-1)}>
                        <ChevronLeft aria-hidden="true" />
                      </button>
                    )}
                    {!catalogueScrollState.atEnd && (
                      <button type="button" className="ux-demo-product-slider-nav ux-demo-product-slider-next" aria-label="Show more catalogue products" onClick={() => slideCatalogueProducts(1)}>
                        <ChevronRight aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          ) : (
            <div className="my-12 rounded-[var(--radius-surface)] border border-hairline bg-paper-raised px-6 py-12 text-center">
              <Search className="mx-auto h-6 w-6 text-ink-muted" aria-hidden="true" />
              <h3 className="mt-4 font-semibold">{live ? products.length ? 'No matching products' : 'No products available' : 'No demo products match'}</h3>
              <p className="mt-1 text-sm text-ink-muted">Try another search or clear the filters.</p>
              <Button className="mt-5" variant="secondary" onClick={browseProducts}>Show all products</Button>
            </div>
          ))}
        </section>

        <section id="why-shopsphere" data-scroll-section aria-labelledby="why-title" className="scroll-mt-28 border-y border-hairline">
          <div className="container-store py-10 md:py-14">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold text-brass">A calmer way to buy</p>
              <h2 id="why-title" className="mt-1 text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">The answers appear before you have to ask.</h2>
            </div>
            <div className="mt-8 grid gap-7 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { icon: ShieldCheck, title: 'Approved sellers', copy: 'Every seller is reviewed before their products appear.' },
                { icon: PackageCheck, title: 'Clear stock', copy: 'Availability and product details stay close to the buying action.' },
                { icon: CreditCard, title: 'Familiar payment', copy: 'Pay securely with eSewa and see a clear outcome immediately.' },
                { icon: Headphones, title: 'Local help', copy: 'Support from Pokhara when an order needs human attention.' },
              ].map(({ icon: Icon, title, copy }) => (
                <div key={title} className="border-t border-hairline pt-5">
                  <Icon className="h-5 w-5 text-brass" aria-hidden="true" />
                  <h3 className="mt-4 text-sm font-semibold">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-muted">{copy}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <div id="contact-us" data-scroll-section className="scroll-mt-28">
        <Footer />
      </div>

      {!live && bagOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 pt-10 sm:pt-8" role="presentation" onClick={() => setBagOpen(false)} onKeyDown={(event) => { if (event.key === 'Escape') setBagOpen(false); }}>
          <aside role="dialog" aria-modal="true" aria-labelledby="demo-bag-title" className="ml-auto flex h-full w-full max-w-lg flex-col overflow-y-auto border-l border-hairline bg-paper-raised shadow-float" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-hairline px-5 py-4">
              <h2 id="demo-bag-title" className="font-semibold">Your bag</h2>
              <IconButton autoFocus label="Close bag" onClick={() => setBagOpen(false)}><X className="h-5 w-5" /></IconButton>
            </div>
            {cartItems.length ? (
              <div className="flex flex-1 flex-col p-6">
                <ul className="space-y-5">
                  {products.filter((product) => cartItems.includes(product.id)).map((product) => {
                    const quantity = cartItems.filter((id) => id === product.id).length;
                    return (
                      <li key={product.id} className="flex gap-4">
                        <img src={product.image} alt="" data-background={product.imageBackground} className="ux-demo-product-media h-20 w-20 shrink-0 rounded-[var(--radius-control)] object-contain" />
                        <div className="min-w-0 flex-1">
                          <h3 className="text-sm font-semibold">{product.name}</h3>
                          <p className="mt-1 text-sm text-ink-muted">Quantity: {quantity}</p>
                          <p className="mt-1 font-mono text-sm">{formatNpr(product.price * quantity)}</p>
                          <button type="button" className="mt-1 min-h-11 text-sm text-brass underline underline-offset-4" onClick={() => setCartItems((current) => current.filter((id) => id !== product.id))} aria-label={`Remove ${product.name} from bag`}>Remove</button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-auto border-t border-hairline pt-5">
                  <p className="flex justify-between gap-4 font-semibold"><span>Subtotal</span><span className="font-mono">{formatNpr(cartItems.reduce((total, id) => total + (products.find((product) => product.id === id)?.price ?? 0), 0))}</span></p>
                  <p className="mt-3 text-sm text-ink-muted">Demo bag only. No payment or order will be placed.</p>
                </div>
              </div>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
                <ShoppingBag className="h-8 w-8 text-brass" aria-hidden="true" />
                <p className="font-semibold">Your bag is empty</p>
                <Button onClick={() => { setBagOpen(false); browseProducts(); }}>Browse products</Button>
              </div>
            )}
          </aside>
        </div>
      )}

      <CompareBar
        onBuy={(item) => {
          const product = products.find((entry) => entry.id === item.id);
          if (product) addToCart(product);
        }}
        buyLabel={(item) => {
          const product = products.find((entry) => entry.id === item.id);
          return product ? actionLabel(product) : 'View product';
        }}
        buyDisabled={(item) => {
          const product = products.find((entry) => entry.id === item.id);
          return product ? disablePurchase(product) : false;
        }}
      />

      {quickView && (
        <div className="fixed inset-0 z-50 bg-ink/35 pt-10 sm:pt-8" role="presentation" onClick={closeQuickView} onKeyDown={(event) => { if (event.key === 'Escape') closeQuickView(); }}>
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="quick-view-title"
            className="ml-auto flex h-full w-full max-w-lg flex-col overflow-y-auto border-l border-hairline bg-paper-raised shadow-float"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key !== 'Tab') return;
              const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
              const first = buttons[0];
              const last = buttons[buttons.length - 1];
              if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
              else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
            }}
          >
            <div className="flex items-center justify-between border-b border-hairline px-5 py-4">
              <p className="text-sm font-semibold">Quick view</p>
              <IconButton autoFocus label="Close quick view" onClick={closeQuickView}><X className="h-5 w-5" /></IconButton>
            </div>
            <div className="ux-demo-product-media aspect-[4/3] shrink-0" data-background={quickView.imageBackground}><img src={quickView.image} alt={quickView.name} className="h-full w-full object-contain" onError={(event) => {
              if (live && !event.currentTarget.src.endsWith('/images/product-placeholder.svg')) event.currentTarget.src = '/images/product-placeholder.svg';
            }} /></div>
            <div className="flex flex-1 flex-col p-6">
              <p className="text-xs font-medium text-brass">{quickView.category}</p>
              <p className="mt-2 text-xs font-semibold text-brass-dark">{quickView.inStock === false ? 'Sold out' : 'In stock'}</p>
              <h2 id="quick-view-title" className="mt-2 text-2xl font-semibold tracking-[-0.03em]">{quickView.name}</h2>
              <div className="mt-3 flex items-center gap-1.5 text-sm text-ink-muted"><Star className="h-4 w-4 fill-brass text-brass" aria-hidden="true" />{quickView.reviews ? <>{quickView.rating} <span>· {quickView.reviews} reviews</span></> : 'No reviews yet'}</div>
              <p className="mt-5 font-mono text-xl font-semibold tabular-nums">{quickView.priceFrom ? `From ${formatNpr(quickView.price)}` : formatNpr(quickView.price)}</p>
              <p className="mt-3 text-sm leading-relaxed text-ink-muted">{live ? quickView.description || quickView.note : `${quickView.note}. This concept keeps stock, seller confidence, delivery, and the next buying action together.`}</p>
              <ul className="mt-6 space-y-3 text-sm">
                {['Verified seller listing', 'Delivery estimate shown at checkout', 'Secure eSewa payment'].map((item) => <li key={item} className="flex items-center gap-2"><Check className="h-4 w-4 text-brass" aria-hidden="true" />{item}</li>)}
              </ul>
              {live ? (
                <div className="mt-auto pt-5">
                  <Button variant="secondary" className="w-full" onClick={() => live.onDetails(quickView)}>View full product details</Button>
                </div>
              ) : (
                <Button size="lg" className="mt-auto w-full" disabled={disablePurchase(quickView)} onClick={() => addToCart(quickView)}>{actionLabel(quickView)} · {formatNpr(quickView.price)}</Button>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
