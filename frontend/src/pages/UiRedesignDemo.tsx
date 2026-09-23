import { useMemo, useState } from 'react';
import {
  ArrowRight,
  Check,
  ChevronRight,
  CreditCard,
  Headphones,
  Search,
  ShieldCheck,
  Star,
  Truck,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import OrbitMark from '../components/OrbitMark';
import DemoHeader from '../components/DemoHeader';
import './ui-redesign-demo.css';

type RedesignProduct = {
  id: string;
  name: string;
  category: string;
  detail: string;
  price: number;
  image: string;
  rating: number;
  reviews: number;
};

type PaletteName = 'apple' | 'emerald' | 'cobalt' | 'vermilion' | 'forest' | 'navy';

const redesignPalettes: Array<{ id: PaletteName; name: string; colors: [string, string, string] }> = [
  { id: 'apple', name: 'Apple Neutral', colors: ['#0071e3', '#f5f5f7', '#1d1d1f'] },
  { id: 'emerald', name: 'Emerald Chrome', colors: ['#0d725d', '#dce5e3', '#171d1e'] },
  { id: 'cobalt', name: 'Cobalt Glass', colors: ['#3157c8', '#e4e8f2', '#151925'] },
  { id: 'vermilion', name: 'Vermilion Mono', colors: ['#bd4935', '#e9e6e4', '#1d1716'] },
  { id: 'forest', name: 'Amber Forest', colors: ['#ad721d', '#dfe5dc', '#111b17'] },
  { id: 'navy', name: 'Navy Pastel', colors: ['#073b57', '#b9d9e8', '#f3d7cd'] },
];

const redesignCategories = [
  { name: 'iPhone', image: '/images/iphone17a.jpg', copy: 'The latest models and finishes.' },
  { name: 'MacBook', image: '/images/macairmidnight.jpg', copy: 'Portable power for work and study.' },
  { name: 'Apple Watch', image: '/images/applewatch.avif', copy: 'Fitness, health, and daily essentials.' },
  { name: 'Accessories', image: '/images/chargingdock.jpg', copy: 'The pieces that complete your setup.' },
];

const redesignProducts: RedesignProduct[] = [
  {
    id: 'iphone-17-pro-max-redesign',
    name: 'iPhone 17 Pro Max',
    category: 'iPhone',
    detail: 'Titanium finish, pro camera system',
    price: 234999,
    image: '/images/17pmorange.webp',
    rating: 4.9,
    reviews: 86,
  },
  {
    id: 'macbook-air-m4-redesign',
    name: 'MacBook Air M4',
    category: 'MacBook',
    detail: '13-inch display, 16GB memory',
    price: 164500,
    image: '/images/macbookairm4.avif',
    rating: 4.8,
    reviews: 42,
  },
  {
    id: 'watch-series-10-redesign',
    name: 'Apple Watch Series 10',
    category: 'Apple Watch',
    detail: '46mm aluminium, GPS',
    price: 56900,
    image: '/images/applewatch.avif',
    rating: 4.7,
    reviews: 31,
  },
  {
    id: 'mac-mini-m4-redesign',
    name: 'Mac mini M4',
    category: 'MacBook',
    detail: '16GB memory, 256GB storage',
    price: 104500,
    image: '/images/macmini.jpg',
    rating: 4.9,
    reviews: 27,
  },
  {
    id: 'charging-dock-redesign',
    name: '3-in-1 MagSafe charger',
    category: 'Accessories',
    detail: 'Phone, watch, and earbuds',
    price: 12500,
    image: '/images/chargingdock.jpg',
    rating: 4.6,
    reviews: 19,
  },
];

const formatPrice = (amount: number) => `NPR ${new Intl.NumberFormat('en-NP').format(amount)}`;

export default function UiRedesignDemo() {
  const [darkMode, setDarkMode] = useState(false);
  const [palette, setPalette] = useState<PaletteName>('apple');
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [bag, setBag] = useState<string[]>([]);
  const [quickView, setQuickView] = useState<RedesignProduct | null>(null);

  const filteredProducts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return redesignProducts.filter((product) => {
      const matchesCategory = selectedCategory === 'All' || product.category === selectedCategory;
      const matchesQuery = !normalized || `${product.name} ${product.category} ${product.detail}`.toLowerCase().includes(normalized);
      return matchesCategory && matchesQuery;
    });
  }, [query, selectedCategory]);

  const browseCategory = (category: string) => {
    setSelectedCategory(category);
    setQuery('');
    requestAnimationFrame(() => document.getElementById('redesign-products')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const addToBag = (product: RedesignProduct) => {
    setBag((current) => [...current, product.id]);
    setQuickView(null);
  };

  return (
    <div className={`ui-redesign palette-${palette} ${darkMode ? 'theme-dark' : 'theme-light'}`}>
      <a href="#redesign-main" className="ui-redesign-skip">Skip to content</a>

      <DemoHeader
        homePath="/ui-redesign-demo"
        homeLabel="ShopSphere redesign home"
        navigationLabel="Redesign navigation"
        bagCount={bag.length}
        darkMode={darkMode}
        onToggleTheme={() => setDarkMode((current) => !current)}
        onSearch={() => setSearchOpen(true)}
        onShop={() => browseCategory('All')}
        onAbout={() => document.getElementById('redesign-confidence')?.scrollIntoView({ behavior: 'smooth' })}
        onContact={() => document.getElementById('redesign-contact')?.scrollIntoView({ behavior: 'smooth' })}
      />

      <aside className="ui-palette-studio" aria-label="Color palette experiments">
        <div className="ui-redesign-shell ui-palette-studio-inner">
          <div className="ui-palette-intro">
            <strong>Palette studio</strong>
            <span>Choose a visual direction</span>
          </div>
          <div className="ui-palette-options" role="group" aria-label="ShopSphere color palette">
            {redesignPalettes.map((option) => (
              <button
                key={option.id}
                type="button"
                className={palette === option.id ? 'is-active' : ''}
                onClick={() => setPalette(option.id)}
                aria-pressed={palette === option.id}
              >
                <span className="ui-palette-swatches" aria-hidden="true">
                  {option.colors.map((color) => <i key={color} style={{ backgroundColor: color }} />)}
                </span>
                <span>{option.name}</span>
                {palette === option.id && <Check aria-hidden="true" />}
              </button>
            ))}
          </div>
        </div>
      </aside>

      {searchOpen && (
        <div className="ui-search-overlay" role="presentation" onClick={() => setSearchOpen(false)}>
          <section className="ui-search-panel" role="dialog" aria-modal="true" aria-labelledby="redesign-search-title" onClick={(event) => event.stopPropagation()}>
            <div className="ui-search-heading">
              <div>
                <h2 id="redesign-search-title">Find your next device</h2>
                <p>Search by model, category, or feature.</p>
              </div>
              <button type="button" className="ui-icon-button" onClick={() => setSearchOpen(false)} aria-label="Close search"><X aria-hidden="true" /></button>
            </div>
            <label className="ui-search-field">
              <span>Search products</span>
              <div>
                <Search aria-hidden="true" />
                <input
                  autoFocus
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      setSearchOpen(false);
                      document.getElementById('redesign-products')?.scrollIntoView({ behavior: 'smooth' });
                    }
                  }}
                  placeholder="Try MacBook or charger"
                />
              </div>
            </label>
            <div className="ui-search-suggestions">
              {['iPhone', 'MacBook', 'Apple Watch', 'Accessories'].map((category) => (
                <button key={category} type="button" onClick={() => { setSearchOpen(false); browseCategory(category); }}>{category}</button>
              ))}
            </div>
          </section>
        </div>
      )}

      <main id="redesign-main">
        <section className="ui-redesign-hero">
          <div className="ui-redesign-shell ui-hero-stage">
            <img src="/images/shopsphere-redesign-hero.webp" alt="Premium smartphone, laptop, smartwatch, and wireless earbuds arranged in a silver studio" width="1672" height="941" fetchPriority="high" />
            <div className="ui-hero-shade" aria-hidden="true" />
            <div className="ui-hero-copy">
              <p className="ui-eyebrow">A better way to buy Apple</p>
              <h1>Choose Better Technology.</h1>
              <p>Verified Apple products, local support, and clear delivery for every purchase in Nepal.</p>
              <div className="ui-hero-buttons">
                <button type="button" className="ui-primary-button" onClick={() => browseCategory('All')}>Shop the collection <ArrowRight aria-hidden="true" /></button>
                <button type="button" className="ui-secondary-button" onClick={() => setSearchOpen(true)}>Search products</button>
              </div>
            </div>
          </div>
        </section>

        <section className="ui-confidence-strip" aria-label="Purchase confidence">
          <div className="ui-redesign-shell">
            <span><ShieldCheck aria-hidden="true" /> Approved sellers</span>
            <span><CreditCard aria-hidden="true" /> Secure eSewa</span>
            <span><Truck aria-hidden="true" /> Delivery across Nepal</span>
            <span><Headphones aria-hidden="true" /> Local support</span>
          </div>
        </section>

        <section className="ui-redesign-section ui-category-section" aria-labelledby="redesign-categories-title">
          <div className="ui-redesign-shell">
            <div className="ui-section-heading">
              <h2 id="redesign-categories-title">Choose your starting point.</h2>
              <p>Browse by the device that fits your day.</p>
            </div>
            <div className="ui-category-grid">
              {redesignCategories.map((category) => (
                <button key={category.name} type="button" className="ui-category-item" onClick={() => browseCategory(category.name)}>
                  <span className="ui-category-image"><img src={category.image} alt="" loading="lazy" /></span>
                  <span className="ui-category-copy">
                    <strong>{category.name}</strong>
                    <small>{category.copy}</small>
                    <ChevronRight aria-hidden="true" />
                  </span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section id="redesign-products" className="ui-redesign-section ui-product-section" aria-labelledby="redesign-products-title">
          <div className="ui-redesign-shell">
            <div className="ui-section-heading">
              <h2 id="redesign-products-title">{selectedCategory === 'All' ? 'The ShopSphere edit.' : selectedCategory}</h2>
              <p>Considered devices from sellers we approve.</p>
            </div>

            {(selectedCategory !== 'All' || query) && (
              <button type="button" className="ui-clear-filter" onClick={() => { setSelectedCategory('All'); setQuery(''); }}>Clear filters <X aria-hidden="true" /></button>
            )}

            {filteredProducts.length ? (
              <div className="ui-product-layout">
                {filteredProducts.map((product, index) => (
                  <article key={product.id} className={index === 0 ? 'ui-product-feature' : 'ui-product-row'}>
                    <button type="button" className="ui-product-visual" onClick={() => setQuickView(product)}>
                      <img src={product.image} alt={product.name} loading={index === 0 ? 'eager' : 'lazy'} />
                    </button>
                    <div className="ui-product-info">
                      <div>
                        <p>{product.category}</p>
                        <button type="button" onClick={() => setQuickView(product)}><h3>{product.name}</h3></button>
                        <span>{product.detail}</span>
                      </div>
                      <div className="ui-product-purchase">
                        <div className="ui-product-rating" aria-label={`${product.rating} out of 5 from ${product.reviews} reviews`}><Star aria-hidden="true" /> {product.rating} <span>({product.reviews})</span></div>
                        <strong>{formatPrice(product.price)}</strong>
                        <button type="button" className="ui-add-button" onClick={() => addToBag(product)}>Add to bag</button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="ui-empty-state">
                <Search aria-hidden="true" />
                <h3>No matching products</h3>
                <p>Try a broader search or return to the complete collection.</p>
                <button type="button" className="ui-secondary-button" onClick={() => { setSelectedCategory('All'); setQuery(''); }}>View collection</button>
              </div>
            )}
          </div>
        </section>

        <section id="redesign-confidence" className="ui-redesign-section ui-confidence-section" aria-labelledby="redesign-confidence-title">
          <div className="ui-redesign-shell ui-confidence-layout">
            <div className="ui-confidence-intro">
              <h2 id="redesign-confidence-title">Confidence belongs in the experience.</h2>
              <p>Every important answer stays close to the buying decision.</p>
            </div>
            <div className="ui-confidence-grid">
              {[
                ['Approved before listing', 'Seller access is reviewed before a product appears.', ShieldCheck],
                ['Clear at checkout', 'See payment and delivery details before you commit.', CreditCard],
                ['Visible after purchase', 'Follow your order from confirmation to delivery.', Truck],
                ['Human when needed', 'Reach ShopSphere support from Pokhara.', Headphones],
              ].map(([title, copy, Icon]) => (
                <div className="ui-confidence-item" key={String(title)}>
                  <Icon aria-hidden="true" />
                  <h3>{String(title)}</h3>
                  <p>{String(copy)}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer id="redesign-contact" className="ui-redesign-footer">
        <div className="ui-redesign-shell ui-footer-layout">
          <div>
            <div className="ui-redesign-brand"><OrbitMark size={25} /><span>ShopSphere</span></div>
            <p>Premium Apple products from approved sellers, delivered across Nepal.</p>
          </div>
          <div className="ui-footer-contact">
            <h2>Contact</h2>
            <a href="mailto:support@shopsphere.com">support@shopsphere.com</a>
            <a href="tel:+9779800000000">+977 9800000000</a>
            <span>Masbar-7, Pokhara</span>
          </div>
          <div className="ui-footer-links">
            <button type="button" onClick={() => browseCategory('All')}>Shop</button>
            <button type="button" onClick={() => document.getElementById('redesign-confidence')?.scrollIntoView({ behavior: 'smooth' })}>About us</button>
            <Link to="/auth">Sign in</Link>
          </div>
        </div>
        <div className="ui-redesign-shell ui-footer-bottom"><span>© {new Date().getFullYear()} ShopSphere</span><span>Demo storefront</span></div>
      </footer>

      {quickView && (
        <div className="ui-quick-overlay" role="presentation" onClick={() => setQuickView(null)}>
          <aside className="ui-quick-panel" role="dialog" aria-modal="true" aria-labelledby="ui-quick-title" onClick={(event) => event.stopPropagation()}>
            <div className="ui-quick-topbar">
              <span>Product details</span>
              <button type="button" className="ui-icon-button" onClick={() => setQuickView(null)} aria-label="Close product details"><X aria-hidden="true" /></button>
            </div>
            <div className="ui-quick-image"><img src={quickView.image} alt={quickView.name} /></div>
            <div className="ui-quick-content">
              <p>{quickView.category}</p>
              <h2 id="ui-quick-title">{quickView.name}</h2>
              <span>{quickView.detail}</span>
              <div className="ui-quick-rating"><Star aria-hidden="true" /> {quickView.rating} <small>({quickView.reviews} reviews)</small></div>
              <strong>{formatPrice(quickView.price)}</strong>
              <ul>
                <li><Check aria-hidden="true" /> Approved seller listing</li>
                <li><Check aria-hidden="true" /> Secure eSewa checkout</li>
                <li><Check aria-hidden="true" /> Delivery estimate before payment</li>
              </ul>
              <button type="button" className="ui-primary-button" onClick={() => addToBag(quickView)}>Add to bag <ArrowRight aria-hidden="true" /></button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
