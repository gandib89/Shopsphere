import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { RefreshCw, Search } from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '../lib/session';
import { AdminHeading, AdminPagination, OrderStatus } from '../components/admin/AdminUi';
import { adminDate, adminMoney, getAdminCollection, type AdminOrder } from '../lib/adminData';

const filters = [
  {key:'all', label:'All', statuses:[]},
  {key:'active', label:'Active', statuses:['Pending','Confirmed','Processing','Shipped']},
  {key:'delivered', label:'Delivered', statuses:['Delivered']},
  {key:'cancelled', label:'Cancelled', statuses:['Cancelled']},
  {key:'returns', label:'Returns', statuses:['Return Requested','Return Approved','Return Rejected','Refund Released']},
];
export default function AdminOrders() {
  const [params, setParams] = useSearchParams();
  const status = filters.some(filter => filter.key === params.get('status')) ? params.get('status')! : 'all';
  const search = params.get('q') || '';
  const [orders,setOrders] = useState<AdminOrder[]>([]);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [sort,setSort] = useState('newest');
  const [size,setSize] = useState(20);
  const [page,setPage] = useState(1);
  const [expanded,setExpanded] = useState<string | null>(null);
  const [showEmail,setShowEmail] = useState(true);
  const [showDate,setShowDate] = useState(true);
  const [busy,setBusy] = useState<string | null>(null);
  const pending = useRef(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError('');
    try { const rows = await getAdminCollection<AdminOrder>('/api/v1/order/getOrder',signal); if(!signal?.aborted) setOrders(rows); }
    catch (err) { if(!signal?.aborted) setError(err instanceof Error ? err.message : 'Could not load orders.'); }
    finally { if(!signal?.aborted) setLoading(false); }
  },[]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); },[load]);
  useEffect(() => {setPage(1);setExpanded(null);},[status,search,sort,size]);
  const query = (key: string, value: string) => { const next = new URLSearchParams(params); if(!value || value === 'all') next.delete(key); else next.set(key,value); setParams(next,{replace:true}); };
  const matchStatus = (order: AdminOrder, key: string) => key === 'all' || !!filters.find(filter => filter.key === key)?.statuses.includes(order.status);
  const filtered = orders.filter(order => matchStatus(order,status) && [order._id,order.firstName,order.lastName,order.email,order.product?.name].join(' ').toLowerCase().includes(search.trim().toLowerCase())).sort((a,b) => sort === 'total' ? b.totalPrice-a.totalPrice : sort === 'delivery' ? new Date(a.deliveryDate || '9999').getTime()-new Date(b.deliveryDate || '9999').getTime() : sort === 'name' ? (a.firstName+' '+a.lastName).localeCompare(b.firstName+' '+b.lastName) : sort === 'product' ? (a.product?.name || '').localeCompare(b.product?.name || '') : new Date(b.createdAt || 0).getTime()-new Date(a.createdAt || 0).getTime());
  const pages = Math.max(1,Math.ceil(filtered.length/size));
  const currentPage = Math.min(page,pages);
  const rows = filtered.slice((currentPage-1)*size,currentPage*size);

  const deliveryStages = ['Confirmed','Processing','Shipped','Delivered'];
  const setDeliveryStatus = async (order: AdminOrder, next: string) => {
    if(next === order.status || pending.current) return;
    const prompt = order.status === 'Pending' ? `This order's payment has not been verified. Force it to ${next} anyway? Stock will be deducted as if it were paid.` : `Set this order's delivery status to ${next}?`;
    if(!window.confirm(prompt)) return;
    pending.current = true; setBusy(order._id);
    try {
      const res = await authFetch(import.meta.env.VITE_BACKEND_URL+'/api/v1/order/seller/update-status/'+order._id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:next})});
      const data = await res.json();
      if(!res.ok) throw new Error(data.message || 'The order could not be updated.');
      setOrders(previous => previous.map(item => item._id === order._id ? {...item,status:next} : item));
      toast.success('Order marked '+next);
    } catch(err) {toast.error(err instanceof Error ? err.message : 'Could not update order.');}
    finally {pending.current=false;setBusy(null);}
  };
  const action = async (order: AdminOrder, kind: 'cancel'|'approve'|'reject'|'refund') => {
    if(pending.current) return;
    const allowed = kind === 'cancel' ? ['Pending','Confirmed'].includes(order.status) : kind === 'refund' ? order.status === 'Return Approved' : order.status === 'Return Requested';
    if(!allowed) return;
    const prompt = kind === 'refund' ? 'Release the refund for this order? The customer will be notified by email.' : kind === 'cancel' ? 'Cancel this order and restore its stock?' : (kind === 'approve' ? 'Approve' : 'Reject') + ' this return request?';
    if(!window.confirm(prompt)) return;
    pending.current = true; setBusy(order._id);
    const path = kind === 'cancel' ? '/cancel/' : kind === 'refund' ? '/admin/refund/' : '/admin/return/';
    try {
      const res = await authFetch(import.meta.env.VITE_BACKEND_URL+'/api/v1/order'+path+order._id,{method:'PUT',headers:{'Content-Type':'application/json'},...(kind === 'approve' || kind === 'reject' ? {body:JSON.stringify({action:kind})} : {})});
      const data = await res.json();
      if(!res.ok) throw new Error(data.message || 'The order could not be updated.');
      const next = kind === 'cancel' ? 'Cancelled' : kind === 'refund' ? 'Refund Released' : kind === 'approve' ? 'Return Approved' : 'Return Rejected';
      setOrders(previous => previous.map(item => item._id === order._id ? {...item,status:next} : item));
      toast.success(kind === 'cancel' ? 'Order cancelled and stock restored' : next);
    } catch(err) {toast.error(err instanceof Error ? err.message : 'Could not update order.');}
    finally {pending.current=false;setBusy(null);}
  };

  return <main>
    <AdminHeading title="Orders" description="Find an order, review its details, and take the next action."><button className="admin-button" disabled={loading || !!busy} onClick={() => void load()}><RefreshCw size={14} aria-hidden="true" />Refresh</button></AdminHeading>
    <details className="admin-screen-options"><summary>Screen options</summary><div><label><input type="checkbox" checked={showEmail} onChange={event=>setShowEmail(event.target.checked)} />Customer email</label><label><input type="checkbox" checked={showDate} onChange={event=>setShowDate(event.target.checked)} />Order date</label><label>Rows per page <select aria-label="Orders per page" value={size} onChange={event=>setSize(Number(event.target.value))}><option>20</option><option>50</option><option>100</option></select></label></div></details>
    <div className="admin-tabs" aria-label="Order status filters">{filters.map(filter=><button key={filter.key} aria-pressed={status===filter.key} onClick={()=>query('status',filter.key)}>{filter.label}<span>({loading || error ? '—' : orders.filter(order=>matchStatus(order,filter.key)).length})</span></button>)}</div>
    {error && <p className="admin-notice" role="alert">{error}</p>}
    <section className="admin-panel" aria-label="Orders list">
      <div className="admin-toolbar"><label className="admin-search"><Search size={15} aria-hidden="true" /><input type="search" aria-label="Search orders" placeholder="Search order, customer, email…" value={search} onChange={event=>query('q',event.target.value)} /></label><div className="admin-filters"><label>Sort by<select aria-label="Sort orders" value={sort} onChange={event=>setSort(event.target.value)}><option value="newest">Date (newest first)</option><option value="name">Customer name</option><option value="product">Product name</option><option value="delivery">Delivery date</option><option value="total">Highest total</option></select></label>{(search || status!=='all') && <button className="admin-button" onClick={()=>setParams({})}>Clear filters</button>}</div></div>
      {loading ? <p className="admin-empty" role="status">Loading orders…</p> : error ? <p className="admin-empty">Refresh to load the order list.</p> : !rows.length ? <p className="admin-empty">{orders.length ? 'No orders match these filters.' : 'Customer orders will appear here when they are placed.'}</p> :
        <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th scope="col">Order / customer</th>{showDate && <th scope="col">Date</th>}<th scope="col">Status</th><th scope="col">Total</th><th scope="col">Actions</th></tr></thead><tbody>{rows.map(order=><Fragment key={order._id}>
          <tr><td><Link className="admin-text-link" to={'/admin/orders/'+order._id}>#{order._id.slice(-8)} · {order.firstName} {order.lastName}</Link>{showEmail && <small>{order.email}</small>}<small>{order.product?.name || 'Product'}</small></td>{showDate && <td className="admin-numeric">{adminDate(order.createdAt)}</td>}<td><OrderStatus status={order.status} /></td><td className="admin-numeric">{adminMoney(order.totalPrice)}</td><td><button className="admin-button" aria-label={'Preview order '+order._id.slice(-8)} aria-expanded={expanded===order._id} aria-controls={'preview-'+order._id} onClick={()=>setExpanded(expanded===order._id?null:order._id)}>{expanded===order._id ? 'Close' : 'Preview'}</button></td></tr>
          {expanded===order._id && <tr id={'preview-'+order._id}><td colSpan={showDate ? 5 : 4}><div className="admin-order-preview"><h3>{order.product?.name || 'Order details'}</h3><dl><div><dt>Customer</dt><dd>{order.firstName} {order.lastName}<br />{order.email}</dd></div><div><dt>Expected delivery</dt><dd>{adminDate(order.deliveryDate)}</dd></div><div><dt>Quantity / configuration</dt><dd>{order.quantity} · {order.color || order.variants?.color || 'Standard'} {order.variants?.storage || ''}</dd></div></dl>
            {order.returnReason && <p>Return reason: {order.returnReason}</p>}
            {order.returnImage && <a href={import.meta.env.VITE_BACKEND_URL+'/uploads/'+order.returnImage} target="_blank" rel="noreferrer"><img src={import.meta.env.VITE_BACKEND_URL+'/uploads/'+order.returnImage} alt="Customer return evidence" /></a>}
            {order.status==='Pending' && <p className="admin-notice">Payment has not been verified yet. You can still force this order into the delivery pipeline below.</p>}
            <div className="admin-order-preview-actions"><Link className="admin-button admin-button--primary" to={'/admin/orders/'+order._id}>View full order</Link>
              {(deliveryStages.includes(order.status) || order.status==='Pending') && <label>Delivery status <select aria-label="Set delivery status" disabled={!!busy} value={deliveryStages.includes(order.status) ? order.status : ''} onChange={event=>void setDeliveryStatus(order,event.target.value)}>{order.status==='Pending' && <option value="" disabled>Pending (unpaid)</option>}{deliveryStages.map(stage=><option key={stage} value={stage}>{stage}</option>)}</select></label>}
              {['Pending','Confirmed'].includes(order.status) && <button className="admin-button admin-button--danger" disabled={!!busy} onClick={()=>void action(order,'cancel')}>Cancel order</button>}
              {order.status==='Return Requested' && <><button className="admin-button" disabled={!!busy} onClick={()=>void action(order,'approve')}>Approve return</button><button className="admin-button admin-button--danger" disabled={!!busy} onClick={()=>void action(order,'reject')}>Reject return</button></>}
              {order.status==='Return Approved' && <button className="admin-button" disabled={!!busy} onClick={()=>void action(order,'refund')}>Release refund · {adminMoney(order.totalPrice)}</button>}
              {busy===order._id && <span role="status">Updating order…</span>}
            </div>
          </div></td></tr>}
        </Fragment>)}</tbody></table></div>}
      {!loading && !error && rows.length>0 && <AdminPagination page={currentPage} pages={pages} onPage={setPage} />}
    </section>
  </main>;
}
