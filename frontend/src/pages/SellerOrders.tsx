import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RefreshCw, Search } from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '../lib/session';
import { AdminHeading, AdminPagination, OrderStatus } from '../components/admin/AdminUi';
import { adminDate, adminMoney } from '../lib/adminData';
import { deliveryProgress, deliverySteps, formatAddress, getSellerCollection, matchesOrderFilter, nextDeliveryStage, orderFilters, type SellerOrder } from '../lib/sellerData';

const terminal = ['Return Approved', 'Return Rejected', 'Refund Released', 'Cancelled'];

export default function SellerOrders() {
  const [params, setParams] = useSearchParams();
  const status = orderFilters.some(filter => filter.key === params.get('status')) ? params.get('status')! : 'all';
  const search = params.get('q') || '';
  const [orders, setOrders] = useState<SellerOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sort, setSort] = useState('newest');
  const [size, setSize] = useState(20);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showEmail, setShowEmail] = useState(true);
  const [showDelivery, setShowDelivery] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const pending = useRef(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError('');
    try { const rows = await getSellerCollection<SellerOrder>('/api/v1/order/seller/my-orders', 'orders', signal); if (!signal?.aborted) setOrders(rows); }
    catch (err) { if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Could not load your orders.'); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, []);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  useEffect(() => { setPage(1); setExpanded(null); }, [status, search, sort, size]);

  const query = (key: string, value: string) => { const next = new URLSearchParams(params); if (!value || value === 'all') next.delete(key); else next.set(key, value); setParams(next, { replace: true }); };
  const filtered = orders
    .filter(order => matchesOrderFilter(order, status) && [order._id, order.firstName, order.lastName, order.email, order.product?.name].join(' ').toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => sort === 'total' ? Number(b.totalPrice) - Number(a.totalPrice)
      : sort === 'delivery' ? new Date(a.deliveryDate || '9999').getTime() - new Date(b.deliveryDate || '9999').getTime()
      : sort === 'name' ? `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)
      : new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  const pages = Math.max(1, Math.ceil(filtered.length / size));
  const currentPage = Math.min(page, pages);
  const rows = filtered.slice((currentPage - 1) * size, currentPage * size);

  const update = async (order: SellerOrder, path: string, body: Record<string, string>, next: string, confirmation: string, success: string) => {
    if (pending.current) return;
    if (!window.confirm(confirmation)) return;
    pending.current = true; setBusy(order._id);
    try {
      const response = await authFetch(`${import.meta.env.VITE_BACKEND_URL}/api/v1/order${path}${order._id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'The order could not be updated.');
      setOrders(previous => previous.map(item => item._id === order._id ? { ...item, status: next } : item));
      toast.success(success);
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Could not update order.'); }
    finally { pending.current = false; setBusy(null); }
  };
  const advance = (order: SellerOrder, stage: string) => update(order, '/seller/update-status/', { status: stage }, stage, `Mark this order ${stage}?`, `Order marked ${stage}`);
  const answerReturn = (order: SellerOrder, action: 'approve' | 'reject') => update(order, '/seller/return/', { action }, action === 'approve' ? 'Return Approved' : 'Return Rejected', `${action === 'approve' ? 'Approve' : 'Reject'} this return request?`, action === 'approve' ? 'Return approved' : 'Return rejected');

  const columns = showDelivery ? 6 : 5;
  return <main>
    <AdminHeading title="Orders" description="Fulfil customer orders and answer return requests.">
      <button className="admin-button" disabled={loading || !!busy} onClick={() => void load()}><RefreshCw size={14} aria-hidden="true" />Refresh</button>
    </AdminHeading>
    <details className="admin-screen-options"><summary>Screen options</summary><div>
      <label><input type="checkbox" checked={showEmail} onChange={event => setShowEmail(event.target.checked)} />Customer email</label>
      <label><input type="checkbox" checked={showDelivery} onChange={event => setShowDelivery(event.target.checked)} />Expected delivery</label>
      <label>Rows per page <select aria-label="Orders per page" value={size} onChange={event => setSize(Number(event.target.value))}><option>20</option><option>50</option><option>100</option></select></label>
    </div></details>
    <div className="admin-tabs" aria-label="Order status filters">{orderFilters.map(filter => <button key={filter.key} aria-pressed={status === filter.key} onClick={() => query('status', filter.key)}>{filter.label}<span>({loading || error ? '—' : orders.filter(order => matchesOrderFilter(order, filter.key)).length})</span></button>)}</div>
    {error && <p className="admin-notice" role="alert">{error}</p>}
    <section className="admin-panel" aria-label="Order list">
      <div className="admin-toolbar">
        <label className="admin-search"><Search size={15} aria-hidden="true" /><input type="search" aria-label="Search orders" placeholder="Search order, customer, product…" value={search} onChange={event => query('q', event.target.value)} /></label>
        <div className="admin-filters">
          <label>Sort by<select aria-label="Sort orders" value={sort} onChange={event => setSort(event.target.value)}><option value="newest">Date (newest first)</option><option value="delivery">Delivery date (soonest first)</option><option value="name">Customer name</option><option value="total">Highest total</option></select></label>
          {(search || status !== 'all') && <button className="admin-button" onClick={() => setParams({})}>Clear filters</button>}
        </div>
      </div>
      {loading ? <p className="admin-empty" role="status">Loading orders…</p>
        : error ? <p className="admin-empty">Refresh to load your order list.</p>
        : !rows.length ? <p className="admin-empty">{orders.length ? 'No orders match these filters.' : 'Once customers buy your products, their orders will appear here.'}</p>
        : <div className="admin-table-wrap"><table className="admin-table">
          <thead><tr>
            <th scope="col">Order / customer</th>
            <th scope="col">Date</th>
            {showDelivery && <th scope="col">Expected delivery</th>}
            <th scope="col">Status</th>
            <th scope="col">Total</th>
            <th scope="col">Actions</th>
          </tr></thead>
          <tbody>{rows.map(order => {
            const progress = deliveryProgress(order.status);
            const stage = nextDeliveryStage(order.status);
            return <Fragment key={order._id}>
              <tr>
                <td>
                  <strong>#{order._id.slice(-8)} · {order.firstName} {order.lastName}</strong>
                  {showEmail && <small>{order.email}</small>}
                  <small>{order.quantity} × {order.product?.name || 'Product'}</small>
                </td>
                <td className="admin-numeric">{adminDate(order.createdAt)}</td>
                {showDelivery && <td className="admin-numeric">{adminDate(order.deliveryDate)}</td>}
                <td><OrderStatus status={order.status} /></td>
                <td className="admin-numeric">{adminMoney(order.totalPrice)}</td>
                <td><button className="admin-button" aria-label={`Preview order ${order._id.slice(-8)}`} aria-expanded={expanded === order._id} aria-controls={`seller-preview-${order._id}`} onClick={() => setExpanded(expanded === order._id ? null : order._id)}>{expanded === order._id ? 'Close' : 'Preview'}</button></td>
              </tr>
              {expanded === order._id && <tr id={`seller-preview-${order._id}`}><td colSpan={columns}><div className="admin-order-preview">
                <h3>{order.product?.name || 'Order details'}</h3>
                {!terminal.includes(order.status) && <div className="admin-steps" aria-label="Delivery progress">{deliverySteps.map((step, index) => <Fragment key={step}>
                  {index > 0 && <span className={`admin-step-line${progress >= index ? ' is-done' : ''}`} aria-hidden="true" />}
                  <span className={`admin-step${progress === index ? ' is-current' : progress > index ? ' is-done' : ''}`} aria-current={progress === index ? 'step' : undefined}><b aria-hidden="true">{index + 1}</b>{step}</span>
                </Fragment>)}</div>}
                <dl>
                  <div><dt>Customer</dt><dd>{order.firstName} {order.lastName}<br />{order.email}{order.phone && <><br />{order.phone}</>}</dd></div>
                  <div><dt>Delivery address</dt><dd>{formatAddress(order.deliveryAddress)}</dd></div>
                  <div><dt>Quantity / configuration</dt><dd>{order.quantity} · {order.color || order.variants?.color || 'Standard'} {order.variants?.storage || ''}</dd></div>
                </dl>
                {order.status === 'Pending' && <p className="admin-notice">The customer's payment has not been verified yet. Delivery can start once it is confirmed.</p>}
                {order.returnReason && <p>Return reason: {order.returnReason}</p>}
                {order.returnImage && <a href={`${import.meta.env.VITE_BACKEND_URL}/uploads/${order.returnImage}`} target="_blank" rel="noreferrer"><img src={`${import.meta.env.VITE_BACKEND_URL}/uploads/${order.returnImage}`} alt="Customer return evidence" /></a>}
                {order.status === 'Return Approved' && <p>The return is approved. An admin releases the refund.</p>}
                <div className="admin-order-preview-actions">
                  {stage && <button className="admin-button admin-button--primary" disabled={!!busy} onClick={() => void advance(order, stage)}>Mark {stage}</button>}
                  {order.status === 'Return Requested' && <><button className="admin-button" disabled={!!busy} onClick={() => void answerReturn(order, 'approve')}>Approve return</button><button className="admin-button admin-button--danger" disabled={!!busy} onClick={() => void answerReturn(order, 'reject')}>Reject return</button></>}
                  {!stage && order.status !== 'Return Requested' && <span>No action is available at this stage.</span>}
                  {busy === order._id && <span role="status">Updating order…</span>}
                </div>
              </div></td></tr>}
            </Fragment>;
          })}</tbody>
        </table></div>}
      {!loading && !error && rows.length > 0 && <AdminPagination page={currentPage} pages={pages} onPage={setPage} />}
    </section>
  </main>;
}
