import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Package, ClipboardList, RefreshCw, CheckCircle, Users, BarChart2, Tag } from "lucide-react";
import axios from "axios";
import NavBar from "../components/NavBar";
import { Button } from "../components/ui/Button";
import { ActionList, type ActionItem } from "../components/operations/ActionList";
import { PageHeader } from "../components/operations/PageHeader";

const AdminPanel = () => {
  const navigate = useNavigate();
  const [productCount, setProductCount] = useState(0);
  const [orderCount, setOrderCount] = useState(0);
  const [pendingOrderCount, setPendingOrderCount] = useState(0);
  const [promoCodeCount, setPromoCodeCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const token = localStorage.getItem("token");

  useEffect(() => {
    if (!token || localStorage.getItem('isAdmin') !== 'true') {
      window.location.hash = '/auth';
      return;
    }

    fetchAdminData();
  }, [token]);

  const fetchAdminData = async () => {
    try {
      // Fetch products
      try {
        const productsRes = await axios.get(
          `${import.meta.env.VITE_BACKEND_URL}/api/v1/product/get`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );
        const productCount = Array.isArray(productsRes.data) ? productsRes.data.length : 0;
        setProductCount(productCount);
      } catch (err: any) {
        console.error('Products error:', err?.response?.status, err?.message);
      }

      // Fetch orders
      try {
        const ordersRes = await axios.get(
          `${import.meta.env.VITE_BACKEND_URL}/api/v1/order/getOrder`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );
        const ordersArray = Array.isArray(ordersRes.data) ? ordersRes.data : (ordersRes.data?.data || []);
        const orderCount = ordersArray.length || 0;
        setOrderCount(orderCount);

        const pending = ordersArray.filter((o: any) => {
          const status = (o?.status || "").toLowerCase();
          return status !== "delivered" && status !== "cancelled";
        }).length;
        setPendingOrderCount(pending);
      } catch (err: any) {
        console.error('Orders error:', err?.response?.status, err?.message);
      }

      // Fetch promo codes (non-critical)
      try {
        const promoRes = await axios.get(
          `${import.meta.env.VITE_BACKEND_URL}/api/v1/promo/all`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );
        const promoCount = promoRes.data.promoCodes?.length || 0;
        setPromoCodeCount(promoCount);
      } catch (err: any) {
        console.warn('Promo codes unavailable:', err?.message);
      }
    } catch (err) {
      console.error('Unexpected error:', err);
    } finally {
      setLoading(false);
    }
  };

  const panelCards: ActionItem[] = [
    {
      key: 'all-products',
      icon: <Package className="w-6 h-6" />,
      title: 'All Products',
      description: 'Manage and view all products',
      onSelect: () => navigate('/all-products'),
      count: productCount,
    },
    {
      key: 'orders',
      icon: <ClipboardList className="w-6 h-6" />,
      title: 'All Orders',
      description: pendingOrderCount > 0 ? `View and manage customer orders — ${pendingOrderCount} pending` : 'View and manage customer orders',
      onSelect: () => navigate('/admin-orders'),
      count: orderCount,
    },
    {
      key: 'seller-approvals',
      icon: <CheckCircle className="w-6 h-6" />,
      title: 'Seller Approvals',
      description: 'Verify and approve new sellers',
      onSelect: () => navigate('/admin/seller-approvals'),
    },
    {
      key: 'promo-codes',
      icon: <Tag className="w-6 h-6" />,
      title: 'Promo Codes',
      description: 'Create and manage discount codes',
      onSelect: () => navigate('/admin/promo-codes'),
      count: promoCodeCount,
    },
    {
      key: 'revenue',
      icon: <BarChart2 className="w-6 h-6" />,
      title: 'Revenue Dashboard',
      description: 'View platform revenue and analytics',
      onSelect: () => navigate('/admin/revenue'),
    },
    {
      key: 'users',
      icon: <Users className="w-6 h-6" />,
      title: 'User Management',
      description: 'Manage users, sellers, and admins',
      onSelect: () => navigate('/admin/users'),
    },
  ];

  return (
    <>
      <NavBar />
      <main className="min-h-screen bg-paper">
        <PageHeader
          eyebrow="Administration"
          title="Marketplace operations"
          description="Products, orders, seller access, promotions, and platform reporting in one place."
          action={(
            <Button variant="secondary" onClick={fetchAdminData} loading={loading}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Refresh data
            </Button>
          )}
        />
        <div className="container-operate py-7 sm:py-10">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-ink">Workspaces</h2>
              <p className="mt-1 text-sm text-ink-muted">Choose the area you want to manage.</p>
            </div>
            {pendingOrderCount > 0 && (
              <p className="rounded-full bg-brass/10 px-3 py-1 text-sm font-medium text-brass">
                {pendingOrderCount} orders need attention
              </p>
            )}
          </div>
          <ActionList label="Admin workspaces" items={panelCards} />
        </div>
      </main>
    </>
  );
};

export default AdminPanel;
