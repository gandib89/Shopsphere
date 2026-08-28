import React, { useEffect, useState } from "react";
import NavBar from "../components/NavBar";
import { ArrowLeft, Package, CheckCircle, Clock, AlertCircle, XCircle, Truck, RotateCcw, Ban, Banknote, Filter, CornerDownLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

const AdminOrders = () => {
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
    };
    status: string;
    color?: string;
    variants?: {
      color?: string;
      storage?: string;
    };
    returnReason?: string;
    returnImage?: string;
    refundReleasedAt?: Date;
  }

  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeFilter, setActiveFilter] = useState<string>("all");

  type FilterCategory = {
    key: string;
    label: string;
    icon: React.ReactNode;
    statuses: string[];
  };

  const filterCategories: FilterCategory[] = [
    { key: "all", label: "All", icon: <Package className="w-4 h-4" />, statuses: [] },
    { key: "active", label: "Active", icon: <Clock className="w-4 h-4" />, statuses: ["Pending", "Confirmed", "Processing"] },
    { key: "shipped", label: "Shipped", icon: <Truck className="w-4 h-4" />, statuses: ["Shipped"] },
    { key: "delivered", label: "Delivered", icon: <CheckCircle className="w-4 h-4" />, statuses: ["Delivered"] },
    { key: "cancelled", label: "Cancelled", icon: <XCircle className="w-4 h-4" />, statuses: ["Cancelled"] },
    { key: "returns", label: "Returns", icon: <CornerDownLeft className="w-4 h-4" />, statuses: ["Return Requested", "Return Approved", "Return Rejected", "Refund Released"] },
  ];

  const getFilteredOrders = () => {
    if (activeFilter === "all") return orders;
    const category = filterCategories.find((c) => c.key === activeFilter);
    if (!category) return orders;
    return orders.filter((o) => category.statuses.includes(o.status));
  };

  const getCountForFilter = (key: string) => {
    if (key === "all") return orders.length;
    const category = filterCategories.find((c) => c.key === key);
    if (!category) return 0;
    return orders.filter((o) => category.statuses.includes(o.status)).length;
  };

  useEffect(() => {
    fetchOrders();
  }, []);

  const fetchOrders = async () => {
    const token = localStorage.getItem("token");

    if (!token) {
      setError("You must be logged in to access this page.");
      setLoading(false);
      return;
    }

    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    try {
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/v1/order/getOrder`, {
        method: "GET",
        headers,
      });

      if (!res.ok) {
        let errorMessage = `HTTP ${res.status}: Failed to fetch orders`;
        try {
          const errorData = await res.json();
          errorMessage = errorData.message || errorMessage;
        } catch (jsonErr) {
          // Response is not JSON (e.g., HTML error page)
          console.error("Server returned non-JSON response:", res.status, res.statusText);
        }
        throw new Error(errorMessage);
      }

      const data = await res.json();
      // Handle both array and wrapped response
      const ordersArray = Array.isArray(data) ? data : data.data || [];
      // Sort by delivery date (earliest first)
      const sortedOrders = ordersArray.sort((a, b) => {
        const dateA = new Date(a.deliveryDate).getTime();
        const dateB = new Date(b.deliveryDate).getTime();
        return dateA - dateB;
      });
      setOrders(sortedOrders);
      setError("");
    } catch (err) {
      console.error("Error fetching orders:", err);
      setError(err instanceof Error ? err.message : "An unknown error occurred");
    } finally {
      setLoading(false);
    }
  };

  // Status is carried mostly by icon shape; color collapses to four semantic
  // buckets (neutral / needs-attention / resolved / cancelled) to stay inside
  // the instrument world's one-accent palette instead of ten pastel hues.
  const getStatusColor = (status: string): string => {
    switch (status?.toLowerCase()) {
      case "shipped":
      case "return requested":
      case "return approved":   return "border-brass text-brass";
      case "delivered":
      case "refund released":   return "border-moss text-moss";
      case "cancelled":
      case "return rejected":   return "border-seal text-seal";
      default:                  return "border-hairline text-ink-muted";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status?.toLowerCase()) {
      case "pending":          return <Clock className="w-4 h-4" />;
      case "processing":       return <AlertCircle className="w-4 h-4" />;
      case "shipped":          return <Truck className="w-4 h-4" />;
      case "delivered":        return <CheckCircle className="w-4 h-4" />;
      case "cancelled":        return <XCircle className="w-4 h-4" />;
      case "return requested": return <RotateCcw className="w-4 h-4" />;
      case "return approved":  return <CheckCircle className="w-4 h-4" />;
      case "return rejected":  return <Ban className="w-4 h-4" />;
      case "refund released":  return <Banknote className="w-4 h-4" />;
      default:                 return <Package className="w-4 h-4" />;
    }
  };

  const handleCancelOrder = async (orderId: string) => {
    if (!window.confirm("Are you sure you want to cancel this order?")) return;
    const token = localStorage.getItem("token");
    try {
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/v1/order/cancel/${orderId}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error("Failed to cancel order");
      setOrders((prev) => prev.map((o) => o._id === orderId ? { ...o, status: "Cancelled" } : o));
      toast.success("Order cancelled and stock restored");
    } catch (err) {
      console.error("Error cancelling order:", err);
      toast.error("Failed to cancel order. Please try again.");
    }
  };

  const handleReleaseRefund = async (orderId: string) => {
    if (!window.confirm("Release the refund for this order? The customer will be notified by email.")) return;
    const token = localStorage.getItem("token");
    try {
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/v1/order/admin/refund/${orderId}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to release refund");
      setOrders((prev) => prev.map((o) => o._id === orderId ? { ...o, status: "Refund Released" } : o));
      toast.success("Refund released successfully — customer notified");
    } catch (err: any) {
      toast.error(err.message || "Failed to release refund");
    }
  };

  const handleProcessReturn = async (orderId: string, action: "approve" | "reject") => {
    if (!window.confirm(`Are you sure you want to ${action} this return request?`)) return;
    const token = localStorage.getItem("token");
    try {
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/v1/order/admin/return/${orderId}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to process return");
      const newStatus = action === "approve" ? "Return Approved" : "Return Rejected";
      setOrders((prev) => prev.map((o) => o._id === orderId ? { ...o, status: newStatus } : o));
      toast.success(`Return ${action === "approve" ? "approved" : "rejected"} successfully`);
    } catch (err: any) {
      toast.error(err.message || "Failed to process return");
    }
  };

  if (loading) {
    return (
      <>
        <NavBar />
        <div className="flex items-center justify-center min-h-screen bg-paper">
          <div className="text-center">
            <Package className="w-10 h-10 mx-auto mb-4 text-brass animate-pulse" />
            <p className="text-ink-muted">Loading your orders...</p>
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
          <div className="container mx-auto px-4 sm:px-6">
            <div className="flex items-center gap-3 mb-1">
              <button
                onClick={() => navigate(-1)}
                className="p-2 hover:text-brass transition-colors shrink-0"
                title="Go back"
              >
                <ArrowLeft className="w-5 h-5 sm:w-6 sm:h-6" />
              </button>
              <h1 className="font-display text-2xl sm:text-4xl font-bold">All Orders</h1>
            </div>
            <p className="text-paper/60 text-sm ml-11">View and manage all customer orders</p>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="bg-paper-raised border-b border-hairline sticky top-0 z-10">
          <div className="container mx-auto px-4 sm:px-6">
            <div className="flex items-center gap-1.5 overflow-x-auto py-3 scrollbar-hide">
              <Filter className="w-4 h-4 text-brass mr-1 shrink-0" />
              {filterCategories.map((cat) => {
                const count = getCountForFilter(cat.key);
                const isActive = activeFilter === cat.key;
                return (
                  <button
                    key={cat.key}
                    onClick={() => setActiveFilter(cat.key)}
                    className={`flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-semibold whitespace-nowrap transition-colors border ${
                      isActive
                        ? "bg-ink text-paper border-ink"
                        : "bg-transparent text-ink-muted border-hairline hover:border-brass hover:text-brass"
                    }`}
                  >
                    {cat.icon}
                    {cat.label}
                    <span className={`ml-1 px-1.5 text-xs font-mono tabular-nums ${isActive ? "text-brass" : "text-ink-muted/70"}`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="container mx-auto px-4 sm:px-6 py-6 sm:py-10">
          {error && (
            <div className="mb-6 p-4 border border-seal/40 bg-seal/5 text-seal">
              {error}
            </div>
          )}

          {orders.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-hairline">
              <Package className="w-16 h-16 mx-auto mb-4 text-ink-muted/40" />
              <h2 className="font-display text-2xl font-bold text-ink mb-2">No Orders Yet</h2>
              <p className="text-ink-muted mb-6">Start shopping to see your orders here</p>
              <button
                onClick={() => navigate("/")}
                className="px-6 py-3 bg-brass text-white hover:bg-brass-dark active:scale-[0.98] transition font-semibold"
              >
                Continue Shopping
              </button>
            </div>
          ) : (
            <>
              <div className="mb-6 flex items-center justify-between">
                <p className="text-ink-muted text-sm">
                  Showing: <span className="font-bold text-ink font-mono tabular-nums">{getFilteredOrders().length}</span>
                  {activeFilter !== "all" && <> of <span className="font-bold text-ink font-mono tabular-nums">{orders.length}</span> orders</>}
                  {activeFilter === "all" && <> orders</>}
                </p>
                {activeFilter !== "all" && (
                  <button
                    onClick={() => setActiveFilter("all")}
                    className="text-sm text-brass hover:text-brass-dark font-medium flex items-center gap-1"
                  >
                    <XCircle className="w-3.5 h-3.5" /> Clear filter
                  </button>
                )}
              </div>

              {getFilteredOrders().length === 0 ? (
                <div className="text-center py-12 border border-dashed border-hairline">
                  <Filter className="w-14 h-14 mx-auto mb-4 text-ink-muted/30" />
                  <h3 className="font-display text-xl font-bold text-ink mb-2">No orders in this category</h3>
                  <p className="text-ink-muted">There are no orders with the selected status filter.</p>
                </div>
              ) : (
              <div className="grid grid-cols-1 gap-6">
                {getFilteredOrders().map((order) => (
                  <div
                    key={order._id}
                    className="bg-paper-raised border border-hairline overflow-hidden"
                  >
                    {/* Order Header */}
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between p-6 border-b border-hairline">
                      <div>
                        <h3 className="text-xl font-bold text-ink mb-2">
                          {order.product?.name || "Product"}
                        </h3>
                        <p className="text-sm text-ink-muted font-mono tabular-nums">Order ID: {order._id.slice(-8)}</p>
                      </div>
                      <div className={`inline-flex items-center gap-2 px-3.5 py-1.5 border font-semibold mt-4 md:mt-0 ${getStatusColor(order.status)}`}>
                        {getStatusIcon(order.status)}
                        <span>{order.status || "Unknown"}</span>
                      </div>
                    </div>

                    {/* Order Details Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-6 p-6 bg-paper border-b border-hairline">
                      <div>
                        <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1">Quantity</p>
                        <p className="text-2xl font-bold text-ink font-mono tabular-nums">{order.quantity}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1">Unit Price</p>
                        <p className="text-2xl font-bold text-ink font-mono tabular-nums">
                          Rs.{order.totalPrice && order.quantity ? Math.round(order.totalPrice / order.quantity) : 0}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1">Color</p>
                        <p className="text-lg font-bold text-ink">{order.color || order.variants?.color || "N/A"}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1">Expected Delivery</p>
                        <p className="text-lg font-bold text-brass font-mono tabular-nums">{new Date(order.deliveryDate).toLocaleDateString()}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1">Total Amount</p>
                        <p className="text-2xl font-bold text-ink font-mono tabular-nums">Rs.{order.totalPrice}</p>
                      </div>
                    </div>

                    {/* Customer Info */}
                    <div className="p-6 bg-paper">
                      <p className="text-sm font-semibold text-ink mb-3">Delivery Details</p>
                      <div className="space-y-2 text-sm text-ink-muted">
                        <p><span className="font-semibold text-ink">Name:</span> {order.firstName} {order.lastName}</p>
                        <p><span className="font-semibold text-ink">Email:</span> {order.email}</p>
                        <p><span className="font-semibold text-ink">Expected Delivery:</span> {new Date(order.deliveryDate).toLocaleDateString()}</p>
                      </div>
                      {/* Return reason banner */}
                      {["Return Requested", "Return Approved", "Return Rejected", "Refund Released"].includes(order.status) && (
                        <div className="mt-3 p-3 border border-brass/40 bg-brass/5">
                          <p className="text-xs font-bold text-brass uppercase tracking-wide mb-1">Return Info</p>
                          {order.returnReason ? (
                            <p className="text-sm text-ink">{order.returnReason}</p>
                          ) : (
                            <p className="text-sm text-ink-muted italic">No reason provided</p>
                          )}
                          {order.returnImage && (
                            <div className="mt-3">
                              <p className="text-xs font-bold text-brass uppercase tracking-wide mb-2">Defect Photo</p>
                              <img
                                src={`${import.meta.env.VITE_BACKEND_URL}/uploads/${order.returnImage}`}
                                alt="Product defect"
                                className="w-full max-w-xs border border-brass/40 cursor-pointer hover:opacity-90 transition"
                                onClick={() => window.open(`${import.meta.env.VITE_BACKEND_URL}/uploads/${order.returnImage}`, '_blank')}
                              />
                              <p className="text-xs text-ink-muted mt-1">Click image to view full size</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="p-6 flex flex-col md:flex-row gap-3 flex-wrap border-t border-hairline">
                      <button
                        onClick={() => navigate(`/order/${order._id}`)}
                        className="flex-1 px-4 py-2 bg-brass text-white hover:bg-brass-dark active:scale-[0.98] transition font-semibold"
                      >
                        View Details
                      </button>
                      {["pending", "confirmed"].includes(order.status?.toLowerCase()) && (
                        <button
                          onClick={() => handleCancelOrder(order._id)}
                          className="flex-1 px-4 py-2 border border-seal text-seal hover:bg-seal/5 active:scale-[0.98] transition font-semibold flex items-center justify-center gap-2"
                        >
                          <XCircle className="w-4 h-4" /> Cancel Order
                        </button>
                      )}
                      {order.status === "Return Requested" && (
                        <>
                          <button
                            onClick={() => handleProcessReturn(order._id, "approve")}
                            className="flex-1 px-4 py-2 bg-moss text-paper hover:opacity-90 active:scale-[0.98] transition font-semibold flex items-center justify-center gap-2"
                          >
                            <CheckCircle className="w-5 h-5" /> Approve Return
                          </button>
                          <button
                            onClick={() => handleProcessReturn(order._id, "reject")}
                            className="flex-1 px-4 py-2 bg-seal text-paper hover:opacity-90 active:scale-[0.98] transition font-semibold flex items-center justify-center gap-2"
                          >
                            <Ban className="w-5 h-5" /> Reject Return
                          </button>
                        </>
                      )}
                      {order.status === "Return Approved" && (
                        <button
                          onClick={() => handleReleaseRefund(order._id)}
                          className="flex-1 px-4 py-2 bg-moss text-paper hover:opacity-90 active:scale-[0.98] transition font-semibold flex items-center justify-center gap-2"
                        >
                          <Banknote className="w-5 h-5" /> Release Fund (Rs.{order.totalPrice})
                        </button>
                      )}
                      {order.status === "Refund Released" && (
                        <div className="flex-1 px-4 py-2 border border-moss text-moss font-semibold flex items-center justify-center gap-2">
                          <Banknote className="w-4 h-4" /> Refund Released – Rs.{order.totalPrice}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default AdminOrders;
