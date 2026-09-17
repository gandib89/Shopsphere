import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Link2, ShieldCheck, Unplug } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { authFetch } from '../lib/session';

type Client = {
  id: string;
  name: string;
  role: string;
  availableScopes: string[];
  retentionNotice: string;
};

type Connection = {
  id: string;
  clientId: string;
  clientName: string;
  scopes: string[];
  retentionNotice: string;
};

const API = import.meta.env.VITE_BACKEND_URL || '';

const scopeLabels: Record<string, string> = {
  'profile:read': 'Profile summary',
  'notifications:read': 'Notifications',
  'catalog:read': 'Permitted catalog data',
  'orders:read': 'Permitted order history',
  'cart:read': 'Cart and checkout previews',
};

export default function AiConnections() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [clients, setClients] = useState<Client[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useMemo(() => ({
    clientId: params.get('client_id') ?? '',
    redirectUri: params.get('redirect_uri') ?? '',
    codeChallenge: params.get('code_challenge') ?? '',
    state: params.get('state') ?? '',
  }), [params]);
  const hasAuthorizationRequest = Object.values(request).every(Boolean);

  const load = async () => {
    const [catalogResponse, connectionsResponse] = await Promise.all([
      authFetch(`${API}/api/v1/ai-connections/catalog`),
      authFetch(`${API}/api/v1/ai-connections`),
    ]);
    if (!catalogResponse.ok || !connectionsResponse.ok) throw new Error('AI connection service is unavailable');
    const catalog = await catalogResponse.json();
    const active = await connectionsResponse.json();
    setClients(catalog.clients);
    setConnections(active.connections);
    if (catalog.clients[0]) setSelected(catalog.clients[0].availableScopes);
  };

  useEffect(() => { load().catch((reason) => setError(reason.message)); }, []);

  const connect = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await authFetch(`${API}/api/v1/ai-connections`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...request, scopes: selected, currentPassword: password }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || 'Could not start connection');
      window.location.assign(body.authorizationUrl);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not start connection');
      setBusy(false);
    }
  };

  const revoke = async (clientId: string) => {
    setBusy(true);
    setError('');
    const response = await authFetch(`${API}/api/v1/ai-connections/${encodeURIComponent(clientId)}`, { method: 'DELETE' });
    if (response.ok) setConnections((current) => current.filter((connection) => connection.clientId !== clientId));
    else setError('Could not revoke this connection');
    setBusy(false);
  };

  const requestedClient = request.clientId
    ? clients.find((client) => client.id === request.clientId)
    : clients[0];

  return (
    <main className="min-h-screen bg-paper text-ink">
      <header className="border-b border-brass/40 bg-ink text-paper">
        <div className="container mx-auto max-w-3xl px-4 py-8 sm:px-6">
          <button type="button" onClick={() => navigate(-1)} className="mb-5 flex min-h-11 items-center gap-2 text-sm text-paper/80 transition hover:text-brass focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brass">
            <ArrowLeft aria-hidden="true" className="h-4 w-4" /> Back
          </button>
          <p className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-brass">Account security</p>
          <h1 className="font-display text-3xl font-bold sm:text-4xl">AI connections</h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-paper/70">Choose exactly what an approved AI client may read, and revoke access whenever you want.</p>
        </div>
      </header>

      <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
        {error && <div role="alert" className="border border-red-700 bg-red-50 p-4 text-sm text-red-800">{error}</div>}

        <section aria-labelledby="active-connections" className="border border-hairline bg-paper-raised p-6">
          <div className="mb-5 flex items-center gap-3">
            <ShieldCheck aria-hidden="true" className="h-6 w-6 text-moss" />
            <h2 id="active-connections" className="text-xl font-bold">Active connections</h2>
          </div>
          {connections.length === 0 ? <p className="text-ink-muted">No AI clients currently have access.</p> : connections.map((connection) => (
            <article key={connection.id} className="border-t border-hairline py-5 first:border-t-0 first:pt-0">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="font-semibold">{connection.clientName}</h3>
                  <p className="mt-1 text-sm text-ink-muted">{connection.scopes.map((scope) => scopeLabels[scope] ?? scope).join(' · ')}</p>
                </div>
                <button type="button" disabled={busy} onClick={() => revoke(connection.clientId)} className="flex min-h-11 items-center justify-center gap-2 border border-red-700 px-4 text-sm font-semibold text-red-700 transition hover:bg-red-700 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:opacity-50">
                  <Unplug aria-hidden="true" className="h-4 w-4" /> Revoke
                </button>
              </div>
            </article>
          ))}
        </section>

        <section aria-labelledby="connect-client" className="border border-hairline bg-paper-raised p-6">
          <div className="mb-5 flex items-center gap-3">
            <Link2 aria-hidden="true" className="h-6 w-6 text-brass" />
            <h2 id="connect-client" className="text-xl font-bold">Connect a client</h2>
          </div>
          {!hasAuthorizationRequest ? (
            <p className="leading-7 text-ink-muted">Start the connection from an approved AI client. ShopSphere will bring you back here to inspect its identity and requested access before consent.</p>
          ) : requestedClient ? (
            <form onSubmit={connect} className="space-y-5">
              <div>
                <p className="font-semibold">{requestedClient.name}</p>
                <p className="mt-1 text-sm text-ink-muted">Role for this connection: <strong className="text-ink">{requestedClient.role}</strong>. Roles are not combined.</p>
              </div>
              <fieldset>
                <legend className="mb-3 text-sm font-semibold">Select access</legend>
                <div className="space-y-2">
                  {requestedClient.availableScopes.map((scope) => (
                    <label key={scope} className="flex min-h-11 cursor-pointer items-center gap-3 border border-hairline px-4 py-3 focus-within:border-ink">
                      <input type="checkbox" checked={selected.includes(scope)} onChange={() => setSelected((current) => current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope])} />
                      <span>{scopeLabels[scope] ?? scope}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="border-l-4 border-brass bg-brass/10 p-4 text-sm leading-6">{requestedClient.retentionNotice}</div>
              <div>
                <label htmlFor="connection-password" className="mb-2 block text-sm font-semibold">Current ShopSphere password</label>
                <input id="connection-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required className="min-h-11 w-full border border-hairline bg-paper px-3 focus:border-ink focus:outline-none" />
                <p className="mt-2 text-xs text-ink-muted">Used by ShopSphere to confirm it is you. It is never sent to the AI client.</p>
              </div>
              <button type="submit" disabled={busy || selected.length === 0} className="min-h-11 w-full bg-ink px-5 font-semibold text-paper transition hover:bg-brass-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50">
                {busy ? 'Preparing secure consent…' : 'Continue to secure consent'}
              </button>
            </form>
          ) : <p role="alert" className="text-red-700">This AI client is not approved.</p>}
        </section>
      </div>
    </main>
  );
}
