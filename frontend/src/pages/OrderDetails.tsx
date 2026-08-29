import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import NavBar from "../components/NavBar";
import { ArrowLeft, Package, User, MapPin, Calendar, CreditCard, Tag, Truck, CheckCircle, Clock, AlertCircle, XCircle, RotateCcw, Banknote, ShoppingBag, Store, ImageIcon } from "lucide-react";
import { authFetch } from "../lib/session";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";

interface OrderData {
  _id: string;
  orderNumber?: string;
  firstName: string;
  lastName: string;
  email?: string;
  quantity: number;
  deliveryDate: string;
  totalPrice: number;
  adminCommission?: number;
  product: {
    _id: string;
    name: string;
    price: number;
    images?: string[];
    category?: string;
    colorVariants?: { color: string; images: string[]; stock: number }[];
    sellerId?: {
      _id: string;
      firstName: string;
      lastName: string;
      email: string;
      phone?: string;
      shopName?: string;
      shopDescription?: string;
    };
  };
  status: string;
  color?: string;
  size?: string;
  variants?: {
    color?: string;
    storage?: string;
    ram?: string;
    screenSize?: string;
    processor?: string;
  };
  deliveryAddress?: {
    street?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    country?: string;
  };
  returnReason?: string;
  returnImage?: string;
  returnRequestedAt?: string;
  refundReleasedAt?: string;
  cancelledAt?: string;
  deliveredAt?: string;
  confirmedAt?: string;
  processingAt?: string;
  shippedAt?: string;
  createdAt?: string;
  promoCode?: { code: string; discountAmount: number };
  billId?: string;
  userId?: string;
}

