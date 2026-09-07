import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BarChart3, ClipboardList, Package, Plus, RefreshCw, RotateCcw, AlertTriangle } from 'lucide-react';
import { AdminEmptyState, AdminHeading, OrderStatus } from '../components/admin/AdminUi';
import { adminDate, adminMoney } from '../lib/adminData';
import { getSellerCollection, stockState, type SellerOrder, type SellerProduct } from '../lib/sellerData';
import { useSellerApproval } from '../components/seller/SellerApprovalContext';

export default function SellerPanel() {
  const { pending: pendingApproval } = useSellerApproval();
  const [orders, setOrders] = useState<SellerOrder[] | null>(null);
  const [products, setProducts] = useState<SellerProduct[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState('30');

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError('');
    const results = await Promise.allSettled([
      getSellerCollection<SellerOrder>('/api/v1/order/seller/my-orders', 'orders', signal),
      getSellerCollection<SellerProduct>('/api/v1/product/seller/my-products', 'products', signal),
    ]);
    if (signal?.aborted) return;
    setOrders(results[0].status === 'fulfilled' ? results[0].value : null);
    setProducts(results[1].status === 'fulfilled' ? results[1].value : null);
    if (results.some(result => result.status === 'rejected')) setError('Some of your shop information could not be loaded. Refresh to try again.');
    setLoading(false);
  }, []);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);

  const since = Date.now() - Number(period) * 86400000;
  const inPeriod = (orders || []).filter(order => period === 'all' || (order.createdAt && new Date(order.createdAt).getTime() >= since));
  const value = inPeriod.filter(order => !['Cancelled', 'Refund Released'].includes(order.status)).reduce((sum, order) => sum + Number(order.totalPrice || 0), 0);
  const toFulfil = orders?.filter(order => ['Confirmed', 'Processing', 'Shipped'].includes(order.status)).length;
  const returns = orders?.filter(order => order.status === 'Return Requested').length;
  const outOfStock = products?.filter(product => stockState(product) === 'outofstock').length;
  const lowStock = products?.filter(product => stockState(product) === 'lowstock').length;
  const recent = [...(orders || [])].sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()).slice(0, 6);
  const available = !loading && orders !== null;

  return <main className="seller-overview">
    <section className="seller-overview-feature" aria-label="Shop overview summary">
      <AdminHeading eyebrow="Seller workspace" title="Shop overview" description="Track your sales, keep stock ready, and take care of your customers.">
        <button className="admin-button" onClick={() => void load()} disabled={loading}><RefreshCw size={14} aria-hidden="true" />{loading ? 'Refreshing…' : 'Refresh'}</button>
        {pendingApproval ? <button className="admin-button admin-button--primary" disabled title="Available after admin approval"><Plus size={14} aria-hidden="true" />Add product after approval</button> : <Link className="admin-button admin-button--primary" to="/add-product"><Plus size={14} aria-hidden="true" />Add product</Link>}
      </AdminHeading>
      {error && <p className="admin-notice" role="alert">{error}</p>}
      <section className="admin-panel seller-overview-performance" aria-labelledby="seller-performance-title">
        <div className="admin-panel-head"><div><h2 id="seller-performance-title">Shop performance</h2><p>Order activity for your selected period</p></div><label className="admin-filters">Date range <select aria-label="Performance date range" value={period} onChange={event => setPeriod(event.target.value)}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="all">All time</option></select></label></div>
        <div className="admin-stats" aria-busy={loading}>
          <div className="admin-stat"><span>Orders received</span><strong>{available ? inPeriod.length : '—'}</strong><small>Based on the order creation date</small></div>
          <div className="admin-stat"><span>Order value</span><strong>{available ? adminMoney(value) : '—'}</strong><small>Excludes cancelled and refunded orders; before the 5% commission</small></div>
          <div className="admin-stat"><span>Products listed</span><strong>{!loading && products !== null ? products.length : '—'}</strong><small><Link className="admin-text-link" to="/seller-products">Manage your products →</Link></small></div>
        </div>
      </section>
    </section>
    <div className="admin-home-columns">
      <section className="admin-panel" aria-labelledby="seller-tasks-title">
        <div className="admin-panel-head"><div><h2 id="seller-tasks-title">Needs attention</h2><p>Open work in your shop · all time</p></div></div>
        <Link className="admin-task" to="/seller-orders?status=processing"><ClipboardList size={19} aria-hidden="true" /><div><strong>Fulfil customer orders</strong><p>Move paid orders through processing, shipping, and delivery.</p></div><span>{loading ? '—' : toFulfil ?? '—'}</span><ArrowRight size={14} aria-hidden="true" /></Link>
        <Link className="admin-task" to="/seller-orders?status=returns"><RotateCcw size={19} aria-hidden="true" /><div><strong>Answer return requests</strong><p>Approve or reject returns customers have raised.</p></div><span>{loading ? '—' : returns ?? '—'}</span><ArrowRight size={14} aria-hidden="true" /></Link>
        <Link className="admin-task" to="/seller-products?stock=outofstock"><AlertTriangle size={19} aria-hidden="true" /><div><strong>Restock sold-out products</strong><p>Listings customers cannot buy right now.</p></div><span>{loading ? '—' : outOfStock ?? '—'}</span><ArrowRight size={14} aria-hidden="true" /></Link>
        <Link className="admin-task" to="/seller-products?stock=lowstock"><Package size={19} aria-hidden="true" /><div><strong>Review low stock</strong><p>Listings with five or fewer units left.</p></div><span>{loading ? '—' : lowStock ?? '—'}</span><ArrowRight size={14} aria-hidden="true" /></Link>
      </section>
      <section className="admin-panel" aria-labelledby="seller-shortcuts-title">
        <div className="admin-panel-head"><h2 id="seller-shortcuts-title">Shop management</h2></div>
        {pendingApproval ? <div className="admin-task is-disabled" aria-disabled="true"><Plus size={19} aria-hidden="true" /><div><strong>Add a product after approval</strong><p>Admin approval is required before listings can be created.</p></div></div> : <Link className="admin-task" to="/add-product"><Plus size={19} aria-hidden="true" /><div><strong>Add a product</strong><p>List something new for sale.</p></div><ArrowRight size={14} aria-hidden="true" /></Link>}
        <Link className="admin-task" to="/seller-products"><Package size={19} aria-hidden="true" /><div><strong>Manage your catalogue</strong><p>Edit listings, stock, prices, and discounts.</p></div><ArrowRight size={14} aria-hidden="true" /></Link>
        <Link className="admin-task" to="/seller/revenue"><BarChart3 size={19} aria-hidden="true" /><div><strong>Analytics</strong><p>Track sales, commission, and earnings.</p></div><ArrowRight size={14} aria-hidden="true" /></Link>
      </section>
    </div>
    <section className="admin-panel" aria-labelledby="seller-recent-title">
      <div className="admin-panel-head"><h2 id="seller-recent-title">Recent orders</h2><Link className="admin-text-link" to="/seller-orders">View all orders →</Link></div>
      {loading ? <p className="admin-empty" role="status">Loading orders…</p> : orders === null ? <p className="admin-empty">Orders are unavailable. Use Refresh to try again.</p> : recent.length === 0 ? <AdminEmptyState icon={<ClipboardList />} title="No customer orders yet" description="Orders will appear here after a customer buys one of your listings." action={pendingApproval ? <Link className="admin-button" to="/seller-products">Review catalogue</Link> : <Link className="admin-button admin-button--primary" to="/add-product">Add your first product</Link>} /> :
        <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th scope="col">Order / customer</th><th scope="col">Date</th><th scope="col">Status</th><th scope="col">Total</th></tr></thead><tbody>{recent.map(order => <tr key={order._id}><td><Link className="admin-text-link" to={`/seller-orders?q=${encodeURIComponent(order._id)}`}>#{order._id.slice(-8)} · {order.firstName} {order.lastName}</Link><small>{order.product?.name || 'Product'}</small></td><td className="admin-numeric">{adminDate(order.createdAt)}</td><td><OrderStatus status={order.status} /></td><td className="admin-numeric">{adminMoney(order.totalPrice)}</td></tr>)}</tbody></table></div>}
    </section>
  </main>;
}
