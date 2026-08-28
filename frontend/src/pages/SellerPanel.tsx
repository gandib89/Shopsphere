import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Package, ShoppingCart, Eye, Trash2, BarChart2 } from 'lucide-react';
import { getImageUrl } from '../lib/utils';
import axios from 'axios';
import { toast } from 'sonner';
import NavBar from '../components/NavBar';
import { ActionList, type ActionItem } from '../components/operations/ActionList';
import { PageHeader } from '../components/operations/PageHeader';
import { LoadingState } from '../components/ui/AsyncState';

interface Product {
  _id: string;
  name: string;
  category: string;
  price: number;
  quantity: number;
  images: string[];
  colorVariants?: Array<{
    color: string;
    stock: number;
    images: string[];
  }>;
  storageVariants?: Array<{
    storage: string;
    stock: number;
  }>;
}

interface Order {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  product: {
    _id: string;
    name: string;
    price: number;
  };
  quantity: number;
  totalPrice: number;
  status: string;
  createdAt: string;
}

const orderStatusColor = (status: string) => {
  switch (status) {
    case 'Delivered': return 'border-moss text-moss';
    case 'Shipped':
    case 'Processing': return 'border-brass text-brass';
    case 'Cancelled': return 'border-seal text-seal';
    default: return 'border-hairline text-ink-muted';
  }
};

