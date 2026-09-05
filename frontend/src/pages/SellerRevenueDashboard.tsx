import { useCallback, useEffect, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { RefreshCw } from 'lucide-react';
import { authFetch } from '../lib/session';
import { AdminHeading } from '../components/admin/AdminUi';
import { adminMoney } from '../lib/adminData';

type MonthRow = { month: string; totalSalePrice: number; sellerRevenue: number; orderCount: number };
type Totals = { totalSalePrice: number; totalAdminCommission: number; totalSellerRevenue: number; totalOrders: number };

// Month keys arrive as "2026-03"; show them the way the rest of the workspace shows dates.
const monthLabel = (key: string) => {
  const [year, month] = key.split('-').map(Number);
  return Number.isFinite(year) && Number.isFinite(month) ? new Date(year, month - 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : key;
};

export default function SellerRevenueDashboard() {
  const [totals, setTotals] = useState<Totals | null>(null);
  const [months, setMonths] = useState<MonthRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError('');
    try {
      const response = await authFetch(`${import.meta.env.VITE_BACKEND_URL}/api/v1/revenue/seller/total`, { signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Could not load your revenue.');
      if (signal?.aborted) return;
      setTotals(data.totals ?? null);
      setMonths(Object.entries(data.monthlyBreakdown || {}).map(([month, row]) => ({ month, ...(row as Omit<MonthRow, 'month'>) })).sort((a, b) => a.month.localeCompare(b.month)));
    } catch (err) { if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Could not load your revenue.'); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, []);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);

  const available = !loading && !!totals;
  return <main>
    <AdminHeading title="Analytics" description="Settled sales, commission, and what you have earned.">
      <button className="admin-button" disabled={loading} onClick={() => void load()}><RefreshCw size={14} aria-hidden="true" />{loading ? 'Refreshing…' : 'Refresh'}</button>
    </AdminHeading>
    {error && <p className="admin-notice" role="alert">{error}</p>}
    <section className="admin-panel" aria-labelledby="seller-earnings-title">
      <div className="admin-panel-head"><div><h2 id="seller-earnings-title">Earnings</h2><p>Delivered orders only · all time</p></div></div>
      <div className="admin-stats" aria-busy={loading}>
        <div className="admin-stat"><span>Total sales</span><strong>{available ? adminMoney(totals!.totalSalePrice) : '—'}</strong><small>{available ? `${totals!.totalOrders} settled order${totals!.totalOrders === 1 ? '' : 's'}` : 'Settled order value'}</small></div>
        <div className="admin-stat"><span>Marketplace commission</span><strong>{available ? adminMoney(totals!.totalAdminCommission) : '—'}</strong><small>5% of each settled sale</small></div>
        <div className="admin-stat"><span>Your revenue</span><strong>{available ? adminMoney(totals!.totalSellerRevenue) : '—'}</strong><small>What is left after commission</small></div>
      </div>
    </section>
    <section className="admin-panel" aria-labelledby="seller-trend-title">
      <div className="admin-panel-head"><h2 id="seller-trend-title">Monthly trend</h2></div>
      {loading ? <p className="admin-empty" role="status">Loading revenue…</p> : months.length === 0 ? <p className="admin-empty">Revenue appears here once your first order is delivered.</p> :
        <div className="admin-chart"><ResponsiveContainer width="100%" height={300}>
          <LineChart data={months.map(row => ({ ...row, label: monthLabel(row.month) }))}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--color-line))" />
            <XAxis dataKey="label" stroke="rgb(var(--color-muted))" tick={{ fontSize: 12 }} />
            <YAxis stroke="rgb(var(--color-muted))" tick={{ fontSize: 12 }} width={80} />
            <Tooltip formatter={(value) => adminMoney(Number(value))} contentStyle={{ background: 'rgb(var(--color-surface))', border: '1px solid rgb(var(--color-line))', borderRadius: 'var(--radius-control)', fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="totalSalePrice" name="Total sales" stroke="rgb(var(--color-muted))" strokeWidth={2} />
            <Line type="monotone" dataKey="sellerRevenue" name="Your revenue" stroke="rgb(var(--color-brand))" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer></div>}
    </section>
    <section className="admin-panel" aria-labelledby="seller-months-title">
      <div className="admin-panel-head"><h2 id="seller-months-title">Monthly breakdown</h2></div>
      {loading ? <p className="admin-empty" role="status">Loading revenue…</p> : months.length === 0 ? <p className="admin-empty">No settled sales yet.</p> :
        <div className="admin-table-wrap"><table className="admin-table">
          <thead><tr><th scope="col">Month</th><th scope="col">Orders</th><th scope="col">Total sales</th><th scope="col">Your revenue</th></tr></thead>
          <tbody>{[...months].reverse().map(row => <tr key={row.month}>
            <td>{monthLabel(row.month)}</td>
            <td className="admin-numeric">{row.orderCount}</td>
            <td className="admin-numeric">{adminMoney(row.totalSalePrice)}</td>
            <td className="admin-numeric">{adminMoney(row.sellerRevenue)}</td>
          </tr>)}</tbody>
        </table></div>}
    </section>
  </main>;
}
