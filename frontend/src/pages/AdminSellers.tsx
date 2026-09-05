import CreateSeller from '../components/account/CreateSeller';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { RefreshCw, Search } from 'lucide-react';
import { AdminHeading, AdminPagination } from '../components/admin/AdminUi';
import { adminDate } from '../lib/adminData';
import { sellerName, sellerStatus, useAdminSellerResource, type SellerList } from '../lib/adminSellers';

export default function AdminSellers() {
  const [creating, setCreating] = useState(false);
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const status = ['verified', 'unverified'].includes(params.get('status') || '') ? params.get('status')! : 'all';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);
  const query = new URLSearchParams({ q, status, page: String(page), limit: '20' });
  const { data, error, loading, reload } = useAdminSellerResource<SellerList>('?' + query);
  const update = (values: Record<string, string>) => setParams({ q, status, page: '1', ...values });
  return <main>
    <AdminHeading title="Sellers" description="Find a shop and open its account, products, and orders."><button className="admin-button" disabled={loading} onClick={reload}><RefreshCw size={14} aria-hidden="true" />Refresh</button><Link className="admin-button" to="/admin/seller-approvals">Review applications</Link><button className="admin-button admin-button--primary" onClick={() => setCreating(true)}>Add seller</button></AdminHeading>
    {creating && <CreateSeller onCancel={() => setCreating(false)} />}
    {error && <p role="alert" className="admin-notice">{error} <button className="admin-text-link" onClick={reload}>Try again</button></p>}
    <section className="admin-panel" aria-label="Seller directory">
      <div className="admin-toolbar">
        <form className="admin-seller-search" onSubmit={event => { event.preventDefault(); update({ q: draft.trim() }); }}><label className="admin-search"><Search size={15} aria-hidden="true" /><input type="search" aria-label="Search sellers" placeholder="Shop, owner, email, or phone…" value={draft} onChange={event => setDraft(event.target.value)} /></label><button className="admin-button" type="submit">Search</button></form>
        <div className="admin-filters"><label>Status<select aria-label="Filter sellers by status" value={status} onChange={event => update({ status: event.target.value })}><option value="all">All sellers</option><option value="verified">Verified</option><option value="unverified">Not verified</option></select></label>{(q || status !== 'all') && <button className="admin-button" onClick={() => { setDraft(''); setParams({}); }}>Clear filters</button>}</div>
      </div>
      {loading ? <p className="admin-empty" role="status">Loading sellers…</p> : error ? <p className="admin-empty">The seller directory is unavailable.</p> : !data?.items.length ? <p className="admin-empty">{q || status !== 'all' ? 'No sellers match these filters.' : 'Seller accounts will appear here once they register.'}</p> : <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th scope="col">Shop / owner</th><th scope="col">Contact</th><th scope="col">Status</th><th scope="col">Joined</th><th scope="col">Actions</th></tr></thead><tbody>{data.items.map(seller => <tr key={seller.id}><td><Link className="admin-text-link" to={'/admin/sellers/' + seller.id}>{sellerName(seller)}</Link><small>{seller.firstName} {seller.lastName}</small></td><td>{seller.email}<small>{seller.phone || 'No phone provided'}</small></td><td><span className={'admin-status admin-status--' + (seller.isVerified ? 'success' : 'attention')}>{sellerStatus(seller)}</span></td><td className="admin-numeric">{adminDate(seller.createdAt)}</td><td><Link className="admin-button" to={'/admin/sellers/' + seller.id} aria-label={'View seller ' + sellerName(seller)}>View seller</Link></td></tr>)}</tbody></table></div>}
      {data && !error && data.total > 0 && <AdminPagination page={page} pages={Math.ceil(data.total / data.pageSize)} onPage={value => update({ page: String(value) })} />}
    </section>
  </main>;
}
