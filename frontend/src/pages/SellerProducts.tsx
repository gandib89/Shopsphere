import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, RefreshCw, Search } from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '../lib/session';
import { getImageUrl } from '../lib/utils';
import { AdminEmptyState, AdminHeading, AdminPagination } from '../components/admin/AdminUi';
import { Dialog } from '../components/ui/Dialog';
import { Button } from '../components/ui/Button';
import { adminDate, adminMoney } from '../lib/adminData';
import { categoryName, getSellerCollection, matchesProductFilter, productFilters, stockLabel, stockState, type SellerProduct } from '../lib/sellerData';
import { productPath } from '../lib/routes';

const stockTone = { instock: 'success', lowstock: 'attention', outofstock: 'muted' } as const;

export default function SellerProducts() {
  const [params, setParams] = useSearchParams();
  const stock = productFilters.some(filter => filter.key === params.get('stock')) ? params.get('stock')! : 'all';
  const search = params.get('q') || '';
  const category = params.get('category') || 'all';
  const [products, setProducts] = useState<SellerProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sort, setSort] = useState('newest');
  const [size, setSize] = useState(20);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
  const [showCategory, setShowCategory] = useState(true);
  const [showAdded, setShowAdded] = useState(true);
  const pending = useRef(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError('');
    try { const rows = await getSellerCollection<SellerProduct>('/api/v1/product/seller/my-products', 'products', signal); if (!signal?.aborted) setProducts(rows); }
    catch (err) { if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Could not load your products.'); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, []);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  useEffect(() => { setPage(1); setSelected([]); }, [stock, search, category, sort, size]);

  const query = (key: string, value: string) => { const next = new URLSearchParams(params); if (!value || value === 'all') next.delete(key); else next.set(key, value); setParams(next, { replace: true }); };
  const categories = Array.from(new Set(products.map(product => product.category).filter(Boolean))).sort();
  const filtered = products
    .filter(product => matchesProductFilter(product, stock)
      && (category === 'all' || product.category === category)
      && product.name.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name)
      : sort === 'price' ? Number(b.price) - Number(a.price)
      : sort === 'stock' ? a.quantity - b.quantity
      : new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  const pages = Math.max(1, Math.ceil(filtered.length / size));
  const currentPage = Math.min(page, pages);
  const rows = filtered.slice((currentPage - 1) * size, currentPage * size);
  const pageSelected = rows.length > 0 && rows.every(product => selected.includes(product._id));

  const remove = async (ids: string[]) => {
    if (pending.current || !ids.length) return;
    pending.current = true; setBusy(true);
    try {
      const results = await Promise.allSettled(ids.map(async id => {
        const response = await authFetch(`${import.meta.env.VITE_BACKEND_URL}/api/v1/product/seller/delete/${id}`, { method: 'DELETE' });
        if (!response.ok) throw new Error(id);
        return id;
      }));
      const deleted = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
      if (deleted.length) {
        setProducts(previous => previous.filter(product => !deleted.includes(product._id)));
        setSelected(previous => previous.filter(id => !deleted.includes(id)));
        toast.success(deleted.length === 1 ? 'Product deleted' : `${deleted.length} products deleted`);
      }
      if (deleted.length < ids.length) toast.error(`${ids.length - deleted.length} product(s) could not be deleted.`);
    } finally { pending.current = false; setBusy(false); }
  };

  return <main>
    <AdminHeading title="Products" description="Manage your listings, stock, and pricing.">
      <button className="admin-button" disabled={loading || busy} onClick={() => void load()}><RefreshCw size={14} aria-hidden="true" />Refresh</button>
      <Link className="admin-button admin-button--primary" to="/add-product"><Plus size={14} aria-hidden="true" />Add product</Link>
    </AdminHeading>
    <details className="admin-screen-options"><summary>Screen options</summary><div>
      <label><input type="checkbox" checked={showCategory} onChange={event => setShowCategory(event.target.checked)} />Category</label>
      <label><input type="checkbox" checked={showAdded} onChange={event => setShowAdded(event.target.checked)} />Date added</label>
      <label>Rows per page <select aria-label="Products per page" value={size} onChange={event => setSize(Number(event.target.value))}><option>20</option><option>50</option><option>100</option></select></label>
    </div></details>
    <div className="admin-tabs" aria-label="Stock filters">{productFilters.map(filter => <button key={filter.key} aria-pressed={stock === filter.key} onClick={() => query('stock', filter.key)}>{filter.label}<span>({loading || error ? '—' : products.filter(product => matchesProductFilter(product, filter.key)).length})</span></button>)}</div>
    {error && <p className="admin-notice" role="alert">{error}</p>}
    <section className="admin-panel" aria-label="Product list">
      <div className="admin-toolbar">
        <label className="admin-search"><Search size={15} aria-hidden="true" /><input type="search" aria-label="Search products" placeholder="Search products…" value={search} onChange={event => query('q', event.target.value)} /></label>
        <div className="admin-filters">
          {categories.length > 1 && <label>Category<select aria-label="Filter by category" value={category} onChange={event => query('category', event.target.value)}><option value="all">All categories</option>{categories.map(item => <option key={item} value={item}>{categoryName(item)}</option>)}</select></label>}
          <label>Sort by<select aria-label="Sort products" value={sort} onChange={event => setSort(event.target.value)}><option value="newest">Date added (newest first)</option><option value="name">Product name</option><option value="price">Highest price</option><option value="stock">Lowest stock</option></select></label>
          {rows.length > 0 && (search || stock !== 'all' || category !== 'all') && <button className="admin-button" onClick={() => setParams({})}>Clear filters</button>}
        </div>
      </div>
      {!loading && !error && rows.length > 0 && <div className="admin-toolbar">
        <div className="admin-bulk">
          <button className="admin-button admin-button--danger" disabled={!selected.length || busy} onClick={() => setDeleteIds(selected)}>Delete selected</button>
          <span aria-live="polite">{selected.length ? `${selected.length} selected` : `${filtered.length} product${filtered.length === 1 ? '' : 's'}`}</span>
        </div>
      </div>}
      {loading ? <p className="admin-empty" role="status">Loading products…</p>
        : error ? <p className="admin-empty">Refresh to load your product list.</p>
: !rows.length ? <AdminEmptyState icon={<Plus />} title={products.length ? 'No matching products' : 'Your catalogue is empty'} description={products.length ? 'Try another search, category, or stock filter.' : 'Add your first product so customers can discover your shop.'} action={products.length ? <button className="admin-button" onClick={() => setParams({})}>Clear filters</button> : <Link className="admin-button admin-button--primary" to="/add-product">Add first product</Link>} />
        : <><div className="admin-table-wrap admin-desktop-table"><table className="admin-table">
          <thead><tr>
            <th scope="col" className="admin-check"><input type="checkbox" aria-label="Select all products on this page" checked={pageSelected} onChange={event => setSelected(event.target.checked ? Array.from(new Set([...selected, ...rows.map(product => product._id)])) : selected.filter(id => !rows.some(product => product._id === id)))} /></th>
            <th scope="col">Product</th>
            {showCategory && <th scope="col">Category</th>}
            <th scope="col">Stock</th>
            <th scope="col">Price</th>
            {showAdded && <th scope="col">Added</th>}
          </tr></thead>
          <tbody>{rows.map(product => <tr key={product._id}>
            <td className="admin-check"><input type="checkbox" aria-label={`Select ${product.name}`} checked={selected.includes(product._id)} onChange={event => setSelected(event.target.checked ? [...selected, product._id] : selected.filter(id => id !== product._id))} /></td>
            <td>
              <div className="admin-product-cell">
                <img src={getImageUrl(product.images?.[0])} alt="" loading="lazy" />
                <div>
                  <Link className="admin-text-link" to={`/seller-products/${product._id}`}>{product.name}</Link>
                  <div className="admin-row-actions">
                    <Link to={`/seller-products/${product._id}`}>Edit</Link><span aria-hidden="true">|</span>
                    <Link to={productPath(product._id)}>View</Link><span aria-hidden="true">|</span>
                    <button className="is-danger" disabled={busy} onClick={() => setDeleteIds([product._id])}>Delete</button>
                  </div>
                </div>
              </div>
            </td>
            {showCategory && <td>{categoryName(product.category)}</td>}
            <td><span className={`admin-status admin-status--${stockTone[stockState(product)]}`}>{stockLabel(product)}</span></td>
            <td className="admin-numeric">{adminMoney(product.price)}{Number(product.discount) > 0 && <small>{Number(product.discount)}% off</small>}</td>
            {showAdded && <td className="admin-numeric">{adminDate(product.createdAt)}</td>}
          </tr>)}</tbody>
        </table></div><div className="admin-mobile-cards">{rows.map(product => <article className="admin-mobile-card" key={product._id}><div className="admin-mobile-card-head"><img src={getImageUrl(product.images?.[0])} alt="" /><div><Link className="admin-text-link" to={`/seller-products/${product._id}`}>{product.name}</Link><p className="mt-1 text-xs text-ink-muted">{categoryName(product.category)}</p></div></div><dl><div><dt>Stock</dt><dd>{stockLabel(product)}</dd></div><div><dt>Price</dt><dd>{adminMoney(product.price)}</dd></div></dl><div className="admin-mobile-card-actions"><Link className="admin-button" to={`/seller-products/${product._id}`}>Edit</Link><Link className="admin-button" to={productPath(product._id)}>View</Link><button className="admin-button admin-button--danger" disabled={busy} onClick={() => setDeleteIds([product._id])}>Delete</button></div></article>)}</div></>}
      {!loading && !error && rows.length > 0 && <AdminPagination page={currentPage} pages={pages} onPage={setPage} />}
    </section>
    <Dialog open={deleteIds.length > 0} title={deleteIds.length === 1 ? 'Delete product?' : `Delete ${deleteIds.length} products?`} description="Customers will no longer be able to find or buy these listings." onClose={() => { if (!busy) setDeleteIds([]); }} footer={<><Button variant="quiet" disabled={busy} onClick={() => setDeleteIds([])}>Keep products</Button><Button variant="danger" loading={busy} onClick={async () => { const ids = deleteIds; await remove(ids); setDeleteIds([]); }}>Delete permanently</Button></>}>
      <p className="text-sm text-ink-muted">This action cannot be undone.</p>
    </Dialog>
  </main>;
}