const OrderDetails = () => {
  const [order, setOrder] = useState<OrderData | null>(null);
  const [orders, setOrders] = useState<OrderData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lightboxImg, setLightboxImg] = useState<string | null>(null);

  const params = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    if (params.orderId) fetchSingleOrder(params.orderId);
    else fetchOrders();
  }, [params.orderId]);

  const fetchSingleOrder = async (orderId: string) => {
    const token = localStorage.getItem("token");
    if (!token) { setError("You must be logged in to view this page."); setLoading(false); return; }
    try {
      const res = await authFetch(`${BACKEND_URL}/api/v1/order/details/${orderId}`, {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      if (!res.ok) {
        let msg = `Failed to fetch order (${res.status})`;
        try { const d = await res.json(); msg = d.message || msg; } catch {}
        throw new Error(msg);
      }
      setOrder(await res.json());
    } catch (err: any) {
      setError(err.message || "Unknown error");
    } finally { setLoading(false); }
  };

  const fetchOrders = async () => {
    const token = localStorage.getItem("token");
    if (!token) { setError("You must be logged in to view this page."); setLoading(false); return; }
    try {
      const res = await authFetch(`${BACKEND_URL}/api/v1/order/getOrder`, {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      if (!res.ok) {
        let msg = `Failed to fetch orders (${res.status})`;
        try { const d = await res.json(); msg = d.message || msg; } catch {}
        throw new Error(msg);
      }
      const data = await res.json();
      setOrders(Array.isArray(data) ? data : data.data || []);
    } catch (err: any) {
      setError(err.message || "Unknown error");
    } finally { setLoading(false); }
  };

  /* ── helpers ── */
  // Status color collapses to four semantic buckets (brass = in-progress /
  // attention, moss = success, seal = cancelled/danger, hairline = neutral)
  // instead of a rainbow of pastel hues, matching the rest of the app.
  const getStatusColor = (status: string) => {
    const s = status?.toLowerCase() || "";
    if (s === "delivered" || s === "refund released") return "border-moss text-moss";
    if (s === "shipped" || s.includes("return")) return "border-brass text-brass";
    if (s === "processing" || s === "confirmed") return "border-hairline text-ink-muted";
    if (s === "cancelled") return "border-seal text-seal";
    return "border-hairline text-ink-muted";
  };

  const getStatusIcon = (status: string) => {
    const s = status?.toLowerCase() || "";
    if (s === "delivered") return <CheckCircle className="w-5 h-5" />;
    if (s === "shipped") return <Truck className="w-5 h-5" />;
    if (s === "processing" || s === "confirmed") return <Clock className="w-5 h-5" />;
    if (s === "cancelled") return <XCircle className="w-5 h-5" />;
    if (s.includes("return")) return <RotateCcw className="w-5 h-5" />;
    if (s.includes("refund")) return <Banknote className="w-5 h-5" />;
    return <AlertCircle className="w-5 h-5" />;
  };

  const imgUrl = (path: string) => {
    if (!path) return "";
    if (path.startsWith("http")) return path;
    return `${BACKEND_URL}/uploads/${path}`;
  };

  const formatDate = (d?: string) => d ? new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "—";
  const formatDateTime = (d?: string) => d ? new Date(d).toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : null;

  /* ── product images (prefer color-matched variant images) ── */
  const getProductImages = (o: OrderData): string[] => {
    const selectedColor = o.color || o.variants?.color;
    if (selectedColor && o.product?.colorVariants?.length) {
      const cv = o.product.colorVariants.find(v => v.color === selectedColor);
      if (cv?.images?.length) return cv.images;
    }
    return o.product?.images || [];
  };

  /* ── Lightbox overlay ── */
  const Lightbox = () =>
    lightboxImg ? (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4" onClick={() => setLightboxImg(null)}>
        <img src={lightboxImg} alt="Full size" className="max-w-full max-h-[90vh] border border-hairline" />
      </div>
    ) : null;

  /* ── loading / error ── */
  if (loading)
    return (
      <>
        <NavBar />
        <div className="min-h-screen bg-paper flex items-center justify-center">
          <div className="text-center">
            <Package className="w-10 h-10 mx-auto mb-4 text-brass animate-pulse" />
            <p className="text-ink-muted">Loading order details...</p>
          </div>
        </div>
      </>
    );

  if (error)
    return (
      <>
        <NavBar />
        <div className="min-h-screen bg-paper flex items-center justify-center px-4">
          <div className="border border-dashed border-hairline bg-paper-raised p-8 max-w-md text-center">
            <AlertCircle className="w-10 h-10 text-seal mx-auto mb-4" />
            <p className="text-seal font-semibold">{error}</p>
            <button onClick={() => navigate(-1)} className="mt-4 px-6 py-2 bg-brass text-white hover:bg-brass-dark active:scale-[0.97] transition font-semibold">Go Back</button>
          </div>
        </div>
      </>
    );

  /* ═══════════════════════════════════════════════════════════
     SINGLE ORDER VIEW
     ═══════════════════════════════════════════════════════════ */
  if (order) {
    const productImages = getProductImages(order);
    const seller = order.product?.sellerId;

    return (
      <>
        <NavBar />
        <Lightbox />
        <div className="min-h-screen bg-paper">
          {/* Header */}
          <div className="bg-ink text-paper py-6 sm:py-8 border-b border-brass/40">
            <div className="container mx-auto px-4 sm:px-6">
              <div className="flex items-center gap-3 mb-1">
                <button onClick={() => navigate(-1)} className="p-2 hover:text-brass transition-colors shrink-0" title="Go back">
                  <ArrowLeft className="w-5 h-5 sm:w-6 sm:h-6" />
                </button>
                <div>
                  <h1 className="font-display text-2xl sm:text-4xl font-bold">Order Details</h1>
                  <p className="text-paper/60 text-sm mt-1 font-mono tabular-nums">{order.orderNumber || order._id}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="container mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-6">

            {/* ── Status Banner ── */}
            <div className="bg-paper-raised border border-hairline overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-6">
                <div>
                  <h2 className="text-xl font-bold text-ink">{order.product?.name || "Product"}</h2>
                  <p className="text-sm text-ink-muted mt-1 font-mono tabular-nums">Order ID: {order._id}</p>
                </div>
                <div className={`inline-flex items-center gap-2 px-4 py-2 border font-semibold mt-3 sm:mt-0 ${getStatusColor(order.status)}`}>
                  {getStatusIcon(order.status)}
                  <span>{order.status}</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* ── LEFT COLUMN: Product Images ── */}
              <div className="lg:col-span-1 space-y-6">
                {/* Product Photos */}
                <div className="bg-paper-raised border border-hairline p-6">
                  <h3 className="text-sm font-bold text-ink-muted uppercase tracking-wide mb-4 flex items-center gap-2">
                    <ImageIcon className="w-4 h-4 text-brass" /> Product Photos
                  </h3>
                  {productImages.length > 0 ? (
                    <div className="space-y-3">
                      {/* Main image */}
                      <img
                        src={imgUrl(productImages[0])}
                        alt={order.product?.name}
                        className="w-full border border-hairline cursor-pointer hover:opacity-90 transition object-cover max-h-72"
                        onClick={() => setLightboxImg(imgUrl(productImages[0]))}
                      />
                      {/* Thumbnail row */}
                      {productImages.length > 1 && (
                        <div className="flex gap-2 overflow-x-auto">
                          {productImages.slice(1).map((img, i) => (
                            <img
                              key={i}
                              src={imgUrl(img)}
                              alt={`${order.product?.name} ${i + 2}`}
                              className="w-16 h-16 border border-hairline object-cover cursor-pointer hover:border-brass transition flex-shrink-0"
                              onClick={() => setLightboxImg(imgUrl(img))}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="bg-paper border border-dashed border-hairline p-8 flex flex-col items-center text-ink-muted">
                      <Package className="w-12 h-12 mb-2" />
                      <p className="text-sm">No photos available</p>
                    </div>
                  )}
                </div>

                {/* Return / Rejection Photo */}
                {order.returnImage && (
                  <div className="bg-paper-raised border border-hairline p-6">
                    <h3 className="text-sm font-bold text-brass uppercase tracking-wide mb-4 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4" /> Defect / Return Photo
                    </h3>
                    <img
                      src={imgUrl(order.returnImage)}
                      alt="Return defect"
                      className="w-full border border-brass/40 cursor-pointer hover:opacity-90 transition object-cover max-h-72"
                      onClick={() => setLightboxImg(imgUrl(order.returnImage!))}
                    />
                    <p className="text-xs text-ink-muted mt-2">Click to view full size</p>
                  </div>
                )}
              </div>

              {/* ── RIGHT COLUMN: Order Info ── */}
              <div className="lg:col-span-2 space-y-6">

                {/* Order Summary Grid */}
                <div className="bg-paper-raised border border-hairline overflow-hidden">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-hairline">
                    <div className="bg-paper-raised p-5">
                      <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1">Quantity</p>
                      <p className="text-2xl font-bold text-ink font-mono tabular-nums">{order.quantity}</p>
                    </div>
                    <div className="bg-paper-raised p-5">
                      <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1">Unit Price</p>
                      <p className="text-2xl font-bold text-ink font-mono tabular-nums">Rs.{order.product?.price || Math.round(order.totalPrice / order.quantity)}</p>
                    </div>
                    <div className="bg-paper-raised p-5">
                      <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1">Total</p>
                      <p className="text-2xl font-bold text-brass font-mono tabular-nums">Rs.{order.totalPrice}</p>
                    </div>
                    <div className="bg-paper-raised p-5">
                      <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1">Category</p>
                      <p className="text-lg font-bold text-ink">{order.product?.category || "—"}</p>
                    </div>
                  </div>
                </div>

                {/* Variant / Color / Size */}
                {(order.color || order.size || order.variants?.storage || order.variants?.ram) && (
                  <div className="bg-paper-raised border border-hairline p-6">
                    <h3 className="text-sm font-bold text-ink-muted uppercase tracking-wide mb-4 flex items-center gap-2">
                      <Tag className="w-4 h-4 text-brass" /> Selected Options
                    </h3>
                    <div className="flex flex-wrap gap-3">
                      {(order.color || order.variants?.color) && (
                        <span className="px-4 py-2 bg-paper border border-hairline text-sm font-semibold text-ink">
                          Color: {order.color || order.variants?.color}
                        </span>
                      )}
                      {order.size && (
                        <span className="px-4 py-2 bg-paper border border-hairline text-sm font-semibold text-ink">
                          Size: {order.size}
                        </span>
                      )}
                      {order.variants?.storage && (
                        <span className="px-4 py-2 bg-paper border border-hairline text-sm font-semibold text-ink">
                          Storage: {order.variants.storage}
                        </span>
                      )}
                      {order.variants?.ram && (
                        <span className="px-4 py-2 bg-paper border border-hairline text-sm font-semibold text-ink">
                          RAM: {order.variants.ram}
                        </span>
                      )}
                      {order.variants?.processor && (
                        <span className="px-4 py-2 bg-paper border border-hairline text-sm font-semibold text-ink">
                          Processor: {order.variants.processor}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Customer & Delivery */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-paper-raised border border-hairline p-6">
                    <h3 className="text-sm font-bold text-ink-muted uppercase tracking-wide mb-4 flex items-center gap-2">
                      <User className="w-4 h-4 text-brass" /> Customer
                    </h3>
                    <div className="space-y-2 text-sm text-ink">
                      <p><span className="font-semibold">Name:</span> {order.firstName} {order.lastName}</p>
                      <p><span className="font-semibold">Email:</span> {order.email}</p>
                    </div>
                  </div>

                  <div className="bg-paper-raised border border-hairline p-6">
                    <h3 className="text-sm font-bold text-ink-muted uppercase tracking-wide mb-4 flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-brass" /> Delivery Address
                    </h3>
                    {order.deliveryAddress ? (
                      <div className="space-y-1 text-sm text-ink">
                        {order.deliveryAddress.street && <p>{order.deliveryAddress.street}</p>}
                        <p>{[order.deliveryAddress.city, order.deliveryAddress.state].filter(Boolean).join(", ")}</p>
                        <p>{[order.deliveryAddress.zipCode, order.deliveryAddress.country].filter(Boolean).join(", ")}</p>
                      </div>
                    ) : (
                      <p className="text-sm text-ink-muted">No address provided</p>
                    )}
                  </div>
                </div>

                {/* Seller Info */}
                {seller && (
                  <div className="bg-paper-raised border border-hairline p-6">
                    <h3 className="text-sm font-bold text-ink-muted uppercase tracking-wide mb-4 flex items-center gap-2">
                      <Store className="w-4 h-4 text-brass" /> Seller
                    </h3>
                    <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                      <div className="bg-brass/10 border border-brass/30 p-3 shrink-0">
                        <ShoppingBag className="w-8 h-8 text-brass" />
                      </div>
                      <div className="space-y-1 text-sm text-ink">
                        <p className="font-bold text-base text-ink">{seller.shopName || `${seller.firstName} ${seller.lastName}`}</p>
                        {seller.shopDescription && <p className="text-ink-muted">{seller.shopDescription}</p>}
                        <p><span className="font-semibold">Contact:</span> {seller.email}</p>
                        {seller.phone && <p><span className="font-semibold">Phone:</span> {seller.phone}</p>}
                      </div>
                    </div>
                  </div>
                )}

                {/* Promo Code */}
                {order.promoCode?.code && (
                  <div className="bg-paper-raised border border-hairline p-6">
                    <h3 className="text-sm font-bold text-ink-muted uppercase tracking-wide mb-3 flex items-center gap-2">
                      <CreditCard className="w-4 h-4 text-brass" /> Promo Applied
                    </h3>
                    <div className="flex items-center gap-3">
                      <span className="px-3 py-1 border border-moss text-moss font-bold text-sm font-mono tabular-nums">{order.promoCode.code}</span>
                      <span className="text-sm text-ink-muted">Discount: Rs.<span className="font-mono tabular-nums">{order.promoCode.discountAmount}</span></span>
                    </div>
                  </div>
                )}

                {/* Return Reason */}
                {order.returnReason && (
                  <div className="bg-paper-raised border border-hairline p-6">
                    <h3 className="text-sm font-bold text-brass uppercase tracking-wide mb-3 flex items-center gap-2">
                      <RotateCcw className="w-4 h-4" /> Return Reason
                    </h3>
                    <p className="text-sm text-ink">{order.returnReason}</p>
                  </div>
                )}

                {/* Timeline */}
                <div className="bg-paper-raised border border-hairline p-6">
                  <h3 className="text-sm font-bold text-ink-muted uppercase tracking-wide mb-4 flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-brass" /> Order Timeline
                  </h3>
                  <div className="space-y-3">
                    {[
                      { label: "Ordered", date: order.createdAt, color: "bg-ink-muted" },
                      { label: "Confirmed", date: order.confirmedAt, color: "bg-ink-muted" },
                      { label: "Processing", date: order.processingAt, color: "bg-brass" },
                      { label: "Shipped", date: order.shippedAt, color: "bg-brass" },
                      { label: "Delivered", date: order.deliveredAt, color: "bg-moss" },
                      { label: "Cancelled", date: order.cancelledAt, color: "bg-seal" },
                      { label: "Return Requested", date: order.returnRequestedAt, color: "bg-brass" },
                      { label: "Refund Released", date: order.refundReleasedAt, color: "bg-moss" },
                    ]
                      .filter((e) => e.date)
                      .map((e, i) => (
                        <div key={i} className="flex items-center gap-3">
                          <div className={`w-3 h-3 rounded-full ${e.color} shrink-0`} />
                          <span className="text-sm font-semibold text-ink w-36">{e.label}</span>
                          <span className="text-sm text-ink-muted font-mono tabular-nums">{formatDateTime(e.date)}</span>
                        </div>
                      ))}
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full bg-hairline border border-brass/60 shrink-0" />
                      <span className="text-sm font-semibold text-ink w-36">Expected Delivery</span>
                      <span className="text-sm text-ink-muted font-mono tabular-nums">{formatDate(order.deliveryDate)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  /* ═══════════════════════════════════════════════════════════
     ALL ORDERS LIST (fallback when no orderId in URL)
     ═══════════════════════════════════════════════════════════ */
  return (
    <>
      <NavBar />
      <div className="min-h-screen bg-paper">
        {/* Header */}
        <div className="bg-ink text-paper py-6 sm:py-8 border-b border-brass/40">
          <div className="container mx-auto px-4 sm:px-6">
            <div className="flex items-center gap-3 mb-1">
              <button onClick={() => navigate(-1)} className="p-2 hover:text-brass transition-colors shrink-0" title="Go back">
                <ArrowLeft className="w-5 h-5 sm:w-6 sm:h-6" />
              </button>
              <h1 className="font-display text-2xl sm:text-4xl font-bold">Order Details</h1>
            </div>
            <p className="text-paper/60 text-sm ml-11">View and manage all customer orders</p>
          </div>
        </div>

        {/* Content */}
        <div className="container mx-auto px-4 sm:px-6 py-6 sm:py-10">
          {orders.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-hairline">
              <Package className="w-16 h-16 mx-auto mb-4 text-ink-muted/40" />
              <h2 className="font-display text-2xl font-bold text-ink mb-2">No Orders Found</h2>
              <p className="text-ink-muted">No orders to display at this time.</p>
            </div>
          ) : (
            <>
              <p className="text-ink-muted text-sm mb-6">Total Orders: <span className="font-bold text-ink font-mono tabular-nums">{orders.length}</span></p>
              <div className="grid grid-cols-1 gap-6">
                {orders.map((o) => (
                  <div key={o._id} className="bg-paper-raised border border-hairline overflow-hidden">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between p-6 border-b border-hairline">
                      <div>
                        <h3 className="text-xl font-bold text-ink mb-1">{o.product?.name || "Product"}</h3>
                        <p className="text-sm text-ink-muted font-mono tabular-nums">ID: {o._id.slice(-8)}</p>
                      </div>
                      <div className={`inline-flex items-center gap-2 px-4 py-2 border font-semibold mt-3 md:mt-0 ${getStatusColor(o.status)}`}>
                        {getStatusIcon(o.status)}
                        <span>{o.status || "Unknown"}</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-6 p-6 bg-paper">
                      <div>
                        <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1">Customer</p>
                        <p className="text-lg font-bold text-ink">{o.firstName} {o.lastName}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1">Qty</p>
                        <p className="text-2xl font-bold text-ink font-mono tabular-nums">{o.quantity}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1">Color</p>
                        <p className="text-lg font-bold text-ink">{o.color || o.variants?.color || "—"}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1">Delivery</p>
                        <p className="text-lg font-bold text-brass font-mono tabular-nums">{formatDate(o.deliveryDate)}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1">Total</p>
                        <p className="text-2xl font-bold text-ink font-mono tabular-nums">Rs.{o.totalPrice}</p>
                      </div>
                    </div>
                    <div className="p-6">
                      <button
                        onClick={() => navigate(`/order/${o._id}`)}
                        className="px-6 py-2 bg-brass text-white hover:bg-brass-dark active:scale-[0.97] transition font-semibold"
                      >
                        View Details
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default OrderDetails;
