import { ArrowLeft, Home, PackageSearch } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import NavBar from '../components/NavBar';
import OrbitMark from '../components/OrbitMark';

export default function NotFound() {
  const navigate = useNavigate();
  const hasSession = localStorage.getItem('token') === 'session';
  const dashboard = localStorage.getItem('isAdmin') === 'true'
    ? { to: '/admin', label: 'Open admin workspace' }
    : localStorage.getItem('isSeller') === 'true'
      ? { to: '/seller-panel', label: 'Open seller workspace' }
      : { to: '/my-orders', label: 'View my orders' };

  return <>
    <NavBar />
    <main className="container-store flex min-h-[70dvh] items-center justify-center py-16">
      <section className="w-full max-w-2xl rounded-[var(--radius-surface)] border border-hairline bg-paper-raised p-8 text-center shadow-sm sm:p-12" aria-labelledby="not-found-title">
        <OrbitMark size={52} className="mx-auto" />
        <p className="mt-6 font-mono text-xs font-semibold uppercase tracking-[0.2em] text-brass">Error 404</p>
        <h1 id="not-found-title" className="mt-3 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">We couldn’t find that page</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-ink-muted">The link may be outdated or the address may have been typed incorrectly.</p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Link to="/" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] bg-brass px-5 text-sm font-semibold text-white hover:bg-brass-dark"><Home className="h-4 w-4" aria-hidden="true" />Go home</Link>
          <Link to="/?browse=products" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] border border-hairline px-5 text-sm font-semibold text-ink hover:border-brass hover:text-brass"><PackageSearch className="h-4 w-4" aria-hidden="true" />Browse products</Link>
          {hasSession && <Link to={dashboard.to} className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-control)] border border-hairline px-5 text-sm font-semibold text-ink hover:border-brass hover:text-brass">{dashboard.label}</Link>}
        </div>
        <button type="button" onClick={() => navigate(-1)} className="mx-auto mt-6 inline-flex min-h-10 items-center gap-2 px-3 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Go back</button>
      </section>
    </main>
  </>;
}
