import { useCallback, useEffect, useState } from 'react';
import { CheckCircle, Mail, Phone, RefreshCw, Store } from 'lucide-react';
import { AdminHeading } from '../components/admin/AdminUi';
import { Button } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { ErrorState, LoadingState } from '../components/ui/AsyncState';
import { Field } from '../components/ui/Field';
import { authFetch } from '../lib/session';

interface Seller { _id: string; id?: string; shopName: string; email: string; phone?: string; createdAt: string; verificationRequestDate?: string }
const fieldClass = 'w-full rounded-[var(--radius-control)] border border-hairline bg-paper px-4 py-3 text-ink focus:border-brass';

export default function AdminSellerApproval() {
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<Seller | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');

  const load = useCallback(async () => { setLoading(true); setError(''); try { const response = await authFetch(`${import.meta.env.VITE_BACKEND_URL}/api/v1/auth/unverified-sellers`); if (!response.ok) throw new Error('Could not load seller applications.'); const data = await response.json(); const rows = Array.isArray(data) ? data : data.sellers || []; setSellers(rows.map((seller: Seller) => ({ ...seller, _id: seller._id || seller.id || '' }))); } catch (reasonValue) { setError(reasonValue instanceof Error ? reasonValue.message : 'Could not load seller applications.'); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  const request = async (seller: Seller, action: 'approve' | 'reject') => { if (action === 'reject' && reason.trim().length < 20) { setReasonError('Give the seller a clear reason of at least 20 characters.'); return; } setProcessingId(seller._id); setError(''); try { const response = await authFetch(`${import.meta.env.VITE_BACKEND_URL}/api/v1/auth/${action === 'approve' ? 'verify' : 'reject'}-seller/${seller._id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: action === 'reject' ? JSON.stringify({ reason: reason.trim() }) : undefined }); if (!response.ok) { let message = `Could not ${action} this seller.`; try { const body = await response.json(); message = body.message || message; } catch {} throw new Error(message); } setSellers(previous => previous.filter(item => item._id !== seller._id)); setRejecting(null); setReason(''); } catch (reasonValue) { setError(reasonValue instanceof Error ? reasonValue.message : `Could not ${action} this seller.`); } finally { setProcessingId(null); } };
  const date = (value: string) => new Date(value).toLocaleDateString('en-NP', { year: 'numeric', month: 'short', day: 'numeric' });

  return <main>
    <AdminHeading title="Seller verification" description="Review pending seller applications and explain every rejection."><button className="admin-button" disabled={loading || !!processingId} onClick={() => void load()}><RefreshCw size={14} aria-hidden="true" />Refresh</button></AdminHeading>
    {error && <p className="admin-notice" role="alert">{error}</p>}
    {loading ? <LoadingState description="Loading seller applications…" /> : error && !sellers.length ? <ErrorState title="Applications are unavailable" description={error} action={<Button onClick={() => void load()}>Try again</Button>} /> : !sellers.length ? <section className="admin-panel p-10 text-center" role="status"><CheckCircle className="mx-auto h-12 w-12 text-moss" aria-hidden="true" /><h2 className="mt-4 text-xl font-semibold text-ink">No pending applications</h2><p className="mt-2 text-sm text-ink-muted">New seller applications will appear here for review.</p></section> : <section className="admin-panel" aria-label="Pending seller applications">
      <div className="admin-table-wrap admin-desktop-table"><table className="admin-table"><thead><tr><th scope="col">Shop</th><th scope="col">Contact</th><th scope="col">Applied</th><th scope="col">Actions</th></tr></thead><tbody>{sellers.map(seller => <tr key={seller._id}><td><strong>{seller.shopName}</strong></td><td><span className="flex items-center gap-2"><Mail size={14} aria-hidden="true" />{seller.email}</span><small><Phone size={12} className="inline" aria-hidden="true" /> {seller.phone || 'No phone provided'}</small></td><td>{date(seller.verificationRequestDate || seller.createdAt)}</td><td><div className="flex gap-2"><button className="admin-button admin-button--primary" disabled={!!processingId} onClick={() => void request(seller, 'approve')}>Approve</button><button className="admin-button admin-button--danger" disabled={!!processingId} onClick={() => { setRejecting(seller); setReason(''); setReasonError(''); }}>Reject</button></div></td></tr>)}</tbody></table></div>
      <div className="admin-mobile-cards">{sellers.map(seller => <article className="admin-mobile-card" key={seller._id}><div className="admin-mobile-card-head"><span className="flex h-12 w-12 items-center justify-center border border-hairline"><Store aria-hidden="true" /></span><div><h2 className="font-semibold text-ink">{seller.shopName}</h2><p className="text-xs text-ink-muted">{seller.email}</p></div></div><dl><div><dt>Phone</dt><dd>{seller.phone || 'Not provided'}</dd></div><div><dt>Applied</dt><dd>{date(seller.verificationRequestDate || seller.createdAt)}</dd></div></dl><div className="admin-mobile-card-actions"><button className="admin-button admin-button--primary" disabled={!!processingId} onClick={() => void request(seller, 'approve')}>Approve</button><button className="admin-button admin-button--danger" disabled={!!processingId} onClick={() => { setRejecting(seller); setReason(''); setReasonError(''); }}>Reject</button></div></article>)}</div>
    </section>}
    <Dialog open={!!rejecting} title={`Reject ${rejecting?.shopName || 'seller'}?`} description="This reason is sent to the seller and stored with the review." onClose={() => { if (!processingId) setRejecting(null); }} footer={<><Button variant="quiet" disabled={!!processingId} onClick={() => setRejecting(null)}>Keep application</Button><Button variant="danger" loading={processingId === rejecting?._id} disabled={reason.trim().length < 20} onClick={() => rejecting && void request(rejecting, 'reject')}>Reject seller</Button></>}>
      <Field id="rejection-reason" label="Reason for rejection" required hint={`${reason.trim().length}/20 minimum characters`} error={reasonError}><textarea id="rejection-reason" data-autofocus rows={5} value={reason} onChange={event => { setReason(event.target.value); setReasonError(''); }} aria-invalid={!!reasonError} aria-describedby={reasonError ? 'rejection-reason-error' : 'rejection-reason-hint'} className={fieldClass} placeholder="Explain what must be corrected before reapplying." /></Field>
    </Dialog>
  </main>;
}
