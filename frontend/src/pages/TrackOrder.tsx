import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import NavBar from "../components/NavBar";
import { getImageUrl } from "../lib/utils";
import {
  ArrowLeft,
  Package,
  CheckCircle,
  Clock,
  Truck,
  Home,
  ShoppingBag,
  MapPin,
} from "lucide-react";

interface TimelineStep {
  step: string;
  status: string;
  time: string | null;
  done: boolean;
}

interface TrackOrder {
  _id: string;
  orderNumber?: string;
  firstName: string;
  lastName: string;
  email: string;
  quantity: number;
  totalPrice: number;
  status: string;
  deliveryDate: string;
  createdAt: string;
  deliveryAddress?: {
    street?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    country?: string;
  };
  product: {
    name: string;
    images?: string[];
    price: number;
  };
  variants?: { color?: string; storage?: string };
  color?: string;
}

const STEP_ICONS = [ShoppingBag, CheckCircle, Package, Truck, Home];

const statusIsCancelled = (s: string) =>
  ["Cancelled", "Return Requested", "Return Approved", "Return Rejected", "Refund Released"].includes(s);

// Cancelled/return-flow statuses collapse to the four semantic buckets used
// across the app instead of a bespoke color per status.
const cancelledStatusStyle: Record<string, { text: string; border: string; borderT: string }> = {
  Cancelled: { text: "text-seal", border: "border-seal", borderT: "border-t-seal" },
  "Return Requested": { text: "text-brass", border: "border-brass", borderT: "border-t-brass" },
  "Return Approved": { text: "text-brass", border: "border-brass", borderT: "border-t-brass" },
  "Return Rejected": { text: "text-seal", border: "border-seal", borderT: "border-t-seal" },
  "Refund Released": { text: "text-moss", border: "border-moss", borderT: "border-t-moss" },
};
const defaultStatusStyle = { text: "text-ink-muted", border: "border-hairline", borderT: "border-t-hairline" };

