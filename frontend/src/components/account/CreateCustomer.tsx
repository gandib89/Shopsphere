import { useRef, useState, type FormEvent } from 'react';
import { authFetch } from '../../lib/session';
import './account.css';

export default function CreateCustomer({ onCancel, onCreated }: { onCancel: () => void; onCreated: () => void }) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending.current) return;
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    pending.current = true;
    setBusy(true); setError('');
    try {
      const response = await authFetch(`${import.meta.env.VITE_BACKEND_URL}/api/v1/users/customers`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Could not create customer.');
      onCreated();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not create customer. Please try again.'); }
    finally { pending.current = false; setBusy(false); }
  };
  return <section className="admin-panel" aria-label="Create customer">
    <div className="admin-panel-head"><div><h2>Create a customer</h2><p>Add a customer account with access to shopping and order history.</p></div></div>
    <form className="account-form account-create" onSubmit={submit} aria-busy={busy}>
      <fieldset disabled={busy} className="account-form-grid">
        <label>First name<input name="firstName" required maxLength={100} autoFocus autoComplete="given-name" /></label>
        <label>Last name<input name="lastName" required maxLength={100} autoComplete="family-name" /></label>
        <label>Email<input name="email" type="email" required maxLength={254} autoComplete="email" /></label>
        <label>Phone (optional)<input name="phone" type="tel" maxLength={30} autoComplete="tel" /></label>
        <label className="account-full">Initial password<input name="password" type="password" required minLength={8} maxLength={128} autoComplete="new-password" /><small>At least 8 characters. Share it with the customer securely.</small></label>
      </fieldset>
      {error && <p className="account-error" role="alert">{error}</p>}
      <div className="account-actions"><button className="admin-button admin-button--primary" disabled={busy}>{busy ? 'Creating customer…' : 'Create customer'}</button><button type="button" className="admin-button" disabled={busy} onClick={onCancel}>Cancel</button></div>
    </form>
  </section>;
}
