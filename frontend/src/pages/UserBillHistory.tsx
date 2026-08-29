import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Download, RefreshCw, ArrowLeft, Eye, X } from 'lucide-react';
import axios from 'axios';
import { toast } from 'sonner';
import NavBar from '../components/NavBar';

interface Bill {
  _id: string;
  billNumber: string;
  orderId: string;
  customerName: string;
  customerEmail: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  adminCommission: number;
  deliveryAddress: {
    street?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    country?: string;
  };
  deliveryDate: string;
  orderDate: string;
  status: string;
}

const UserBillHistory = () => {
  const navigate = useNavigate();
  const token = localStorage.getItem('token');
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBill, setSelectedBill] = useState<Bill | null>(null);
  const [showBillPreview, setShowBillPreview] = useState(false);

  useEffect(() => {
    if (!token) {
      window.location.hash = '/auth';
      return;
    }
    fetchBills();
  }, [token]);

  const fetchBills = async () => {
    try {
      setLoading(true);
      const response = await axios.get(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/order/user/bills`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      setBills(response.data.bills || []);
    } catch (error: any) {
      console.error('Error fetching bills:', error);
      toast.error(error.response?.data?.message || 'Failed to load bills');
    } finally {
      setLoading(false);
    }
  };

  const downloadBillPDF = (bill: Bill) => {
    // Create a simple HTML bill for printing/PDF
    const billHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Bill - ${bill.billNumber}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          .header { text-align: center; margin-bottom: 30px; }
          .logo { font-size: 24px; font-weight: bold; color: #0F766E; }
          .bill-number { color: #666; }
          .section { margin: 20px 0; }
          .section-title { font-weight: bold; font-size: 14px; margin-bottom: 10px; border-bottom: 1px solid #ddd; padding-bottom: 5px; }
          .row { display: flex; justify-content: space-between; padding: 5px 0; }
          .label { color: #666; }
          .amount { font-weight: bold; }
          .total { background: #f0f0f0; padding: 10px; margin: 10px 0; }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
          th { background: #f9f9f9; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="logo">ShopSphere</div>
          <div class="bill-number">Bill #${bill.billNumber}</div>
        </div>

        <div class="section">
          <div class="section-title">Bill To:</div>
          <div class="row">
            <div>
              <strong>${bill.customerName}</strong><br>
              ${bill.customerEmail}<br>
              ${bill.deliveryAddress?.street || ''}<br>
              ${bill.deliveryAddress?.city || ''}, ${bill.deliveryAddress?.state || ''} ${bill.deliveryAddress?.zipCode || ''}<br>
              ${bill.deliveryAddress?.country || ''}
            </div>
          </div>
        </div>

        <div class="section">
          <div class="section-title">Order Details:</div>
          <table>
            <tr>
              <th>Item</th>
              <th>Quantity</th>
              <th>Unit Price</th>
              <th>Total</th>
            </tr>
            <tr>
              <td>${bill.productName}</td>
              <td>${bill.quantity}</td>
              <td>रु ${bill.unitPrice.toLocaleString()}</td>
              <td>रु ${(bill.quantity * bill.unitPrice).toLocaleString()}</td>
            </tr>
          </table>
        </div>

        <div class="section">
          <div class="section-title">Summary:</div>
          <div class="row">
            <span class="label">Subtotal:</span>
            <span class="amount">रु ${bill.totalPrice.toLocaleString()}</span>
          </div>
          <div class="row">
            <span class="label">Admin Commission (5%):</span>
            <span class="amount">-रु ${bill.adminCommission.toLocaleString()}</span>
          </div>
          <div class="total">
            <div class="row">
              <span class="label">Total Amount:</span>
              <span class="amount" style="font-size: 16px; color: #0F766E;">रु ${bill.totalPrice.toLocaleString()}</span>
            </div>
          </div>
        </div>

        <div class="section">
          <div class="section-title">Delivery Information:</div>
          <div class="row">
            <span class="label">Delivery Date:</span>
            <span>${new Date(bill.deliveryDate).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            })}</span>
          </div>
          <div class="row">
            <span class="label">Order Date:</span>
            <span>${new Date(bill.orderDate).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            })}</span>
          </div>
          <div class="row">
            <span class="label">Status:</span>
            <span style="color: #16A34A; font-weight: bold;">${bill.status}</span>
          </div>
        </div>

        <div style="margin-top: 40px; color: #999; text-align: center; font-size: 12px;">
          <p>Thank you for shopping with ShopSphere!</p>
          <p>Generated on ${new Date().toLocaleDateString()}</p>
        </div>
      </body>
      </html>
    `;

    const printWindow = window.open('', '', 'height=600,width=800');
    printWindow?.document.write(billHTML);
    printWindow?.document.close();
    printWindow?.print();
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <>
      <NavBar />
      <div className="min-h-screen bg-paper">
        {/* Header */}
        <div className="bg-ink text-paper py-6 sm:py-8 border-b border-brass/40">
          <div className="container mx-auto px-4 sm:px-6">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => navigate('/my-orders')}
                  className="flex items-center gap-2 text-paper/70 hover:text-brass transition"
                >
                  <ArrowLeft className="w-5 h-5" />
                  Back
                </button>
                <div>
                  <h1 className="font-display text-2xl sm:text-4xl font-bold mb-1">My Bills</h1>
                  <p className="text-paper/60 text-sm">View and download your purchase bills</p>
                </div>
              </div>
              <button
                onClick={fetchBills}
                disabled={loading}
                className="flex items-center gap-2 bg-brass hover:bg-brass-dark disabled:opacity-50 text-ink transition px-4 sm:px-6 py-3 font-semibold active:scale-[0.97]"
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
                <p className="text-ink-muted">Loading bills...</p>
              </div>
            </div>
          ) : bills.length === 0 ? (
            <div className="border border-dashed border-hairline p-12 text-center">
              <FileText className="w-16 h-16 text-ink-muted/40 mx-auto mb-6" />
              <h2 className="font-display text-2xl font-bold text-ink mb-2">No Bills Found</h2>
              <p className="text-ink-muted">You haven't made any purchases yet.</p>
            </div>
          ) : (
            <div className="bg-paper-raised border border-hairline">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b-2 border-ink">
                      <th className="p-4 text-left font-semibold text-ink text-xs uppercase tracking-wide">Bill #</th>
                      <th className="p-4 text-left font-semibold text-ink text-xs uppercase tracking-wide">Product</th>
                      <th className="p-4 text-left font-semibold text-ink text-xs uppercase tracking-wide">Quantity</th>
                      <th className="p-4 text-left font-semibold text-ink text-xs uppercase tracking-wide">Total Amount</th>
                      <th className="p-4 text-left font-semibold text-ink text-xs uppercase tracking-wide">Order Date</th>
                      <th className="p-4 text-left font-semibold text-ink text-xs uppercase tracking-wide">Status</th>
                      <th className="p-4 text-left font-semibold text-ink text-xs uppercase tracking-wide">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bills.map((bill) => (
                      <tr key={bill._id} className="border-b border-hairline hover:bg-paper transition-colors">
                        <td className="p-4 font-semibold text-ink font-mono tabular-nums">{bill.billNumber}</td>
                        <td className="p-4 text-ink">{bill.productName}</td>
                        <td className="p-4 text-ink font-mono tabular-nums">{bill.quantity}</td>
                        <td className="p-4">
                          <span className="font-bold text-ink font-mono tabular-nums">
                            रु {bill.totalPrice.toLocaleString()}
                          </span>
                        </td>
                        <td className="p-4 text-ink-muted font-mono tabular-nums">
                          {formatDate(bill.orderDate)}
                        </td>
                        <td className="p-4">
                          <span className="inline-block px-3 py-1 border border-moss text-moss text-xs font-semibold uppercase tracking-wide">
                            {bill.status}
                          </span>
                        </td>
                        <td className="p-4">
                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                setSelectedBill(bill);
                                setShowBillPreview(true);
                              }}
                              className="flex items-center gap-1 px-3 py-2 border border-ink text-ink hover:bg-ink hover:text-paper active:scale-[0.98] transition text-sm font-semibold"
                            >
                              <Eye className="w-4 h-4" />
                              View
                            </button>
                            <button
                              onClick={() => downloadBillPDF(bill)}
                              className="flex items-center gap-1 px-3 py-2 bg-brass hover:bg-brass-dark text-ink active:scale-[0.97] transition text-sm font-semibold"
                            >
                              <Download className="w-4 h-4" />
                              Download
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Bill Preview Modal */}
        {showBillPreview && selectedBill && (
          <div className="fixed inset-0 bg-ink/60 flex items-center justify-center z-50 p-4">
            <div className="bg-paper-raised border border-hairline max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              {/* Header */}
              <div className="bg-ink text-paper p-6 flex justify-between items-center sticky top-0 border-b border-brass/40">
                <h2 className="font-display text-2xl font-bold">Bill Preview</h2>
                <button
                  onClick={() => {
                    setShowBillPreview(false);
                    setSelectedBill(null);
                  }}
                  className="hover:text-brass transition"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              {/* Bill Content */}
              <div className="p-4 sm:p-8">
                {/* Logo */}
                <div className="text-center mb-6 sm:mb-8 pb-6 border-b-2 border-ink">
                  <h1 className="font-display text-3xl font-bold text-brass mb-2">ShopSphere</h1>
                  <p className="text-ink-muted font-mono tabular-nums">Invoice #{selectedBill.billNumber}</p>
                </div>

                {/* Bill To */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-8 mb-6 sm:mb-8">
                  <div>
                    <h3 className="font-bold text-ink mb-2">Bill To:</h3>
                    <p className="font-semibold text-ink">{selectedBill.customerName}</p>
                    <p className="text-ink-muted">{selectedBill.customerEmail}</p>
                    <p className="text-ink-muted text-sm mt-2">
                      {selectedBill.deliveryAddress?.street}<br />
                      {selectedBill.deliveryAddress?.city}, {selectedBill.deliveryAddress?.state}{' '}
                      {selectedBill.deliveryAddress?.zipCode}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-ink-muted">Order Date:</p>
                    <p className="font-semibold text-ink font-mono tabular-nums">
                      {formatDate(selectedBill.orderDate)}
                    </p>
                    <p className="text-ink-muted mt-4">Delivery Date:</p>
                    <p className="font-semibold text-ink font-mono tabular-nums">
                      {formatDate(selectedBill.deliveryDate)}
                    </p>
                  </div>
                </div>

                {/* Items Table */}
                <div className="mb-8">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="border-b-2 border-ink">
                        <th className="text-left py-2 text-ink font-semibold text-xs uppercase tracking-wide">Product</th>
                        <th className="text-center py-2 text-ink font-semibold text-xs uppercase tracking-wide">Quantity</th>
                        <th className="text-right py-2 text-ink font-semibold text-xs uppercase tracking-wide">Unit Price</th>
                        <th className="text-right py-2 text-ink font-semibold text-xs uppercase tracking-wide">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-hairline hover:bg-paper transition-colors">
                        <td className="py-3 text-ink">{selectedBill.productName}</td>
                        <td className="text-center py-3 text-ink font-mono tabular-nums">{selectedBill.quantity}</td>
                        <td className="text-right py-3 text-ink font-mono tabular-nums">
                          रु {selectedBill.unitPrice.toLocaleString()}
                        </td>
                        <td className="text-right py-3 font-bold text-ink font-mono tabular-nums">
                          रु {(selectedBill.quantity * selectedBill.unitPrice).toLocaleString()}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Summary */}
                <div className="flex justify-end mb-8">
                  <div className="w-full sm:w-80">
                    <div className="flex justify-between py-2 border-b border-hairline">
                      <span className="text-ink-muted">Subtotal</span>
                      <span className="text-ink font-mono tabular-nums">रु {selectedBill.totalPrice.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-hairline">
                      <span className="text-ink-muted">Admin Commission (5%)</span>
                      <span className="text-ink font-mono tabular-nums">-रु {selectedBill.adminCommission.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between py-3 border-t-2 border-ink mt-2 pt-4">
                      <span className="font-bold text-ink">Total Amount</span>
                      <span className="font-bold text-brass text-lg font-mono tabular-nums">
                        रु {selectedBill.totalPrice.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Footer */}
                <div className="text-center text-sm text-ink-muted border-t border-hairline pt-6">
                  <p>Thank you for shopping with ShopSphere!</p>
                  <p>This is a computer-generated bill. No signature is required.</p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="bg-paper p-6 flex gap-3 justify-end border-t border-hairline">
                <button
                  onClick={() => {
                    setShowBillPreview(false);
                    setSelectedBill(null);
                  }}
                  className="px-6 py-2 border border-ink text-ink hover:bg-ink hover:text-paper active:scale-[0.98] font-semibold transition"
                >
                  Close
                </button>
                <button
                  onClick={() => {
                    downloadBillPDF(selectedBill);
                  }}
                  className="flex items-center gap-2 px-6 py-2 bg-brass hover:bg-brass-dark text-ink font-semibold active:scale-[0.97] transition"
                >
                  <Download className="w-4 h-4" />
                  Download PDF
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default UserBillHistory;
