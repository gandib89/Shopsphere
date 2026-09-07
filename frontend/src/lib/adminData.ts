import { authFetch } from './session';

export type AdminOrder = {
  _id: string; firstName: string; lastName: string; email: string;
  quantity: number; totalPrice: number; status: string; createdAt?: string; deliveryDate?: string;
  product?: { name: string }; color?: string; variants?: { color?: string; storage?: string };
  returnReason?: string; returnImage?: string; refundReleasedAt?: string;
  payments?: { id: string; status: string }[];
  refunds?: { id: string; status: string; mode: string }[];
};

// Follow the API's pagination so filters and dashboard totals aren't silently capped.
export async function getAdminCollection<T>(path: string, signal?: AbortSignal): Promise<T[]> {
  const result: T[] = [];
  let page = 1;
  while (true) {
    const separator = path.includes('?') ? '&' : '?';
    const response = await authFetch(`${import.meta.env.VITE_BACKEND_URL}${path}${separator}page=${page}&limit=200`, { signal });
    if (!response.ok) throw new Error(response.status === 401 ? 'Your session has expired. Please sign in again.' : 'Could not load this information. Please try again.');
    const body = await response.json();
    const rows = Array.isArray(body) ? body : body.items ?? body.data ?? body.sellers;
    if (!Array.isArray(rows)) throw new Error('The server returned an unexpected response. Please try again.');
    result.push(...rows);
    if (Array.isArray(body) || typeof body.total !== 'number' || result.length >= body.total) return result;
    if (!rows.length) throw new Error('The list changed while loading. Refresh to try again.');
    page += 1;
  }
}

export const adminMoney = (value: number) => `NPR ${Number(value || 0).toLocaleString('en-NP', { maximumFractionDigits: 2 })}`;
export const adminDate = (value?: string) => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
export const activeOrder = (order: AdminOrder) => ['pending', 'confirmed', 'processing', 'shipped'].includes(order.status.toLowerCase());
export const orderTone = (status: string) => /^(delivered|refund released)$/i.test(status) ? 'success' : /^(cancelled|return rejected)$/i.test(status) ? 'muted' : /return|pending/i.test(status) ? 'attention' : 'info';
