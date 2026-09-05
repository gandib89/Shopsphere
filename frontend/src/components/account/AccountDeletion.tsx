import { useState, type FormEvent } from 'react';
import { GoogleLogin } from '@react-oauth/google';
import { useNavigate } from 'react-router-dom';
import { authFetch, clearSession } from '../../lib/session';
import './account.css';

type Props = { sellerId?: string; name: string; hasPassword?: boolean; googleLinked?: boolean };

export default function AccountDeletion({ sellerId, name, hasPassword = true, googleLinked = false }: Props) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [password, setPassword] = useState('');
  const [googleToken, setGoogleToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ready = confirmation === 'DELETE' && (!!sellerId || (!!password && hasPassword) || !!googleToken);
  const remove = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true); setError('');
    try {
      const response = await authFetch(`${import.meta.env.VITE_BACKEND_URL}/api/v1/${sellerId ? `users/sellers/${encodeURIComponent(sellerId)}` : 'auth/account'}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation, ...(sellerId ? {} : googleToken ? { googleToken } : { password }) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Could not delete the account. Please try again.');
      if (!sellerId) clearSession();
      navigate(sellerId ? '/admin/sellers' : '/auth', { replace: true });
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not delete the account.'); }
    finally { setBusy(false); }
  };
  return <section className="account-danger" aria-label="Permanent account deletion">
    <h2>{sellerId ? 'Delete seller account' : 'Delete your account'}</h2>
    <p>Permanently remove {sellerId ? name : 'your account'}, profile, reviews, cart, and sign-in access. Seller listings are withdrawn. This cannot be undone.</p>
    <p>Anonymized order and payment records remain for transaction history. Unfinished orders and returns must be resolved first.</p>
    {!open ? <button className="account-delete-button" onClick={() => setOpen(true)}>Delete account permanently</button> :
      <form onSubmit={remove} className="account-form" aria-busy={busy}>
        {!sellerId && hasPassword && <label>Current password<input type="password" autoComplete="current-password" value={password} disabled={busy} onChange={event => { setPassword(event.target.value); setGoogleToken(''); }} /></label>}
        {!sellerId && googleLinked && <div><p>Confirm with the Google account linked to this profile.</p><GoogleLogin onSuccess={response => { setGoogleToken(response.credential || ''); setPassword(''); setError(''); }} onError={() => setError('Google verification failed. Please try again.')} />{googleToken && <p role="status">Google credentials received. Confirm deletion below.</p>}</div>}
        <label>Type DELETE to confirm<input autoFocus value={confirmation} disabled={busy} autoComplete="off" spellCheck={false} onChange={event => setConfirmation(event.target.value)} /></label>
        {error && <p className="account-error" role="alert">{error}</p>}
        <div className="account-actions"><button className="account-delete-button" disabled={!ready || busy} type="submit">{busy ? 'Deleting account…' : 'Confirm permanent deletion'}</button><button className="account-cancel" type="button" disabled={busy} onClick={() => { setOpen(false); setPassword(''); setGoogleToken(''); setConfirmation(''); setError(''); }}>Cancel</button></div>
      </form>}
  </section>;
}
