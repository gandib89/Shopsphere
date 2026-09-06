import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronDown, Search, Store } from 'lucide-react';
import { sellerName, useAdminSellerResource, type SellerList } from '../../lib/adminSellers';

function SellerResults({ selectedId, view, onSelect }: { selectedId?: string; view: string; onSelect: () => void }) {
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useAdminSellerResource<SellerList>('?' + new URLSearchParams({ q: query, page: String(page), limit: '10' }));
  return <div className="admin-seller-results" id="admin-seller-results">
    <form onSubmit={event => { event.preventDefault(); setQuery(draft.trim()); setPage(1); }} className="admin-seller-switch-search">
      <input autoFocus type="search" aria-label="Find a seller" placeholder="Find a seller…" value={draft} onChange={event => setDraft(event.target.value)} />
      <button type="submit" aria-label="Search sellers in menu"><Search size={16} aria-hidden="true" /></button>
    </form>
    {loading ? <p role="status">Loading sellers…</p> : error ? <div role="alert"><p>Could not load sellers.</p><button className="admin-text-link" onClick={reload}>Try again</button></div> : <>
      {!data?.items?.length ? <p role="status">{query ? 'No matching sellers. Try another search.' : 'No sellers yet.'}</p> : <ul className="admin-seller-options">
        {data.items.map(seller => <li key={seller.id}><Link to={`/admin/sellers/${encodeURIComponent(seller.id)}?view=${view}`} onClick={onSelect} className={selectedId === seller.id ? 'is-selected' : undefined} aria-current={selectedId === seller.id ? 'page' : undefined}>
          <span className="admin-seller-avatar" aria-hidden="true">{sellerName(seller).slice(0, 1).toUpperCase()}</span>
          <span className="admin-seller-option-copy"><strong>{sellerName(seller)}</strong><small>{[seller.firstName, seller.lastName].filter(Boolean).join(' ') || seller.email}</small></span>
          {selectedId === seller.id && <Check size={14} aria-hidden="true" />}
        </Link></li>)}
      </ul>}
      {data && data.total > data.pageSize && <div className="admin-seller-pages"><button disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous</button><span>{page} / {Math.ceil(data.total / data.pageSize)}</span><button disabled={page * data.pageSize >= data.total} onClick={() => setPage(value => value + 1)}>Next</button></div>}
    </>}
  </div>;
}

export default function AdminSellerSwitcher({ selectedId, view, onSelect, onOpen }: { selectedId?: string; view: string; onSelect: () => void; onOpen: () => void }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return <div className="admin-seller-switcher" onKeyDown={event => { if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false); trigger.current?.focus(); } }}>
    <button ref={trigger} className="admin-seller-switch-trigger" aria-label={selectedId ? 'Switch seller' : 'Open seller'} title={selectedId ? 'Switch seller' : 'Open seller'} aria-expanded={open} aria-controls={open ? 'admin-seller-results' : undefined} onClick={() => { onOpen(); setOpen(value => !value); }}><Store size={16} aria-hidden="true" /><span>{selectedId ? 'Switch seller' : 'Open seller'}</span><ChevronDown size={14} aria-hidden="true" /></button>
    {open && <SellerResults selectedId={selectedId} view={view} onSelect={() => { setOpen(false); trigger.current?.focus(); onSelect(); }} />}
  </div>;
}

