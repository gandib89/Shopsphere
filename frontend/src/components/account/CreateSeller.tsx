import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { authFetch } from '../../lib/session';
import './account.css';

export default function CreateSeller({ onCancel }: { onCancel: () => void }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget);
    const body = Object.fromEntries(fields.entries());
    setBusy(true); setError('');
    try {
      const response = await authFetch(`${import.meta.env.VITE_BACKEND_URL}/api/v1/users/sellers`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, isVerified: fields.get('isVerified') === 'on' }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Could not create seller.');
      navigate(`/admin/sellers/${data.seller.id}`);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not create seller. Please try again.'); }
    finally { setBusy(false); }
  };
  return <section className="admin-panel" aria-label="Create seller">
    <div className="admin-panel-head"><div><h2>Create a seller</h2><p>Add the shop owner’s details and choose whether the shop can start selling.</p></div></div>
    <form className="account-form account-create" onSubmit={submit} aria-busy={busy}>
      <fieldset disabled={busy} className="account-form-grid">
        <label>First name<input name="firstName" required maxLength={100} autoFocus autoComplete="given-name" /></label>
        <label>Last name<input name="lastName" required maxLength={100} autoComplete="family-name" /></label>
        <label>Email<input name="email" type="email" required maxLength={254} autoComplete="email" /></label>
        <label>Phone (optional)<input name="phone" type="tel" maxLength={30} autoComplete="tel" /></label>
        <label>Shop name<input name="shopName" required maxLength={150} /></label>
        <label>Initial password<input name="password" type="password" required minLength={8} maxLength={128} autoComplete="new-password" /><small>At least 8 characters. Share it with the owner securely.</small></label>
        <label className="account-full">Shop description (optional)<textarea name="shopDescription" maxLength={2000} rows={3} /></label>
        <label className="account-check account-full"><input name="isVerified" type="checkbox" />Approve this seller immediately</label>
      </fieldset>
      <p>Unapproved sellers can prepare listings; their shop stays pending until approved.</p>
      {error && <p className="account-error" role="alert">{error}</p>}
      <div className="account-actions"><button className="admin-button admin-button--primary" disabled={busy}>{busy ? 'Creating seller…' : 'Create seller'}</button><button type="button" className="admin-button" disabled={busy} onClick={onCancel}>Cancel</button></div>
    </form>
  </section>;
}