function SellerPanel() {
  const token = localStorage.getItem('token');
  const navigate = useNavigate();
  const [sellerInfo, setSellerInfo] = useState<any>(null);
  const [productCount, setProductCount] = useState(0);
  const [orderCount, setOrderCount] = useState(0);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token || localStorage.getItem('isSeller') !== 'true') {
      window.location.hash = '/auth';
      return;
    }

    fetchSellerInfo();
  }, [token]);

  const fetchSellerInfo = async () => {
    try {
      const response = await axios.get(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/auth/me`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      setSellerInfo(response.data);

      // Check if seller is verified
      if (!response.data.isVerified) {
        toast.error('Your seller account is pending admin approval');
        setTimeout(() => {
          window.location.hash = '/';
        }, 2000);
        return;
      }

      fetchSellerData();
    } catch (err) {
      console.error('Error fetching seller info:', err);
      toast.error('Failed to load seller information');
      setLoading(false);
    }
  };

  const fetchSellerData = async () => {
    try {
      // Fetch seller's products
      const productsRes = await axios.get(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/product/seller/my-products`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      setProducts(productsRes.data.products || []);
      setProductCount(productsRes.data.count || 0);

      // Fetch seller's orders
      const ordersRes = await axios.get(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/order/seller/my-orders`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      setOrders(ordersRes.data.orders || []);
      setOrderCount(ordersRes.data.count || 0);
    } catch (err) {
      console.error('Error fetching seller data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteProduct = async (productId: string) => {
    if (window.confirm('Are you sure you want to delete this product?')) {
      try {
        await axios.delete(
          `${import.meta.env.VITE_BACKEND_URL}/api/v1/product/seller/delete/${productId}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );
        toast.success('Product deleted successfully');
        setProducts(products.filter(p => p._id !== productId));
        setProductCount(productCount - 1);
      } catch (err) {
        console.error('Error deleting product:', err);
        toast.error('Failed to delete product');
      }
    }
  };

  const panelCards: ActionItem[] = [
    {
      key: 'add-product',
      icon: <Plus className="w-6 h-6" />,
      title: 'Add Product',
      description: 'Add new products to your store',
      onSelect: () => navigate('/add-product'),
      count: undefined,
    },
    {
      key: 'products',
      icon: <Package className="w-6 h-6" />,
      title: 'My Products',
      description: 'Manage and view your products',
      onSelect: () => navigate('/seller-products'),
      count: productCount,
    },
    {
      key: 'orders',
      icon: <ShoppingCart className="w-6 h-6" />,
      title: 'Orders',
      description: 'View and manage customer orders',
      onSelect: () => navigate('/seller-orders'),
      count: orderCount,
    },
    {
      key: 'revenue',
      icon: <BarChart2 className="w-6 h-6" />,
      title: 'Revenue Dashboard',
      description: 'View your sales and earnings',
      onSelect: () => navigate('/seller/revenue'),
    },
  ];

  return (
    <>
      <NavBar />
      <main className="min-h-screen bg-paper">
        <PageHeader
          eyebrow={sellerInfo?.shopName || 'Seller workspace'}
          title="Store operations"
          description="Manage listings, orders, and the performance of your shop."
        />

        {loading ? (
          <LoadingState description="Loading your shop workspace" />
        ) : (
        <div className="container-operate py-7 sm:py-10">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-ink">Workspaces</h2>
            <p className="mt-1 text-sm text-ink-muted">Choose the part of your shop you want to work on.</p>
          </div>
          <ActionList label="Seller workspaces" items={panelCards} />

          {/* Recent Products Section */}
          <section className="mt-8 rounded-[var(--radius-surface)] border border-hairline bg-paper-raised p-5 shadow-sm sm:p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-display text-2xl font-bold text-ink">Your Recent Products</h2>
              <button
                onClick={() => navigate('/seller-products')}
                className="text-brass hover:text-brass-dark font-semibold text-sm"
              >
                View All →
              </button>
            </div>
            {products.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {products.slice(0, 3).map((product) => (
                  <article key={product._id} className="rounded-[var(--radius-surface)] border border-hairline p-4 transition-colors hover:border-brass/50">
                    <img
                      src={getImageUrl(product.images?.[0])}
                      alt={product.name}
                      className="mb-3 aspect-[4/3] w-full rounded-[var(--radius-control)] border border-hairline object-cover"
                    />
                    <h3 className="font-semibold text-ink mb-1">{product.name}</h3>
                    <p className="text-sm text-ink-muted mb-2">{product.category}</p>
                    <div className="flex justify-between items-center mb-3">
                      <p className="text-lg font-bold text-ink font-mono tabular-nums">Rs. {product.price.toLocaleString()}</p>
                      <p className="text-sm text-ink-muted font-mono tabular-nums">{product.quantity} total</p>
                    </div>

                    {/* Color Variants Stock */}
                    {product.colorVariants && product.colorVariants.length > 0 && (
                      <div className="mb-3 pb-3 border-t border-hairline pt-2">
                        <p className="text-xs text-ink-muted mb-1">Stock by Color:</p>
                        <div className="flex flex-wrap gap-1">
                          {product.colorVariants.map((cv, idx) => (
                            <span key={idx} className="text-xs border border-hairline px-2 py-1 font-mono tabular-nums text-ink-muted">
                              {cv.color}: {cv.stock}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Storage Variants Stock */}
                    {product.storageVariants && product.storageVariants.length > 0 && (
                      <div className="mb-3 pb-3 border-t border-hairline pt-2">
                        <p className="text-xs text-ink-muted mb-1">Stock by Storage:</p>
                        <div className="flex flex-wrap gap-1">
                          {product.storageVariants.map((sv, idx) => (
                            <span key={idx} className="text-xs border border-hairline px-2 py-1 font-mono tabular-nums text-ink-muted">
                              {sv.storage}: {sv.stock}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="flex gap-2">
                      <button
                        onClick={() => navigate(`/seller-products/${product._id}`)}
                        className="flex-1 p-2 border border-ink text-ink hover:bg-ink hover:text-paper active:scale-[0.98] transition text-sm font-semibold flex items-center justify-center gap-1"
                      >
                        <Eye className="w-4 h-4" /> View / Edit
                      </button>
                      <button
                        onClick={() => handleDeleteProduct(product._id)}
                        className="flex-1 p-2 border border-seal text-seal hover:bg-seal/5 active:scale-[0.98] transition text-sm font-semibold flex items-center justify-center gap-1"
                      >
                        <Trash2 className="w-4 h-4" /> Delete
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="text-ink-muted text-center py-8">No products yet. <button onClick={() => navigate('/add-product')} className="text-brass hover:text-brass-dark font-semibold">Add your first product</button></p>
            )}
          </section>

          {/* Recent Orders Section */}
          <section className="mt-6 rounded-[var(--radius-surface)] border border-hairline bg-paper-raised p-5 shadow-sm sm:p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-display text-2xl font-bold text-ink">Recent Orders</h2>
              <button
                onClick={() => navigate('/seller-orders')}
                className="text-brass hover:text-brass-dark font-semibold text-sm"
              >
                View All →
              </button>
            </div>
            {orders.length > 0 ? (
              <div className="space-y-3">
                {orders.slice(0, 5).map((order) => (
                  <article key={order._id} className="rounded-[var(--radius-control)] border border-hairline p-4 transition-colors hover:bg-paper">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <p className="font-semibold text-ink">{order.product.name}</p>
                        <p className="text-sm text-ink-muted">Order by {order.firstName} {order.lastName}</p>
                        <p className="text-xs text-ink-muted/70 mt-1 font-mono tabular-nums">{new Date(order.createdAt).toLocaleDateString()}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-ink font-mono tabular-nums">Rs. {order.totalPrice.toLocaleString()}</p>
                        <p className={`text-xs font-semibold px-2 py-0.5 border mt-1 inline-block ${orderStatusColor(order.status)}`}>
                          {order.status}
                        </p>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="text-ink-muted text-center py-8">No orders yet. Once customers purchase your products, orders will appear here.</p>
            )}
          </section>
        </div>
        )}
      </main>
    </>
  );
}

export default SellerPanel;
