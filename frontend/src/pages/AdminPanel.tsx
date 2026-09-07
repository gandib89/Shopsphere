import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ClipboardList, RotateCcw, Store, Tag, Users, Package } from 'lucide-react';
import { AdminEmptyState, AdminHeading, OrderStatus } from '../components/admin/AdminUi';
import { activeOrder, adminDate, adminMoney, getAdminCollection, type AdminOrder } from '../lib/adminData';

type Seller = { _id: string; shopName?: string };
export default function AdminPanel() {
  const [orders, setOrders] = useState<AdminOrder[] | null>(null);
  const [sellers, setSellers] = useState<Seller[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState('30');
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError('');
    const results = await Promise.allSettled([
      getAdminCollection<AdminOrder>('/api/v1/order/getOrder', signal),
      getAdminCollection<Seller>('/api/v1/auth/unverified-sellers', signal),
    ]);
    if (signal?.aborted) return;
    setOrders(results[0].status === 'fulfilled' ? results[0].value : null);
    setSellers(results[1].status === 'fulfilled' ? results[1].value : null);
    if (results.some(result => result.status === 'rejected')) setError('Some store information could not be loaded. Reload the page to try again.');
    setLoading(false);
  }, []);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);

  const since = Date.now() - Number(period) * 86400000;
  const filtered = (orders || []).filter(order => period === 'all' || (order.createdAt && new Date(order.createdAt).getTime() >= since));
  const pending = orders?.filter(activeOrder).length;
  const returns = orders?.filter(order => ['Return Requested', 'Return Approved'].includes(order.status)).length;
  const value = filtered.filter(order => !['Cancelled', 'Refund Released'].includes(order.status)).reduce((sum, order) => sum + Number(order.totalPrice), 0);
  const recent = [...(orders || [])].sort((a,b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()).slice(0, 6);
  const available = !loading && orders !== null;

  return <main>
    <AdminHeading title="Marketplace overview" description="Monitor your marketplace, review applications, and keep orders moving.">
      <Link className="admin-button admin-button--primary" to="/admin/orders">Manage orders<ArrowRight size={14} aria-hidden="true" /></Link>
    </AdminHeading>
    {error && <p className="admin-notice" role="alert">{error}</p>}
    <section className="admin-panel" aria-labelledby="performance-title">
      <div className="admin-panel-head"><div><h2 id="performance-title">Store performance</h2><p>Order activity for your selected period</p></div><label className="admin-filters">Date range <select aria-label="Performance date range" value={period} onChange={event => setPeriod(event.target.value)}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="all">All time</option></select></label></div>
      <div className="admin-stats" aria-busy={loading}>
        <div className="admin-stat"><span>Orders placed</span><strong>{available ? filtered.length : '—'}</strong><small>Based on the order creation date</small></div>
        <div className="admin-stat"><span>Order value</span><strong>{available ? adminMoney(value) : '—'}</strong><small>Excludes cancelled and refunded orders; not settled revenue</small></div>
        <div className="admin-stat"><span>Delivered orders</span><strong>{available ? filtered.filter(order => order.status === 'Delivered').length : '—'}</strong><small><Link className="admin-text-link" to="/admin/revenue">View revenue & commissions →</Link></small></div>
      </div>
    </section>
    <div className="admin-home-columns">
      <section className="admin-panel" aria-labelledby="tasks-title">
        <div className="admin-panel-head"><div><h2 id="tasks-title">Needs attention</h2><p>Open work across your marketplace · all time</p></div></div>
        <Link className="admin-task" to="/admin/orders?status=active"><ClipboardList size={19} aria-hidden="true" /><div><strong>Fulfil customer orders</strong><p>Review pending, processing, and shipped orders.</p></div><span>{loading ? '—' : pending ?? '—'}</span><ArrowRight size={14} aria-hidden="true" /></Link>
        <Link className="admin-task" to="/admin/seller-approvals"><Store size={19} aria-hidden="true" /><div><strong>Review seller applications</strong><p>Check shops before approving marketplace access.</p></div><span>{loading ? '—' : sellers?.length ?? '—'}</span><ArrowRight size={14} aria-hidden="true" /></Link>
        <Link className="admin-task" to="/admin/orders?status=returns"><RotateCcw size={19} aria-hidden="true" /><div><strong>Review returns & refunds</strong><p>Resolve return requests and approved refunds.</p></div><span>{loading ? '—' : returns ?? '—'}</span><ArrowRight size={14} aria-hidden="true" /></Link>
      </section>
      <section className="admin-panel" aria-labelledby="shortcuts-title">
        <div className="admin-panel-head"><h2 id="shortcuts-title">Store management</h2></div>
        <Link className="admin-task" to="/all-products"><Package size={19} aria-hidden="true" /><div><strong>Manage your catalogue</strong><p>Review listings, stock, and prices.</p></div><ArrowRight size={14} aria-hidden="true" /></Link>
        <Link className="admin-task" to="/admin/promo-codes"><Tag size={19} aria-hidden="true" /><div><strong>Create a promotion</strong><p>Manage your existing coupon tools.</p></div><ArrowRight size={14} aria-hidden="true" /></Link>
        <Link className="admin-task" to="/admin/users"><Users size={19} aria-hidden="true" /><div><strong>Customers & users</strong><p>Find accounts and manage access.</p></div><ArrowRight size={14} aria-hidden="true" /></Link>
      </section>
    </div>
    <section className="admin-panel" aria-labelledby="recent-title"><div className="admin-panel-head"><h2 id="recent-title">Recent orders</h2><Link className="admin-text-link" to="/admin/orders">View all orders →</Link></div>
      {loading ? <p className="admin-empty" role="status">Loading orders…</p> : orders === null ? <p className="admin-empty">Orders are unavailable. Reload the page to try again.</p> : recent.length === 0 ? <AdminEmptyState icon={<ClipboardList />} title="No customer orders yet" description="Orders will appear here when customers complete checkout." action={<Link className="admin-button admin-button--primary" to="/all-products">Review catalogue</Link>} /> :
        <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th scope="col">Order / customer</th><th scope="col">Date</th><th scope="col">Status</th><th scope="col">Total</th></tr></thead><tbody>{recent.map(order => <tr key={order._id}><td><Link className="admin-text-link" to={'/admin/orders/' + order._id}>#{order._id.slice(-8)} · {order.firstName} {order.lastName}</Link><small>{order.product?.name || 'Product'}</small></td><td>{adminDate(order.createdAt)}</td><td><OrderStatus status={order.status} /></td><td className="admin-numeric">{adminMoney(order.totalPrice)}</td></tr>)}</tbody></table></div>}
    </section>
  </main>;
}
