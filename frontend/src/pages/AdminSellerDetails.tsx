import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Search } from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '../lib/session';
import { AdminHeading, AdminPagination, OrderStatus } from '../components/admin/AdminUi';
import { adminDate, adminMoney, getAdminCollection, type AdminOrder } from '../lib/adminData';
import { sellerName, sellerStatus, useAdminSellerResource, type SellerDetail, type SellerProduct } from '../lib/adminSellers';
import { getImageUrl } from '../lib/utils';

const orderFilters = [
  { key: 'all', label: 'All', statuses: [] as string[] },
  { key: 'active', label: 'Active', statuses: ['Pending', 'Confirmed', 'Processing', 'Shipped'] },
  { key: 'delivered', label: 'Delivered', statuses: ['Delivered'] },
  { key: 'cancelled', label: 'Cancelled', statuses: ['Cancelled'] },
  { key: 'returns', label: 'Returns', statuses: ['Return Requested', 'Return Approved', 'Return Rejected', 'Refund Released'] },
];
const deliveryStages = ['Confirmed', 'Processing', 'Shipped', 'Delivered'];

export default function AdminSellerDetails() {
  const { sellerId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'orders' ? 'orders' : 'products';
  const { data: profile, loading: profileLoading, error: profileError, reload: reloadProfile } =
    useAdminSellerResource<SellerDetail>('/' + encodeURIComponent(sellerId) + '?view=products&page=1&limit=1');
  const seller = profile?.seller;

  const [products, setProducts] = useState<SellerProduct[]>([]);
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [stock, setStock] = useState('all');
  const [sort, setSort] = useState('name');
  const [direction, setDirection] = useState('asc');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const pending = useRef(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!sellerId) return;
    setLoading(true); setError('');
    try {
      const path = '/api/v1/users/sellers/' + encodeURIComponent(sellerId) + '?view=' + view;
      if (view === 'products') { const rows = await getAdminCollection<SellerProduct>(path, signal); if (!signal?.aborted) setProducts(rows); }
      else { const rows = await getAdminCollection<AdminOrder>(path, signal); if (!signal?.aborted) setOrders(rows); }
    } catch (err) { if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Could not load this information.'); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [sellerId, view]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  useEffect(() => { setSearch(''); setCategory('all'); setStock('all'); setSort(view === 'products' ? 'name' : 'newest'); setDirection('asc'); setStatus('all'); setPage(1); setExpanded(null); }, [view]);
  useEffect(() => setPage(1), [search, category, stock, sort, direction, status]);

  const dir = direction === 'desc' ? -1 : 1;
  const filteredProducts = products.filter(product => (category === 'all' || product.category === category) && (stock === 'all' || (stock === 'in' ? product.quantity > 0 : product.quantity <= 0)) && [product.name, product.category].join(' ').toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => dir * (sort === 'price' ? a.price - b.price : sort === 'stock' ? a.quantity - b.quantity : a.name.localeCompare(b.name)));
  const matchStatus = (order: AdminOrder, key: string) => key === 'all' || !!orderFilters.find(filter => filter.key === key)?.statuses.includes(order.status);
  const filteredOrders = orders.filter(order => matchStatus(order, status) && [order._id, order.firstName, order.lastName, order.email, order.product?.name].join(' ').toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => sort === 'total' ? b.totalPrice - a.totalPrice : sort === 'delivery' ? new Date(a.deliveryDate || '9999').getTime() - new Date(b.deliveryDate || '9999').getTime() : sort === 'name' ? (a.firstName + ' ' + a.lastName).localeCompare(b.firstName + ' ' + b.lastName) : sort === 'product' ? (a.product?.name || '').localeCompare(b.product?.name || '') : new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

  const filtered = view === 'products' ? filteredProducts : filteredOrders;
  const pages = Math.max(1, Math.ceil(filtered.length / 20));
  const current = Math.min(page, pages);

  const setDeliveryStatus = async (order: AdminOrder, next: string) => {
    if (next === order.status || pending.current) return;
    const prompt = order.status === 'Pending' ? `This order's payment has not been verified. Force it to ${next} anyway? Stock will be deducted as if it were paid.` : `Set this order's delivery status to ${next}?`;
    if (!window.confirm(prompt)) return;
    pending.current = true; setBusy(order._id);
    try {
      const res = await authFetch(import.meta.env.VITE_BACKEND_URL + '/api/v1/order/seller/update-status/' + order._id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: next }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'The order could not be updated.');
      setOrders(previous => previous.map(item => item._id === order._id ? { ...item, status: next } : item));
      toast.success('Order marked ' + next);
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Could not update order.'); }
    finally { pending.current = false; setBusy(null); }
  };
  const action = async (order: AdminOrder, kind: 'cancel' | 'approve' | 'reject' | 'refund') => {
    if (pending.current) return;
    const allowed = kind === 'cancel' ? ['Pending', 'Confirmed'].includes(order.status) : kind === 'refund' ? order.status === 'Return Approved' : order.status === 'Return Requested';
    if (!allowed) return;
    const prompt = kind === 'refund' ? 'Release the refund for this order? The customer will be notified by email.' : kind === 'cancel' ? 'Cancel this order and restore its stock?' : (kind === 'approve' ? 'Approve' : 'Reject') + ' this return request?';
    if (!window.confirm(prompt)) return;
    pending.current = true; setBusy(order._id);
    const path = kind === 'cancel' ? '/cancel/' : kind === 'refund' ? '/admin/refund/' : '/admin/return/';
    try {
      const res = await authFetch(import.meta.env.VITE_BACKEND_URL + '/api/v1/order' + path + order._id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, ...(kind === 'approve' || kind === 'reject' ? { body: JSON.stringify({ action: kind }) } : {}) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'The order could not be updated.');
      const next = kind === 'cancel' ? 'Cancelled' : kind === 'refund' ? 'Refund Released' : kind === 'approve' ? 'Return Approved' : 'Return Rejected';
      setOrders(previous => previous.map(item => item._id === order._id ? { ...item, status: next } : item));
      toast.success(kind === 'cancel' ? 'Order cancelled and stock restored' : next);
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Could not update order.'); }
    finally { pending.current = false; setBusy(null); }
  };

  return <main>
    <Link className="admin-text-link admin-back-link" to="/admin/sellers"><ArrowLeft size={14} aria-hidden="true" />All sellers</Link>
    <AdminHeading title={seller ? sellerName(seller) : 'Seller details'} description="Shop information and marketplace activity."><button className="admin-button" disabled={loading} onClick={() => { reloadProfile(); void load(); }}><RefreshCw size={14} aria-hidden="true" />Refresh</button></AdminHeading>
    {profileLoading && <p className="admin-empty" role="status">Loading seller details…</p>}
    {profileError && <p className="admin-notice" role="alert">{profileError} <button className="admin-text-link" onClick={reloadProfile}>Try again</button></p>}
    {seller && <>
      <section className="admin-panel" aria-labelledby="seller-profile-title"><div className="admin-panel-head"><h2 id="seller-profile-title">Seller profile</h2><span className={'admin-status admin-status--' + (seller.isVerified ? 'success' : 'attention')}>{sellerStatus(seller)}</span></div>
        <dl className="admin-seller-profile">
          <div><dt>Account owner</dt><dd>{[seller.firstName, seller.lastName].filter(Boolean).join(' ') || 'Not provided'}</dd></div>
          <div><dt>Email</dt><dd><a className="admin-text-link" href={'mailto:' + seller.email}>{seller.email}</a></dd></div>
          <div><dt>Phone</dt><dd>{seller.phone ? <a className="admin-text-link" href={'tel:' + seller.phone.replace(/[^+\d]/g, '')}>{seller.phone}</a> : 'Not provided'}</dd></div>
          <div><dt>Joined</dt><dd>{adminDate(seller.createdAt)}</dd></div>
          <div><dt>Verification requested</dt><dd>{adminDate(seller.verificationRequestDate || undefined)}</dd></div>
          <div><dt>Approved</dt><dd>{adminDate(seller.verificationApprovedDate || undefined)}</dd></div>
          <div className="admin-seller-profile-wide"><dt>Shop description</dt><dd>{seller.shopDescription || 'No shop description provided.'}</dd></div>
          {seller.verificationRejectionReason && <div className="admin-seller-profile-wide"><dt>{seller.isVerified ? 'Previous rejection reason' : 'Rejection reason'}</dt><dd>{seller.verificationRejectionReason}</dd></div>}
          <div className="admin-seller-profile-wide"><dt>Seller ID</dt><dd className="admin-numeric">{seller.id}</dd></div>
        </dl>
      </section>
      <div className="admin-tabs" aria-label="Seller activity"><button aria-pressed={view === 'products'} onClick={() => setParams({ view: 'products' })}>Products</button><button aria-pressed={view === 'orders'} onClick={() => setParams({ view: 'orders' })}>Orders</button></div>

      {view === 'products' ? <section className="admin-panel" aria-label="Product catalogue">
        <div className="admin-panel-head"><div><h2>Products from this shop</h2><p>Open a listing to review or edit it.</p></div></div>
        {error && <p className="admin-notice" role="alert">{error}</p>}
        <div className="admin-toolbar">
          <label className="admin-search"><Search size={15} aria-hidden="true" /><input type="search" aria-label="Search products" placeholder="Search product, category…" value={search} onChange={event => setSearch(event.target.value)} /></label>
          <div className="admin-filters">
            <label>Category<select aria-label="Filter product category" value={category} onChange={event => setCategory(event.target.value)}><option value="all">All categories</option>{[...new Set(products.map(product => product.category))].sort().map(value => <option key={value}>{value}</option>)}</select></label>
            <label>Stock<select aria-label="Filter product stock" value={stock} onChange={event => setStock(event.target.value)}><option value="all">All stock</option><option value="in">In stock</option><option value="out">Out of stock</option></select></label>
            <label>Sort<select aria-label="Sort products" value={sort} onChange={event => setSort(event.target.value)}><option value="name">Name</option><option value="price">Price</option><option value="stock">Stock</option></select></label>
            <label>Order<select aria-label="Sort order" value={direction} onChange={event => setDirection(event.target.value)}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label>
            {(search || category !== 'all' || stock !== 'all' || sort !== 'name' || direction !== 'asc') && <button className="admin-button" onClick={() => { setSearch(''); setCategory('all'); setStock('all'); setSort('name'); setDirection('asc'); }}>Clear filters</button>}
          </div>
        </div>
        {loading ? <p className="admin-empty" role="status">Loading products…</p> : error ? <p className="admin-empty">Refresh to load the catalogue.</p> : !filteredProducts.length ? <p className="admin-empty">{products.length ? 'No products match these filters.' : 'This seller has not listed any products.'}</p> :
          <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th scope="col">Product</th><th scope="col">Category</th><th scope="col">Stock</th><th scope="col">Price</th><th scope="col">Actions</th></tr></thead><tbody>{filteredProducts.slice((current - 1) * 20, current * 20).map(product => <tr key={product.id}><td><div className="admin-product-cell"><img src={product.images?.[0] ? getImageUrl(product.images[0]) : '/images/product-placeholder.svg'} alt="" onError={event => { event.currentTarget.onerror = null; event.currentTarget.src = '/images/product-placeholder.svg'; }} /><Link className="admin-text-link" to={'/product-details-admin/' + product.id}>{product.name}</Link></div></td><td>{product.category}</td><td><span className={'admin-status admin-status--' + (product.quantity > 0 ? 'success' : 'attention')}>{product.quantity > 0 ? 'In stock' : 'Out of stock'}</span><small>{product.quantity > 0 ? product.quantity + ' units available' : ''}</small></td><td className="admin-numeric">{adminMoney(product.price)}</td><td><Link className="admin-button" to={'/product-details-admin/' + product.id}>View / edit</Link></td></tr>)}</tbody></table></div>}
        {!loading && !error && filteredProducts.length > 0 && <AdminPagination page={current} pages={pages} onPage={setPage} />}
      </section> : <section className="admin-panel" aria-label="Orders list">
        <div className="admin-panel-head"><div><h2>Orders for this shop</h2><p>Orders containing this seller's products, not their personal purchases.</p></div></div>
        <div className="admin-tabs" aria-label="Order status filters">{orderFilters.map(filter => <button key={filter.key} aria-pressed={status === filter.key} onClick={() => setStatus(filter.key)}>{filter.label}<span>({loading || error ? '—' : orders.filter(order => matchStatus(order, filter.key)).length})</span></button>)}</div>
        {error && <p className="admin-notice" role="alert">{error}</p>}
        <div className="admin-toolbar"><label className="admin-search"><Search size={15} aria-hidden="true" /><input type="search" aria-label="Search orders" placeholder="Search order, customer, email…" value={search} onChange={event => setSearch(event.target.value)} /></label><div className="admin-filters"><label>Sort by<select aria-label="Sort orders" value={sort} onChange={event => setSort(event.target.value)}><option value="newest">Date (newest first)</option><option value="name">Customer name</option><option value="product">Product name</option><option value="delivery">Delivery date</option><option value="total">Highest total</option></select></label>{(search || status !== 'all') && <button className="admin-button" onClick={() => { setSearch(''); setStatus('all'); }}>Clear filters</button>}</div></div>
        {loading ? <p className="admin-empty" role="status">Loading orders…</p> : error ? <p className="admin-empty">Refresh to load the order list.</p> : !filteredOrders.length ? <p className="admin-empty">{orders.length ? 'No orders match these filters.' : 'No orders for this seller yet.'}</p> :
          <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th scope="col">Order / customer</th><th scope="col">Date</th><th scope="col">Status</th><th scope="col">Total</th><th scope="col">Actions</th></tr></thead><tbody>{filteredOrders.slice((current - 1) * 20, current * 20).map(order => <Fragment key={order._id}>
            <tr><td><Link className="admin-text-link" to={'/admin/orders/' + order._id}>#{order._id.slice(-8)} · {order.firstName} {order.lastName}</Link><small>{order.email}</small><small>{order.product?.name || 'Product'}</small></td><td className="admin-numeric">{adminDate(order.createdAt)}</td><td><OrderStatus status={order.status} /></td><td className="admin-numeric">{adminMoney(order.totalPrice)}</td><td><button className="admin-button" aria-label={'Preview order ' + order._id.slice(-8)} aria-expanded={expanded === order._id} aria-controls={'preview-' + order._id} onClick={() => setExpanded(expanded === order._id ? null : order._id)}>{expanded === order._id ? 'Close' : 'Preview'}</button></td></tr>
            {expanded === order._id && <tr id={'preview-' + order._id}><td colSpan={5}><div className="admin-order-preview"><h3>{order.product?.name || 'Order details'}</h3><dl><div><dt>Customer</dt><dd>{order.firstName} {order.lastName}<br />{order.email}</dd></div><div><dt>Expected delivery</dt><dd>{adminDate(order.deliveryDate)}</dd></div><div><dt>Quantity / configuration</dt><dd>{order.quantity} · {order.color || order.variants?.color || 'Standard'} {order.variants?.storage || ''}</dd></div></dl>
              {order.returnReason && <p>Return reason: {order.returnReason}</p>}
              {order.returnImage && <a href={import.meta.env.VITE_BACKEND_URL + '/uploads/' + order.returnImage} target="_blank" rel="noreferrer"><img src={import.meta.env.VITE_BACKEND_URL + '/uploads/' + order.returnImage} alt="Customer return evidence" /></a>}
              {order.status === 'Pending' && <p className="admin-notice">Payment has not been verified yet. You can still force this order into the delivery pipeline below.</p>}
              <div className="admin-order-preview-actions"><Link className="admin-button admin-button--primary" to={'/admin/orders/' + order._id}>View full order</Link>
                {(deliveryStages.includes(order.status) || order.status === 'Pending') && <label>Delivery status <select aria-label="Set delivery status" disabled={!!busy} value={deliveryStages.includes(order.status) ? order.status : ''} onChange={event => void setDeliveryStatus(order, event.target.value)}>{order.status === 'Pending' && <option value="" disabled>Pending (unpaid)</option>}{deliveryStages.map(stage => <option key={stage} value={stage}>{stage}</option>)}</select></label>}
                {['Pending', 'Confirmed'].includes(order.status) && <button className="admin-button admin-button--danger" disabled={!!busy} onClick={() => void action(order, 'cancel')}>Cancel order</button>}
                {order.status === 'Return Requested' && <><button className="admin-button" disabled={!!busy} onClick={() => void action(order, 'approve')}>Approve return</button><button className="admin-button admin-button--danger" disabled={!!busy} onClick={() => void action(order, 'reject')}>Reject return</button></>}
                {order.status === 'Return Approved' && <button className="admin-button" disabled={!!busy} onClick={() => void action(order, 'refund')}>Release refund · {adminMoney(order.totalPrice)}</button>}
                {busy === order._id && <span role="status">Updating order…</span>}
              </div>
            </div></td></tr>}
          </Fragment>)}</tbody></table></div>}
        {!loading && !error && filteredOrders.length > 0 && <AdminPagination page={current} pages={pages} onPage={setPage} />}
      </section>}
    </>}
  </main>;
}
