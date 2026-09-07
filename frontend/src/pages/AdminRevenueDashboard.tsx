import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3, RefreshCw } from 'lucide-react';
import { AdminEmptyState, AdminHeading } from '../components/admin/AdminUi';
import { ErrorState, LoadingState } from '../components/ui/AsyncState';
import { Button } from '../components/ui/Button';
import { authFetch } from '../lib/session';

interface MonthData { month: string; totalSalePrice: number; adminCommission: number; orderCount: number }
interface RevenueSummary { totals: { totalSalePrice: number; totalAdminCommission: number; totalSellerRevenue: number; totalOrders: number }; monthlyBreakdown: Record<string, Omit<MonthData, 'month'>> }

export default function AdminRevenueDashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revenue, setRevenue] = useState<RevenueSummary | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await authFetch(`${import.meta.env.VITE_BACKEND_URL}/api/v1/revenue/admin/total`);
      if (!response.ok) { let message = 'Could not load revenue data.'; try { const body = await response.json(); message = body.message || message; } catch {} throw new Error(message); }
      setRevenue(await response.json());
    } catch (reason) { setRevenue(null); setError(reason instanceof Error ? reason.message : 'Could not load revenue data.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const months: MonthData[] = Object.entries(revenue?.monthlyBreakdown || {}).map(([month, values]) => ({ month, ...values }));

  return <main>
    <AdminHeading title="Revenue" description="Verified platform sales, commission, and estimated seller share."><button className="admin-button" disabled={loading} onClick={() => void load()}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} aria-hidden="true" />Refresh</button></AdminHeading>
    {loading ? <LoadingState description="Loading revenue data…" /> : error ? <ErrorState title="Revenue data is unavailable" description={error} action={<Button onClick={() => void load()}>Try again</Button>} /> : revenue && <>
      <section className="admin-stats" aria-label="Revenue summary"><div className="admin-stat"><span>Verified platform sales</span><strong>रु {revenue.totals.totalSalePrice.toLocaleString()}</strong><small>{revenue.totals.totalOrders} paid orders</small></div><div className="admin-stat"><span>Platform commission (5%)</span><strong>रु {revenue.totals.totalAdminCommission.toLocaleString()}</strong><small>Calculated from verified sales</small></div><div className="admin-stat"><span>Estimated seller share (95%)</span><strong>रु {revenue.totals.totalSellerRevenue.toLocaleString()}</strong><small>Calculated share; this does not mean a payout was sent</small></div></section>
      {months.length ? <div className="admin-home-columns mt-6">
        <section className="admin-panel p-5" aria-labelledby="sales-trend-title"><h2 id="sales-trend-title" className="text-lg font-semibold text-ink">Monthly sales trend</h2><p className="mt-1 text-sm text-ink-muted">Verified sales and platform commission by month.</p><div className="mt-5" role="img" aria-label="Line chart of monthly verified sales and commission"><ResponsiveContainer width="100%" height={300}><LineChart data={months}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis /><Tooltip formatter={value => `रु ${Number(value).toLocaleString()}`} /><Line type="monotone" dataKey="totalSalePrice" stroke="#0F766E" name="Verified sales" strokeWidth={2} /><Line type="monotone" dataKey="adminCommission" stroke="#9A6A23" name="Commission" strokeWidth={2} /></LineChart></ResponsiveContainer></div></section>
        <section className="admin-panel" aria-labelledby="monthly-data-title"><div className="admin-panel-head"><div><h2 id="monthly-data-title">Monthly values</h2><p>Accessible source data for the chart</p></div></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th scope="col">Month</th><th scope="col">Orders</th><th scope="col">Sales</th><th scope="col">Commission</th></tr></thead><tbody>{months.map(month => <tr key={month.month}><td>{month.month}</td><td>{month.orderCount}</td><td>रु {month.totalSalePrice.toLocaleString()}</td><td>रु {month.adminCommission.toLocaleString()}</td></tr>)}</tbody></table></div></section>
      </div> : <section className="admin-panel mt-6"><AdminEmptyState icon={<BarChart3 />} title="No verified revenue yet" description="Monthly sales and commission will appear after the first paid order is verified." action={<Link className="admin-button admin-button--primary" to="/admin/orders">Review orders</Link>} /></section>}
    </>}
  </main>;
}
