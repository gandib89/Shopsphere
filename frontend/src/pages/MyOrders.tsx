import React, { useEffect, useState } from "react";
import NavBar from "../components/NavBar";
import { ArrowLeft, Package, CheckCircle, Clock, AlertCircle, XCircle, Truck, Star, RotateCcw, Ban, Banknote, Filter, CornerDownLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { authFetch } from "../lib/session";

const MyOrders = () => {
  interface Order {
    _id: string;
    orderNumber?: string;
    orderGroupId?: string;
    firstName: string;
    lastName: string;
    email: string;
    quantity: number;
    deliveryDate: Date;
    deliveredAt?: Date;
    cancelledAt?: Date;
    returnRequestedAt?: Date;
    totalPrice: number;
    product: {
      _id: string;
      name: string;
    };
    status: string;
  }

  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reviewingOrder, setReviewingOrder] = useState<{ orderId: string; productId: string; productName: string; firstName: string; lastName: string } | null>(null);
  const [newReview, setNewReview] = useState({ rating: 5, comment: "" });
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewedOrders, setReviewedOrders] = useState<Set<string>>(new Set());
  const [returningOrder, setReturningOrder] = useState<Order | null>(null);
  const [returnReason, setReturnReason] = useState("");
  const [returnImage, setReturnImage] = useState<File | null>(null);
  const [submittingReturn, setSubmittingReturn] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
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
      const res = await authFetch(`${import.meta.env.VITE_BACKEND_URL}/api/v1/order/user/get`, {
        method: "GET",
        headers,
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || `HTTP ${res.status}: Failed to fetch orders`);
      }

      const data = await res.json();
      // Handle both array and wrapped response
      const ordersArray = Array.isArray(data) ? data : data.data || [];
      setOrders(ordersArray);
      setError("");
    } catch (err) {
      console.error("Error fetching orders:", err);
      setError(err instanceof Error ? err.message : "An unknown error occurred");
    } finally {
      setLoading(false);
    }
  };

  // Status is carried mostly by icon shape; color collapses to four semantic
  // buckets instead of a rainbow of pastel hues.
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
    if (!window.confirm("Are you sure you want to cancel this order? This cannot be undone.")) return;
    const token = localStorage.getItem("token");
    setCancellingId(orderId);
    try {
      const res = await authFetch(`${import.meta.env.VITE_BACKEND_URL}/api/v1/order/cancel/${orderId}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to cancel order");
      setOrders((prev) => prev.map((o) => o._id === orderId ? { ...o, status: "Cancelled" } : o));
      toast.success("Order cancelled successfully");
    } catch (err: any) {
      toast.error(err.message || "Failed to cancel order");
    } finally {
      setCancellingId(null);
    }
  };

  const handleSubmitReturn = async () => {
    if (!returningOrder) return;
    if (returnReason.trim() === "") { toast.error("Please provide a reason for the return"); return; }
    if (!returnImage) { toast.error("Please upload a photo of the defected product"); return; }

    const token = localStorage.getItem("token");
    setSubmittingReturn(true);
    try {
      const formData = new FormData();
      formData.append("reason", returnReason);
      formData.append("returnImage", returnImage);

      const res = await authFetch(`${import.meta.env.VITE_BACKEND_URL}/api/v1/order/return/${returningOrder._id}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to submit return");
      setOrders((prev) => prev.map((o) => o._id === returningOrder._id ? { ...o, status: "Return Requested" } : o));
      toast.success("Return request submitted! Our team will review it within 1-2 business days.");
      setReturningOrder(null);
      setReturnReason("");
      setReturnImage(null);
    } catch (err: any) {
      toast.error(err.message || "Failed to submit return request");
    } finally {
      setSubmittingReturn(false);
    }
  };

  // Check if return is still within 7-day window
  const isReturnEligible = (order: Order): boolean => {
    if (order.status !== "Delivered") return false;
    const deliveredDate = order.deliveredAt || order.deliveryDate;
    const daysSince = (Date.now() - new Date(deliveredDate).getTime()) / (1000 * 60 * 60 * 24);
    return daysSince <= 7;
  };

  const getDaysLeftForReturn = (order: Order): number => {
    const deliveredDate = order.deliveredAt || order.deliveryDate;
    const daysSince = (Date.now() - new Date(deliveredDate).getTime()) / (1000 * 60 * 60 * 24);
    return Math.max(0, Math.ceil(7 - daysSince));
  };

  const handleSubmitReview = async () => {
    if (!reviewingOrder) return;
    if (newReview.comment.trim() === "") {
      toast.error("Please enter a review comment");
      return;
    }

    const token = localStorage.getItem("token");
    try {
      setSubmittingReview(true);
      const reviewData = {
        rating: newReview.rating,
        comment: newReview.comment,
        orderId: reviewingOrder.orderId,
      };

      const res = await authFetch(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/product/${reviewingOrder.productId}/reviews`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(reviewData),
        }
      );

      if (!res.ok) throw new Error("Failed to submit review");

      toast.success("Thank you for your review!");
      setReviewedOrders((prev) => new Set(prev).add(reviewingOrder.orderId));
      setReviewingOrder(null);
      setNewReview({ rating: 5, comment: "" });
    } catch (err) {
      console.error("Error submitting review:", err);
      toast.error("Failed to submit review. Please try again.");
    } finally {
      setSubmittingReview(false);
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
                onClick={() => navigate("/")}
                className="p-2 hover:text-brass transition-colors shrink-0"
                title="Go back to home"
              >
                <ArrowLeft className="w-5 h-5 sm:w-6 sm:h-6" />
              </button>
              <h1 className="font-display text-2xl sm:text-4xl font-bold">My Orders</h1>
            </div>
            <p className="text-paper/60 text-sm ml-11">Track and manage your orders</p>
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
                className="px-6 py-3 bg-brass text-white hover:bg-brass-dark active:scale-[0.97] transition font-semibold"
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
                <div className="flex items-center gap-3">
                  {activeFilter !== "all" && (
                    <button
                      onClick={() => setActiveFilter("all")}
                      className="text-sm text-brass hover:text-brass-dark font-medium flex items-center gap-1"
                    >
                      <XCircle className="w-3.5 h-3.5" /> Clear filter
                    </button>
                  )}
                  <button
                    onClick={fetchOrders}
                    className="flex items-center gap-2 text-sm text-ink hover:bg-ink hover:text-paper active:scale-[0.98] font-semibold border border-ink px-3 py-1.5 transition"
                  >
                    <RotateCcw className="w-4 h-4" /> Refresh
                  </button>
                </div>
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
                        <h3 className="text-xl font-bold text-ink mb-1">
                          {order.product?.name || "Product"}
                        </h3>
                        {(order.product as any)?.seller && (
                          <p className="text-sm text-brass font-semibold mb-2">
                            Seller: {(order.product as any).seller?.shopName || `${(order.product as any).seller?.firstName} ${(order.product as any).seller?.lastName}`}
                          </p>
                        )}
                        <p className="text-sm text-ink-muted font-mono tabular-nums">
                          {order.orderNumber || `#${order._id.slice(-8).toUpperCase()}`}
                        </p>
                        {order.orderGroupId && orders.filter(o => o.orderGroupId === order.orderGroupId).length > 1 && (
                          <div className="mt-2">
                            <span className="inline-flex items-center gap-1 px-2 py-1 border border-hairline text-ink-muted text-xs font-semibold uppercase tracking-wide">
                              <Package className="w-3 h-3" />
                              Part of {orders.filter(o => o.orderGroupId === order.orderGroupId).length}-item order
                            </span>
                          </div>
                        )}
                      </div>
                      <div className={`inline-flex items-center gap-2 px-3.5 py-1.5 border font-semibold mt-4 md:mt-0 ${getStatusColor(order.status)}`}>
                        {getStatusIcon(order.status)}
                        <span>{order.status || "Unknown"}</span>
                      </div>
                    </div>

                    {/* Order Details Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-6 p-6 bg-paper border-b border-hairline">
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
                        <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1">Total Amount</p>
                        <p className="text-2xl font-bold text-brass font-mono tabular-nums">Rs.{order.totalPrice}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1">Order Date</p>
                        <p className="text-lg font-semibold text-ink font-mono tabular-nums">
                          {new Date(order.deliveryDate).toLocaleDateString()}
                        </p>
                      </div>
                    </div>

                    {/* Customer Info */}
                    <div className="p-6 bg-paper">
                      <p className="text-sm font-semibold text-ink mb-3">Delivery Details</p>
                      <div className="space-y-2 text-sm text-ink-muted">
                        <p><span className="font-semibold text-ink">Name:</span> {order.firstName} {order.lastName}</p>
                        <p><span className="font-semibold text-ink">Email:</span> {order.email}</p>
                        <p><span className="font-semibold text-ink">Expected Delivery:</span> <span className="font-mono tabular-nums">{new Date(order.deliveryDate).toLocaleDateString()}</span></p>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="p-6 flex flex-col md:flex-row gap-3 flex-wrap border-t border-hairline">
                      <button
                        onClick={() => navigate(`/order/${order._id}`)}
                        className="flex-1 px-4 py-2 bg-brass text-white hover:bg-brass-dark active:scale-[0.97] transition font-semibold"
                      >
                        View Details
                      </button>
                      {/* Track Order */}
                      {!["cancelled", "return requested", "return approved", "return rejected", "refund released"].includes(order.status?.toLowerCase()) && (
                        <button
                          onClick={() => navigate(`/track-order/${order._id}`)}
                          className="flex-1 px-4 py-2 border border-ink text-ink hover:bg-ink hover:text-paper active:scale-[0.98] transition font-semibold flex items-center justify-center gap-2"
                        >
                          <Truck className="w-4 h-4" /> Track Order
                        </button>
                      )}
                      {/* Write review — only for delivered orders */}
                      {order.status?.toLowerCase() === "delivered" && !reviewedOrders.has(order._id) && (
                        <button
                          onClick={() => setReviewingOrder({
                            orderId: order._id,
                            productId: order.product?._id,
                            productName: order.product?.name || "Product",
                            firstName: order.firstName,
                            lastName: order.lastName,
                          })}
                          className="flex-1 px-4 py-2 border border-ink text-ink hover:bg-ink hover:text-paper active:scale-[0.98] transition font-semibold flex items-center justify-center gap-2"
                        >
                          <Star className="w-4 h-4" />
                          Write a Review
                        </button>
                      )}
                      {reviewedOrders.has(order._id) && (
                        <div className="flex-1 px-4 py-2 text-center text-moss font-semibold flex items-center justify-center gap-2">
                          <Star className="w-4 h-4 fill-current" />
                          Review Submitted
                        </div>
                      )}
                      {/* Cancel — only for Pending or Confirmed */}
                      {["pending", "confirmed"].includes(order.status?.toLowerCase()) && (
                        <button
                          onClick={() => handleCancelOrder(order._id)}
                          disabled={cancellingId === order._id}
                          className="flex-1 px-4 py-2 border border-seal text-seal hover:bg-seal/5 active:scale-[0.98] transition font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                          <XCircle className="w-4 h-4" />
                          {cancellingId === order._id ? "Cancelling..." : "Cancel Order"}
                        </button>
                      )}
                      {/* Return — only for Delivered within 7 days */}
                      {isReturnEligible(order) && (
                        <button
                          onClick={() => setReturningOrder(order)}
                          className="flex-1 px-4 py-2 border border-ink text-ink hover:bg-ink hover:text-paper active:scale-[0.98] transition font-semibold flex items-center justify-center gap-2"
                        >
                          <RotateCcw className="w-4 h-4" />
                          Return (<span className="font-mono tabular-nums">{getDaysLeftForReturn(order)}d</span> left)
                        </button>
                      )}
                      {/* Return status badges */}
                      {order.status === "Return Requested" && (
                        <div className="flex-1 px-4 py-2 text-center border border-brass text-brass font-semibold flex items-center justify-center gap-2">
                          <RotateCcw className="w-4 h-4" /> Return Under Review
                        </div>
                      )}
                      {order.status === "Return Approved" && (
                        <div className="flex-1 px-4 py-2 text-center border border-brass text-brass font-semibold flex items-center justify-center gap-2">
                          <CheckCircle className="w-4 h-4" /> Return Approved – Awaiting Refund
                        </div>
                      )}
                      {order.status === "Return Rejected" && (
                        <div className="flex-1 px-4 py-2 text-center border border-seal text-seal font-semibold flex items-center justify-center gap-2">
                          <Ban className="w-4 h-4" /> Return Rejected
                        </div>
                      )}
                      {order.status === "Refund Released" && (
                        <div className="flex-1 px-4 py-2 text-center border border-moss text-moss font-bold flex items-center justify-center gap-2">
                          <Banknote className="w-4 h-4" /> {import.meta.env.VITE_DEMO_MODE !== 'false' ? 'Sandbox refund recorded' : 'Refund released'} – <span className="font-mono tabular-nums">Rs.{order.totalPrice}</span>{import.meta.env.VITE_DEMO_MODE !== 'false' && ' · no real money moved'}
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

      {/* Review Modal */}
      {reviewingOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 px-4">
          <div className="bg-paper-raised border border-hairline w-full max-w-md p-8">
            <h2 className="font-display text-2xl font-bold text-ink mb-1">Write a Review</h2>
            <p className="text-sm text-ink-muted mb-6">{reviewingOrder.productName}</p>

            {/* Star Rating */}
            <div className="mb-5">
              <label className="block text-sm font-semibold text-ink mb-2">Your Rating</label>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    onClick={() => setNewReview((r) => ({ ...r, rating: star }))}
                    className="focus:outline-none transition active:scale-[0.9]"
                  >
                    <Star
                      size={32}
                      className={star <= newReview.rating ? "fill-brass text-brass" : "fill-none text-hairline"}
                    />
                  </button>
                ))}
              </div>
            </div>

            {/* Comment */}
            <div className="mb-6">
              <label className="block text-sm font-semibold text-ink mb-2">Your Review</label>
              <textarea
                value={newReview.comment}
                onChange={(e) => setNewReview((r) => ({ ...r, comment: e.target.value }))}
                rows={4}
                className="w-full p-3 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition resize-none"
                placeholder="Share your experience with this product..."
              />
            </div>

            {/* Buttons */}
            <div className="flex gap-3">
              <button
                onClick={handleSubmitReview}
                disabled={submittingReview}
                className="flex-1 bg-brass hover:bg-brass-dark disabled:opacity-50 text-ink font-semibold px-4 py-3 active:scale-[0.97] transition"
              >
                {submittingReview ? "Submitting..." : "Submit Review"}
              </button>
              <button
                onClick={() => { setReviewingOrder(null); setNewReview({ rating: 5, comment: "" }); }}
                className="flex-1 border border-ink text-ink hover:bg-ink hover:text-paper active:scale-[0.98] font-semibold px-4 py-3 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Return Modal */}
      {returningOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 px-4">
          <div className="bg-paper-raised border border-hairline w-full max-w-md p-8 max-h-[90vh] overflow-y-auto">
            <h2 className="font-display text-2xl font-bold text-ink mb-1">Request a Return</h2>
            <p className="text-sm text-ink-muted mb-1">{returningOrder.product?.name}</p>
            <p className="text-xs text-brass font-semibold mb-6 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              You have <span className="font-mono tabular-nums">{getDaysLeftForReturn(returningOrder)}</span> day(s) left to request a return
            </p>
            <div className="border border-brass/30 bg-brass/5 p-4 mb-6 text-sm text-ink">
              <p className="font-semibold mb-1">Return Policy</p>
              <ul className="list-disc list-inside space-y-1 text-ink-muted">
                <li>Returns accepted within 7 days of delivery</li>
                <li>Product must be in original condition</li>
                <li>Refund processed within 5-7 business days after approval</li>
              </ul>
            </div>
            <div className="mb-6">
              <label className="block text-sm font-semibold text-ink mb-2">Reason for Return *</label>
              <textarea
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                rows={3}
                className="w-full p-3 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition resize-none"
                placeholder="e.g. Defective product, wrong item received, not as described..."
              />
            </div>
            <div className="mb-6">
              <label className="block text-sm font-semibold text-ink mb-2">Upload Photo of Defect *</label>
              <div className="border border-dashed border-hairline p-4 hover:border-brass transition">
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setReturnImage(e.target.files?.[0] || null)}
                  className="w-full text-sm text-ink-muted file:mr-4 file:py-2 file:px-4 file:border file:border-hairline file:text-sm file:font-semibold file:bg-paper-raised file:text-ink hover:file:border-brass hover:file:text-brass"
                />
                <p className="text-xs text-ink-muted mt-2">Upload a clear photo showing the defect or issue (JPG, PNG, max 5MB)</p>
                {returnImage && (
                  <p className="text-sm text-moss mt-2 flex items-center gap-1.5">
                    <CheckCircle className="w-4 h-4" /> {returnImage.name}
                  </p>
                )}
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleSubmitReturn}
                disabled={submittingReturn}
                className="flex-1 px-4 py-3 bg-brass hover:bg-brass-dark disabled:opacity-50 text-ink font-bold transition flex items-center justify-center gap-2 text-base active:scale-[0.97]"
              >
                <RotateCcw className="w-5 h-5" />
                {submittingReturn ? "Submitting..." : "Submit Return Request"}
              </button>
              <button
                onClick={() => { setReturningOrder(null); setReturnReason(""); }}
                className="flex-1 border border-ink text-ink hover:bg-ink hover:text-paper active:scale-[0.98] font-semibold px-4 py-3 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default MyOrders;
