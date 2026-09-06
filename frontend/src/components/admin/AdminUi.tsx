import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { orderTone } from '../../lib/adminData';

export function AdminHeading({ title, description, eyebrow, children }: { title: string; description?: string; eyebrow?: string; children?: ReactNode }) {
  return <header className="admin-page-heading"><div>{eyebrow && <span className="admin-page-eyebrow">{eyebrow}</span>}<h1>{title}</h1>{description && <p>{description}</p>}</div><div className="admin-heading-actions">{children}</div></header>;
}
export function OrderStatus({ status }: { status: string }) { return <span className={`admin-status admin-status--${orderTone(status)}`}>{status || 'Unknown'}</span>; }
export function AdminPagination({ page, pages, onPage }: { page: number; pages: number; onPage: (page: number) => void }) {
  return <nav className="admin-pagination" aria-label="List pagination"><span>Page {page} of {Math.max(1, pages)}</span><button className="admin-button" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft size={16} /></button><button className="admin-button" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight size={16} /></button></nav>;
}
