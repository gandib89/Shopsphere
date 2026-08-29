import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Truck, CheckCircle, Clock, RotateCcw, Banknote, Package, XCircle, Filter, CornerDownLeft, AlertCircle, Ban, Check } from 'lucide-react';
import axios from 'axios';
import { toast } from 'sonner';
import NavBar from '../components/NavBar';

interface Order {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  deliveryAddress?: {
    street?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    country?: string;
  };
  product: {
    _id: string;
    name: string;
    price: number;
  };
  quantity: number;
  totalPrice: number;
  status: string;
  createdAt: string;
  deliveryDate: string;
  color?: string;
  variants?: {
    color?: string;
    storage?: string;
  };
  // return fields
  returnReason?: string;
  returnImage?: string;
}

function SellerOrders() {
  const token = localStorage.getItem('token');
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<string>('all');

  type FilterCategory = {
    key: string;
    label: string;
    icon: React.ReactNode;
    statuses: string[];
  };

  const filterCategories: FilterCategory[] = [
    { key: 'all', label: 'All', icon: <Package className="w-4 h-4" />, statuses: [] },
    { key: 'active', label: 'Active', icon: <Clock className="w-4 h-4" />, statuses: ['Pending', 'Confirmed', 'Processing'] },
    { key: 'shipped', label: 'Shipped', icon: <Truck className="w-4 h-4" />, statuses: ['Shipped'] },
    { key: 'delivered', label: 'Delivered', icon: <CheckCircle className="w-4 h-4" />, statuses: ['Delivered'] },
    { key: 'cancelled', label: 'Cancelled', icon: <XCircle className="w-4 h-4" />, statuses: ['Cancelled'] },
    { key: 'returns', label: 'Returns', icon: <CornerDownLeft className="w-4 h-4" />, statuses: ['Return Requested', 'Return Approved', 'Return Rejected', 'Refund Released'] },
  ];

  const getFilteredOrders = () => {
    if (activeFilter === 'all') return orders;
    const category = filterCategories.find((c) => c.key === activeFilter);
    if (!category) return orders;
    return orders.filter((o) => category.statuses.includes(o.status));
  };

  const getCountForFilter = (key: string) => {
    if (key === 'all') return orders.length;
    const category = filterCategories.find((c) => c.key === key);
    if (!category) return 0;
    return orders.filter((o) => category.statuses.includes(o.status)).length;
  };

  useEffect(() => {
    if (!token || localStorage.getItem('isSeller') !== 'true') {
      window.location.hash = '/auth';
      return;
    }

    fetchSellerOrders();
  }, [token]);

  const fetchSellerOrders = async () => {
    try {
      const res = await axios.get(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/order/seller/my-orders`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      // Sort by delivery date (earliest first)
      const sorted = [...(res.data.orders as Order[])].sort(
        (a, b) => new Date(a.deliveryDate).getTime() - new Date(b.deliveryDate).getTime()
      );
      setOrders(sorted);
    } catch (err) {
      console.error('Error fetching orders:', err);
      toast.error('Failed to fetch orders');
    } finally {
      setLoading(false);
    }
  };

  const handleStatusUpdate = async (orderId: string, status: string) => {
    try {
      await axios.put(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/order/seller/update-status/${orderId}`,
        { status },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      toast.success('Order status updated successfully');
      setOrders(orders.map(o => o._id === orderId ? { ...o, status } : o));
      setSelectedOrder(null);
    } catch (err) {
      console.error('Error updating status:', err);
      toast.error('Failed to update status');
    }
  };

  // allow seller to approve/reject return requests
  const handleSellerReturn = async (orderId: string, action: 'approve' | 'reject') => {
    if (!window.confirm(`Are you sure you want to ${action} this return request?`)) return;
    try {
      await axios.put(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/order/seller/return/${orderId}`,
        { action },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const newStatus = action === 'approve' ? 'Return Approved' : 'Return Rejected';
      setOrders((prev) => prev.map((o) => o._id === orderId ? { ...o, status: newStatus } : o));
      toast.success(`Return ${action === 'approve' ? 'approved' : 'rejected'} successfully`);
    } catch (err: any) {
      console.error('Error processing seller return:', err);
      toast.error(err.response?.data?.message || 'Failed to process return');
    }
  };

  // Status badges collapse to four semantic buckets, matching AdminOrders.
  const getStatusColor = (status: string): string => {
    switch (status?.toLowerCase()) {
      case 'shipped':
      case 'return requested':
      case 'return approved':   return 'border-brass text-brass';
      case 'delivered':
      case 'refund released':   return 'border-moss text-moss';
      case 'cancelled':
      case 'return rejected':   return 'border-seal text-seal';
      default:                  return 'border-hairline text-ink-muted';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'pending':          return <Clock className="w-4 h-4" />;
      case 'processing':       return <AlertCircle className="w-4 h-4" />;
      case 'shipped':          return <Truck className="w-4 h-4" />;
      case 'delivered':        return <CheckCircle className="w-4 h-4" />;
      case 'cancelled':        return <XCircle className="w-4 h-4" />;
      case 'return requested': return <RotateCcw className="w-4 h-4" />;
      case 'return approved':  return <CheckCircle className="w-4 h-4" />;
      case 'return rejected':  return <Ban className="w-4 h-4" />;
      case 'refund released':  return <Banknote className="w-4 h-4" />;
      default:                 return <Package className="w-4 h-4" />;
    }
  };

  // Classes for the "Mark <status>" action buttons: brass for in-progress
  // steps, moss for the positive terminal state, seal for cancellation.
  const getMarkButtonClasses = (status: string, isCurrent: boolean): string => {
    if (isCurrent) {
      if (status === 'Cancelled') return 'bg-seal text-paper border-seal cursor-default';
      if (status === 'Delivered') return 'bg-moss text-paper border-moss cursor-default';
      return 'bg-brass text-white border-brass cursor-default';
    }
    if (status === 'Cancelled') return 'border-seal text-seal hover:bg-seal/5';
    if (status === 'Delivered') return 'border-moss text-moss hover:bg-moss/5';
    return 'border-ink text-ink hover:bg-ink hover:text-paper';
  };

  const filteredOrders = getFilteredOrders();

  const formatAddress = (address?: Order['deliveryAddress']) => {
    if (!address) return 'N/A';
    const parts = [address.street, address.city, address.state, address.zipCode, address.country].filter(Boolean);
    return parts.length ? parts.join(', ') : 'N/A';
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
          <div className="container mx-auto px-4 sm:px-6">
            <div className="flex items-center gap-3 mb-1">
              <button
                onClick={() => navigate('/seller-panel')}
                className="p-2 hover:text-brass transition-colors shrink-0"
                title="Back"
              >
                <ArrowLeft className="w-5 h-5 sm:w-6 sm:h-6" />
              </button>
              <h1 className="text-2xl sm:text-4xl font-bold">Orders</h1>
            </div>
            <p className="text-paper/60 text-sm ml-11">Manage orders for your products</p>
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
                        ? 'bg-ink text-paper border-ink'
                        : 'bg-transparent text-ink-muted border-hairline hover:border-brass hover:text-brass'
                    }`}
                  >
                    {cat.icon}
                    {cat.label}
                    <span className={`ml-1 px-1.5 text-xs font-mono tabular-nums ${isActive ? 'text-brass' : 'text-ink-muted/70'}`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="container mx-auto px-4 sm:px-6 py-6 sm:py-8">
          {/* Orders Summary */}
          <div className="mb-6 flex items-center justify-between">
            <p className="text-ink-muted text-sm">
              Showing: <span className="font-bold text-ink font-mono tabular-nums">{filteredOrders.length}</span>
              {activeFilter !== 'all' && <> of <span className="font-bold text-ink font-mono tabular-nums">{orders.length}</span> orders</>}
              {activeFilter === 'all' && <> orders</>}
            </p>
            {activeFilter !== 'all' && (
              <button
                onClick={() => setActiveFilter('all')}
                className="text-sm text-brass hover:text-brass-dark font-medium flex items-center gap-1"
              >
                <XCircle className="w-3.5 h-3.5" /> Clear filter
              </button>
            )}
          </div>

          {/* Orders List */}
          {filteredOrders.length > 0 ? (
            <div className="grid grid-cols-1 gap-6">
              {filteredOrders.map((order) => (
                <div key={order._id} className="bg-paper-raised border border-hairline overflow-hidden">
                  {/* Order Header */}
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 p-6 border-b border-hairline">
                    <div>
                      <h3 className="text-lg font-bold text-ink">{order.product.name}</h3>
                      <p className="text-ink-muted text-sm font-mono tabular-nums">Order ID: {order._id.slice(-8)}</p>
                      <p className="text-ink-muted text-sm">Customer: {order.firstName} {order.lastName}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-brass font-mono tabular-nums mb-2">
                        Rs. {order.totalPrice.toLocaleString()}
                      </div>
                      <div className={`inline-flex items-center gap-2 px-3.5 py-1.5 border font-semibold text-sm ${getStatusColor(order.status)}`}>
                        {getStatusIcon(order.status)}
                        <span>{order.status}</span>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-5 gap-6 p-6 bg-paper border-b border-hairline">
                    <div>
                      <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1">Quantity</p>
                      <p className="font-semibold text-ink font-mono tabular-nums">{order.quantity}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1">Unit Price</p>
                      <p className="font-semibold text-ink font-mono tabular-nums">Rs. {order.product.price.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1">Color</p>
                      {(order.color || order.variants?.color) ? (
                        <div className="flex items-center gap-2 mt-0.5">
                          <span
                            className="w-3.5 h-3.5 border border-hairline shrink-0"
                            style={{ backgroundColor: (order.color || order.variants?.color || '').toLowerCase() }}
                          />
                          <p className="font-semibold text-ink">{order.color || order.variants?.color}</p>
                        </div>
                      ) : (
                        <p className="font-semibold text-ink">—</p>
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1">Order Date</p>
                      <p className="font-semibold text-ink text-sm font-mono tabular-nums">
                        {new Date(order.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1">Expected Delivery</p>
                      <p className="font-semibold text-brass text-sm font-mono tabular-nums">
                        {new Date(order.deliveryDate).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 bg-paper border-b border-hairline">
                    <div>
                      <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1">Delivery Location</p>
                      <p className="font-semibold text-ink">{formatAddress(order.deliveryAddress)}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1">Contact</p>
                      <p className="font-semibold text-ink break-words">{order.email}</p>
                      {order.phone && <p className="text-ink-muted text-sm">{order.phone}</p>}
                    </div>
                  </div>

                  {/* Return reason and image */}
                  {['Return Requested', 'Return Approved', 'Return Rejected', 'Refund Released'].includes(order.status) && (
                    <div className="p-6 border-b border-hairline">
                      <div className="p-4 border border-brass/40 bg-brass/5">
                        <p className="text-xs font-bold text-brass uppercase tracking-wide mb-1">Return Info</p>
                        {order.returnReason ? (
                          <p className="text-sm text-ink mb-3">{order.returnReason}</p>
                        ) : (
                          <p className="text-sm text-ink-muted italic mb-3">No reason provided</p>
                        )}
                        {order.returnImage && (
                          <div>
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

                        {/* seller return approval actions */}
                        {order.status === 'Return Requested' && (
                          <div className="mt-4 flex gap-2">
                            <button
                              onClick={() => handleSellerReturn(order._id, 'approve')}
                              className="flex-1 px-4 py-2 bg-moss text-paper hover:opacity-90 active:scale-[0.98] transition font-semibold"
                            >
                              Approve Return
                            </button>
                            <button
                              onClick={() => handleSellerReturn(order._id, 'reject')}
                              className="flex-1 px-4 py-2 bg-seal text-paper hover:opacity-90 active:scale-[0.98] transition font-semibold"
                            >
                              Reject Return
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Status Update — hide when return/cancel is terminal */}
                  {(order.status === 'Return Requested' || !['Return Approved', 'Return Rejected', 'Refund Released', 'Cancelled'].includes(order.status)) && (
                    <div className="p-6">
                      {order.status === 'Return Requested' && (
                        <p className="text-brass text-sm font-semibold mb-2 flex items-center gap-2">
                          <RotateCcw className="w-4 h-4" /> Customer requested a return — admin will review this request.
                        </p>
                      )}
                      {!['Return Approved', 'Return Rejected', 'Refund Released', 'Cancelled'].includes(order.status) && (
                        <>
                          <button
                            onClick={() => setSelectedOrder(selectedOrder === order._id ? null : order._id)}
                            className="text-brass hover:text-brass-dark font-semibold text-sm flex items-center gap-1"
                          >
                            {selectedOrder === order._id ? '▲ Close' : '▼ Update Delivery Status'}
                          </button>
                          {selectedOrder === order._id && (
                            <div className="mt-4">
                              {/* Status Steps Visual */}
                              <div className="flex items-center gap-0 mb-4 overflow-x-auto pb-2">
                                {(['Pending', 'Processing', 'Shipped', 'Delivered'] as const).map((s, i, arr) => {
                                  const stepOrder = ['Pending', 'Confirmed', 'Processing', 'Shipped', 'Delivered'];
                                  const curIdx = stepOrder.indexOf(order.status);
                                  const thisIdx = stepOrder.indexOf(s);
                                  const isCurrent = order.status === s || (s === 'Pending' && curIdx <= 0);
                                  const isDone = curIdx > thisIdx;
                                  return (
                                    <React.Fragment key={s}>
                                      <div className="flex flex-col items-center">
                                        <div
                                          className={`w-7 h-7 flex items-center justify-center text-xs font-bold font-mono border ${
                                            isDone
                                              ? 'bg-brass text-white border-brass'
                                              : isCurrent
                                              ? 'border-brass text-brass'
                                              : 'border-hairline text-ink-muted'
                                          }`}
                                        >
                                          {isDone ? <Check className="w-3.5 h-3.5" /> : i + 1}
                                        </div>
                                        <span className={`text-xs mt-1 font-medium whitespace-nowrap ${isCurrent ? 'text-brass' : isDone ? 'text-ink' : 'text-ink-muted'}`}>{s}</span>
                                      </div>
                                      {i < arr.length - 1 && (
                                        <div className={`flex-1 h-px mx-1 mb-4 ${isDone ? 'bg-brass' : 'bg-hairline'}`} style={{ minWidth: '24px' }} />
                                      )}
                                    </React.Fragment>
                                  );
                                })}
                              </div>
                              {/* Action buttons */}
                              <div className="flex flex-wrap gap-2">
                                {([
                                  ['Confirmed', 'Processing'],
                                  ['Processing', 'Shipped'],
                                  ['Shipped', 'Delivered'],
                                ] as const).filter(([current]) => order.status === current).map(([, status]) => {
                                  return (
                                    <button
                                      key={status}
                                      onClick={() => handleStatusUpdate(order._id, status)}
                                      className={`px-3.5 py-1.5 border font-semibold text-sm transition active:scale-[0.98] ${getMarkButtonClasses(status, false)}`}
                                    >
                                      {`Mark ${status}`}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="border border-dashed border-hairline p-12 text-center">
              <Truck className="w-16 h-16 text-ink-muted/40 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-ink mb-2">
                {activeFilter === 'all' ? 'No orders yet' : 'No orders in this category'}
              </h3>
              <p className="text-ink-muted">
                {activeFilter === 'all'
                  ? 'Once customers purchase your products, their orders will appear here'
                  : <button onClick={() => setActiveFilter('all')} className="text-brass font-semibold hover:text-brass-dark">Clear filter to see all orders</button>}
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default SellerOrders;