export default function TrackOrder() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const [order, setOrder] = useState<TrackOrder | null>(null);
  const [timeline, setTimeline] = useState<TimelineStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetch_ = async () => {
      const token = localStorage.getItem("token");
      if (!token) { navigate("/auth"); return; }
      try {
        const res = await fetch(
          `${import.meta.env.VITE_BACKEND_URL}/api/v1/order/track/${orderId}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Failed to fetch order");
        setOrder(data.order);
        setTimeline(data.timeline);
      } catch (e: any) {
        setError(e.message || "Could not load order");
      } finally {
        setLoading(false);
      }
    };
    fetch_();
  }, [orderId]);

  const fmt = (d: string | null | undefined) => {
    if (!d) return null;
    return new Date(d).toLocaleString("en-US", {
      month: "short", day: "numeric", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  };

  // Find the "active" (latest done) index
  const activeIdx = statusIsCancelled(order?.status || "")
    ? -1
    : timeline.reduce((acc, s, i) => (s.done ? i : acc), -1);

  if (loading) return (
    <>
      <NavBar />
      <div className="min-h-screen bg-paper flex items-center justify-center">
        <div className="text-center">
          <Package className="w-10 h-10 mx-auto mb-4 text-brass animate-pulse" />
          <p className="text-ink-muted">Loading order status...</p>
        </div>
      </div>
    </>
  );

  if (error || !order) return (
    <>
      <NavBar />
      <div className="min-h-screen bg-paper flex flex-col items-center justify-center gap-4 px-4">
        <div className="border border-dashed border-hairline bg-paper-raised p-8 max-w-md text-center">
          <p className="text-seal font-semibold mb-4">{error || "Order not found"}</p>
          <button
            onClick={() => navigate("/my-orders")}
            className="px-6 py-2 border border-ink text-ink hover:bg-ink hover:text-paper active:scale-[0.98] transition font-semibold inline-flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" /> Back to My Orders
          </button>
        </div>
      </div>
    </>
  );

  const imgSrc = order.product?.images?.[0]
    ? getImageUrl(order.product.images[0])
    : null;

  const addr = order.deliveryAddress;
  const addrStr = addr
    ? [addr.street, addr.city, addr.state, addr.zipCode, addr.country].filter(Boolean).join(", ")
    : null;

  const cancelled = statusIsCancelled(order.status);
  const statusStyle = cancelledStatusStyle[order.status] || defaultStatusStyle;

  return (
    <>
      <NavBar />
      <div className="min-h-screen bg-paper py-10">
        <div className="container mx-auto px-4 max-w-3xl">

          {/* Back */}
          <button
            onClick={() => navigate("/my-orders")}
            className="flex items-center gap-2 text-ink hover:text-brass font-semibold mb-6 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" /> Back to My Orders
          </button>

          {/* Order header card */}
          <div className="bg-paper-raised border border-hairline overflow-hidden mb-6">
            <div className="bg-ink p-6 flex flex-col sm:flex-row sm:items-center gap-4 border-b border-brass/40">
              {imgSrc && (
                <img
                  src={imgSrc}
                  alt={order.product.name}
                  className="w-20 h-20 object-cover border border-paper/30 flex-shrink-0"
                  onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
                />
              )}
              <div className="flex-1 text-paper">
                <p className="text-paper/60 text-sm font-medium mb-1 font-mono tabular-nums">
                  {order.orderNumber || `#${order._id.slice(-8).toUpperCase()}`}
                </p>
                <h1 className="font-display text-2xl font-bold">{order.product.name}</h1>
                <p className="text-paper/60 text-sm mt-1 font-mono tabular-nums">
                  Qty: {order.quantity} &nbsp;·&nbsp; Rs.{order.totalPrice.toLocaleString()}
                </p>
              </div>
              <div className={`px-4 py-2 border text-sm font-bold flex-shrink-0 bg-paper-raised ${statusStyle.text} ${statusStyle.border}`}>
                {order.status}
              </div>
            </div>

            {/* Address + dates */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-0 divide-y sm:divide-y-0 sm:divide-x divide-hairline">
              <div className="p-5 flex gap-3">
                <Clock className="w-5 h-5 text-brass flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-bold text-ink-muted uppercase tracking-wide mb-1">Order Placed</p>
                  <p className="text-sm text-ink font-medium font-mono tabular-nums">{fmt(order.createdAt)}</p>
                </div>
              </div>
              <div className="p-5 flex gap-3">
                <Truck className="w-5 h-5 text-brass flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-bold text-ink-muted uppercase tracking-wide mb-1">Expected Delivery</p>
                  <p className="text-sm text-ink font-medium font-mono tabular-nums">{fmt(order.deliveryDate)}</p>
                </div>
              </div>
              {addrStr && (
                <div className="p-5 flex gap-3 col-span-full border-t border-hairline">
                  <MapPin className="w-5 h-5 text-brass flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-bold text-ink-muted uppercase tracking-wide mb-1">Delivery Address</p>
                    <p className="text-sm text-ink">{addrStr}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Timeline */}
          {!cancelled ? (
            <div className="bg-paper-raised border border-hairline p-5 sm:p-8">
              <h2 className="font-display text-lg font-bold text-ink mb-6 sm:mb-8">Delivery Timeline</h2>
              <div className="relative">
                {/* Vertical connector line — hairline for the full track */}
                <div className="absolute left-6 top-0 bottom-0 w-px bg-hairline" />
                {/* Active fill — brass, up to the last completed step */}
                <div
                  className="absolute left-6 top-0 w-px bg-brass transition-all duration-700"
                  style={{
                    height: activeIdx >= 0 ? `${(activeIdx / (timeline.length - 1)) * 100}%` : "0%",
                  }}
                />

                <div className="space-y-8 relative">
                  {timeline.map((step, idx) => {
                    const Icon = STEP_ICONS[idx] || Package;
                    const isActive = idx === activeIdx;
                    const isDone = step.done;
                    return (
                      <div key={step.step} className="flex items-start gap-5">
                        {/* Dot — moss when completed, brass ring when current, hairline otherwise */}
                        <div
                          className={`relative z-10 flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center border-2 transition-all duration-300 ${
                            isDone
                              ? isActive
                                ? "bg-brass border-brass"
                                : "bg-moss border-moss"
                              : "bg-paper-raised border-hairline"
                          }`}
                        >
                          <Icon className={`w-5 h-5 ${isDone ? "text-paper" : "text-ink-muted/50"}`} />
                        </div>

                        {/* Label */}
                        <div className="flex-1 pt-2">
                          <p className={`font-bold text-base ${isDone ? "text-ink" : "text-ink-muted/60"}`}>
                            {step.step}
                            {isActive && (
                              <span className="ml-2 text-xs font-semibold px-2 py-0.5 border border-brass text-brass">
                                Current
                              </span>
                            )}
                          </p>
                          {step.time ? (
                            <p className="text-sm text-ink-muted mt-0.5 font-mono tabular-nums">{fmt(step.time)}</p>
                          ) : isDone ? (
                            <p className="text-sm text-ink-muted mt-0.5">Completed</p>
                          ) : (
                            <p className="text-sm text-ink-muted/60 mt-0.5">Pending</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className={`bg-paper-raised border border-hairline border-t-4 p-5 sm:p-8 text-center ${statusStyle.borderT}`}>
              <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border ${statusStyle.text} ${statusStyle.border}`}>
                <Package className={`w-8 h-8 ${statusStyle.text}`} />
              </div>
              <h2 className="font-display text-xl font-bold text-ink mb-2">{order.status}</h2>
              <p className="text-ink-muted text-sm">
                {order.status === "Cancelled" && "This order has been cancelled."}
                {order.status === "Return Requested" && "Your return request is under review."}
                {order.status === "Return Approved" && "Return approved. Awaiting refund release."}
                {order.status === "Return Rejected" && "Your return request was rejected."}
                {order.status === "Refund Released" && <>Refund of Rs.<span className="font-mono tabular-nums">{order.totalPrice}</span> has been released.</>}
              </p>
            </div>
          )}

          {/* Customer info */}
          <div className="bg-paper-raised border border-hairline p-6 mt-6">
            <h3 className="text-sm font-bold text-ink-muted uppercase tracking-wide mb-3">Customer Details</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div><span className="font-semibold text-ink">Name: </span><span className="text-ink-muted">{order.firstName} {order.lastName}</span></div>
              <div><span className="font-semibold text-ink">Email: </span><span className="text-ink-muted">{order.email}</span></div>
              {(order.color || order.variants?.color) && (
                <div><span className="font-semibold text-ink">Color: </span><span className="text-ink-muted">{order.color || order.variants?.color}</span></div>
              )}
              {order.variants?.storage && (
                <div><span className="font-semibold text-ink">Storage: </span><span className="text-ink-muted">{order.variants.storage}</span></div>
              )}
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
