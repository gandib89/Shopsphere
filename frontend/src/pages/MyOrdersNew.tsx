import React, { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle, Clock, Truck, Package, XCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import NavBar from "../components/NavBar";

interface Order {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  quantity: number;
  deliveryDate: Date;
  totalPrice: number;
  product: {
    name: string;
    price: number;
  };
  status: string;
  createdAt: string;
  color?: string;
  variants?: {
    color?: string;
    storage?: string;
  };
}

const MyOrders = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const token = localStorage.getItem("token");

  useEffect(() => {
    if (!token) {
      window.location.hash = '/auth';
      return;
    }
    fetchOrders();
  }, [token]);

  const fetchOrders = async () => {
    try {
      const res = await axios.get(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/order/user/get`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      setOrders(res.data);
    } catch (err) {
      console.error("Error fetching orders:", err);
      toast.error("Failed to fetch orders");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteOrder = async (orderId: string) => {
    if (window.confirm("Are you sure you want to cancel this order?")) {
      try {
        await axios.delete(
          `${import.meta.env.VITE_BACKEND_URL}/api/v1/order/user/delete/${orderId}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );
        toast.success("Order cancelled successfully");
        setOrders(orders.filter(o => o._id !== orderId));
      } catch (err) {
        console.error("Error deleting order:", err);
        toast.error("Failed to cancel order");
      }
    }
  };

  // Status is carried mostly by icon shape; color collapses to four semantic
  // buckets (neutral / needs-attention / resolved / cancelled) to stay inside
  // the instrument world's one-accent palette instead of a rainbow of pastels.
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Processing':
      case 'Shipped':
        return 'border-brass text-brass';
      case 'Delivered':
        return 'border-moss text-moss';
      case 'Cancelled':
        return 'border-seal text-seal';
      default:
        return 'border-hairline text-ink-muted';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'Pending':
        return <Clock className="w-4 h-4" />;
      case 'Shipped':
        return <Truck className="w-4 h-4" />;
      case 'Delivered':
        return <CheckCircle className="w-4 h-4" />;
      case 'Cancelled':
        return <XCircle className="w-4 h-4" />;
      default:
        return <Package className="w-4 h-4" />;
    }
  };

  if (loading) {
    return (
      <>
        <NavBar />
        <div className="min-h-screen flex items-center justify-center bg-paper">
          <div className="text-center">
            <Package className="w-10 h-10 mx-auto mb-4 text-brass animate-pulse" />
            <p className="text-ink-muted">Loading orders...</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <NavBar />
      <div className="min-h-screen bg-paper">
        {/* Header */}
        <div className="bg-ink text-paper py-6 sm:py-8 border-b border-brass/40">
          <div className="container mx-auto px-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate('/')}
                className="p-2 hover:text-brass transition-colors shrink-0"
                title="Go back"
              >
                <ArrowLeft className="w-5 h-5 sm:w-6 sm:h-6" />
              </button>
              <div>
                <h1 className="text-2xl sm:text-4xl font-bold">My Orders</h1>
                <p className="text-paper/60 text-sm mt-1 font-mono tabular-nums">{orders.length} orders placed</p>
              </div>
            </div>
          </div>
        </div>

        {/* Orders Content */}
        <div className="container mx-auto px-4 py-8 sm:py-12">
          {orders.length > 0 ? (
            <div className="space-y-6">
              {orders.map((order) => (
                <div
                  key={order._id}
                  className="bg-paper-raised border border-hairline"
                >
                  {/* Order Header */}
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 p-6 border-b border-hairline">
                    <div>
                      <h3 className="text-xl font-bold text-ink">{order.product.name}</h3>
                      <p className="text-ink-muted text-sm mt-1 font-mono tabular-nums">Order ID: {order._id}</p>
                    </div>
                    <div className={`inline-flex items-center gap-2 px-3.5 py-1.5 border font-semibold ${getStatusColor(order.status)}`}>
                      {getStatusIcon(order.status)}
                      <span>{order.status}</span>
                    </div>
                  </div>

                  {/* Order Details */}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-6 p-6 bg-paper border-b border-hairline">
                    <div>
                      <p className="text-ink-muted text-xs font-semibold uppercase tracking-wide mb-1">Quantity</p>
                      <p className="text-lg font-bold text-ink font-mono tabular-nums">{order.quantity}</p>
                    </div>
                    <div>
                      <p className="text-ink-muted text-xs font-semibold uppercase tracking-wide mb-1">Unit Price</p>
                      <p className="text-lg font-bold text-ink font-mono tabular-nums">Rs. {order.product.price.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-ink-muted text-xs font-semibold uppercase tracking-wide mb-1">Total Amount</p>
                      <p className="text-xl font-bold text-brass font-mono tabular-nums">Rs. {order.totalPrice.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-ink-muted text-xs font-semibold uppercase tracking-wide mb-1">Color</p>
                      <p className="text-lg font-bold text-ink">{order.color || order.variants?.color || "N/A"}</p>
                    </div>
                    <div>
                      <p className="text-ink-muted text-xs font-semibold uppercase tracking-wide mb-1">Storage</p>
                      <p className="text-lg font-bold text-ink">{order.variants?.storage || "N/A"}</p>
                    </div>
                  </div>

                  {/* Customer Info */}
                  <div className="p-6 border-b border-hairline">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      <div>
                        <p className="text-ink-muted text-xs font-medium uppercase tracking-wide">Customer Name</p>
                        <p className="font-semibold text-ink">{order.firstName} {order.lastName}</p>
                      </div>
                      <div>
                        <p className="text-ink-muted text-xs font-medium uppercase tracking-wide">Email</p>
                        <p className="font-semibold text-ink text-sm">{order.email}</p>
                      </div>
                      <div>
                        <p className="text-ink-muted text-xs font-medium uppercase tracking-wide">Expected Delivery</p>
                        <p className="font-semibold text-ink font-mono tabular-nums">
                          {new Date(order.deliveryDate).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-3 p-6">
                    <button
                      onClick={() => navigate(`/orders/${order._id}`)}
                      className="flex-1 px-4 py-2 bg-brass text-white hover:bg-brass-dark active:scale-[0.98] transition font-semibold"
                    >
                      View Details
                    </button>
                    {order.status === 'Pending' && (
                      <button
                        onClick={() => handleDeleteOrder(order._id)}
                        className="flex-1 px-4 py-2 border border-seal text-seal hover:bg-seal/5 active:scale-[0.98] transition font-semibold"
                      >
                        Cancel Order
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="border border-dashed border-hairline p-12 text-center">
              <Package className="w-16 h-16 text-ink-muted/40 mx-auto mb-4" />
              <h3 className="text-2xl font-bold text-ink mb-2">No Orders Yet</h3>
              <p className="text-ink-muted mb-6">You haven't placed any orders. Start shopping now!</p>
              <button
                onClick={() => navigate('/')}
                className="inline-block bg-brass text-white px-6 py-3 hover:bg-brass-dark active:scale-[0.98] transition font-semibold"
              >
                Continue Shopping
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default MyOrders;
