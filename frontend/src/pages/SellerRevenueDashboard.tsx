import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { RefreshCw } from 'lucide-react';
import axios from 'axios';
import { toast } from 'sonner';
import NavBar from '../components/NavBar';

interface MonthData {
  month: string;
  totalSalePrice: number;
  sellerRevenue: number;
  orderCount: number;
}

interface RevenueSummary {
  totals: any;
  totalSalePrice: number;
  totalAdminCommission: number;
  totalSellerRevenue: number;
  totalOrders: number;
  monthlyBreakdown: { [key: string]: MonthData };
}

const SellerRevenueDashboard = () => {
  const token = localStorage.getItem('token');
  const [loading, setLoading] = useState(true);
  const [revenue, setRevenue] = useState<RevenueSummary | null>(null);
  const [monthlyData, setMonthlyData] = useState<MonthData[]>([]);

  useEffect(() => {
    if (!token || localStorage.getItem('isSeller') !== 'true') {
      window.location.hash = '/auth';
      return;
    }
    fetchRevenueData();
  }, [token]);

  const fetchRevenueData = async () => {
    try {
      setLoading(true);

      // Fetch total revenue
      const totalResponse = await axios.get(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/revenue/seller/total`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      setRevenue(totalResponse.data);

      // Convert monthly breakdown to array
      const monthlyArray = Object.entries(
        totalResponse.data.monthlyBreakdown || {}
      ).map(([key, data]: any) => ({
        month: key,
        ...data,
      }));

      setMonthlyData(monthlyArray);
    } catch (error: any) {
      console.error('Error fetching revenue data:', error);
      toast.error(error.response?.data?.message || 'Failed to load revenue data');
      setRevenue({
        totals: {},
        totalSalePrice: 0,
        totalAdminCommission: 0,
        totalSellerRevenue: 0,
        totalOrders: 0,
        monthlyBreakdown: {},
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <NavBar />
      <div className="min-h-screen bg-paper">
        {/* Header */}
        <div className="bg-ink text-paper py-6 sm:py-8 border-b border-brass/40">
          <div className="container mx-auto px-4 sm:px-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl sm:text-4xl font-bold mb-2">Revenue Dashboard</h1>
                <p className="text-paper/60">Track your sales and earnings</p>
              </div>
              <button
                onClick={fetchRevenueData}
                disabled={loading}
                className="inline-flex items-center gap-2 bg-brass text-white hover:bg-brass-dark disabled:opacity-50 active:scale-[0.97] transition px-4 sm:px-6 py-3 font-semibold shrink-0"
              >
                <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="container mx-auto px-4 sm:px-6 py-6 sm:py-10">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <RefreshCw className="w-8 h-8 animate-spin text-brass mx-auto mb-4" />
                <p className="text-ink-muted">Loading revenue data...</p>
              </div>
            </div>
          ) : (
            <>
              {/* Charts */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
                {/* Monthly Trend */}
                <div className="bg-paper-raised border border-hairline p-6">
                  <h2 className="text-xl font-bold text-ink mb-6">Monthly Trend</h2>
                  {monthlyData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart data={monthlyData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                        <XAxis dataKey="month" stroke="#64748B" tick={{ fill: '#64748B', fontSize: 12 }} />
                        <YAxis stroke="#64748B" tick={{ fill: '#64748B', fontSize: 12 }} />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 0 }}
                          labelStyle={{ color: '#111827', fontWeight: 600 }}
                          formatter={(value: any) => value ? `रु ${value.toLocaleString()}` : ''}
                        />
                        <Legend wrapperStyle={{ color: '#64748B', fontSize: 13 }} />
                        <Line
                          type="monotone"
                          dataKey="sellerRevenue"
                          stroke="#0F766E"
                          name="Your Revenue"
                          strokeWidth={2}
                        />
                        <Line
                          type="monotone"
                          dataKey="totalSalePrice"
                          stroke="#16A34A"
                          name="Total Sales"
                          strokeWidth={2}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-80 flex items-center justify-center text-ink-muted">
                      No data available
                    </div>
                  )}
                </div>

                {/* Commission Breakdown */}
                <div className="bg-paper-raised border border-hairline p-6">
                  <h2 className="text-xl font-bold text-ink mb-6">Commission Breakdown (5%)</h2>
                  {revenue ? (
                    <div className="border border-hairline divide-y divide-hairline">
                      <div className="flex justify-between items-center px-4 py-4">
                        <span className="text-ink-muted font-medium text-sm">Total Sales</span>
                        <span className="text-lg font-bold text-ink font-mono tabular-nums">
                          रु {revenue.totals.totalSalePrice.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex justify-between items-center px-4 py-4">
                        <span className="text-ink-muted font-medium text-sm">Admin Commission (5%)</span>
                        <span className="text-lg font-bold text-graphite font-mono tabular-nums">
                          रु {revenue.totals.totalAdminCommission.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex justify-between items-center px-4 py-4">
                        <span className="text-ink-muted font-medium text-sm">Your Revenue (95%)</span>
                        <span className="text-lg font-bold text-brass font-mono tabular-nums">
                          रु {revenue.totals.totalSellerRevenue.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="h-80 flex items-center justify-center text-ink-muted">
                      No data available
                    </div>
                  )}
                </div>
              </div>

              {/* Monthly Sales Stats */}
              <div className="bg-paper-raised border border-hairline p-6 mb-8">
                <h2 className="text-xl font-bold text-ink mb-6">Monthly Sales Stats</h2>
                {monthlyData.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="border-b-2 border-ink">
                          <th className="p-4 text-left font-semibold text-ink text-xs uppercase tracking-wide">Month</th>
                          <th className="p-4 text-center font-semibold text-ink text-xs uppercase tracking-wide">Orders</th>
                          <th className="p-4 text-right font-semibold text-ink text-xs uppercase tracking-wide">Total Sales</th>
                          <th className="p-4 text-right font-semibold text-ink text-xs uppercase tracking-wide">Your Revenue</th>
                        </tr>
                      </thead>
                      <tbody>
                        {monthlyData.map((data) => (
                          <tr key={data.month} className="border-b border-hairline hover:bg-paper transition-colors">
                            <td className="p-4 font-semibold text-ink">{data.month}</td>
                            <td className="p-4 text-center font-mono tabular-nums text-ink-muted">{data.orderCount}</td>
                            <td className="p-4 text-right font-mono tabular-nums font-semibold text-ink">
                              रु {data.totalSalePrice.toLocaleString()}
                            </td>
                            <td className="p-4 text-right font-mono tabular-nums font-semibold text-brass">
                              रु {data.sellerRevenue.toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="h-40 flex items-center justify-center text-ink-muted">
                    No data available
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default SellerRevenueDashboard;
