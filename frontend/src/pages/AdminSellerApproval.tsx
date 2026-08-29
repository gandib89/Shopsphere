import { useState, useEffect } from 'react';
import { CheckCircle, XCircle, Clock, RefreshCw, Mail, Phone, Store } from 'lucide-react';
import axios from 'axios';
import { toast } from 'sonner';
import NavBar from '../components/NavBar';

interface Seller {
  _id: string;
  shopName: string;
  email: string;
  phone?: string;
  createdAt: string;
  verificationRequestDate?: string;
  verificationRejectionReason?: string;
  isVerified: boolean;
}

const AdminSellerApproval = () => {
  const token = localStorage.getItem('token');
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState<{ [key: string]: string }>({});
  const [showRejectModal, setShowRejectModal] = useState<string | null>(null);

  useEffect(() => {
    if (!token || localStorage.getItem('isAdmin') !== 'true') {
      window.location.hash = '/auth';
      return;
    }
    fetchUnverifiedSellers();
  }, [token]);

  const fetchUnverifiedSellers = async () => {
    try {
      setLoading(true);
      const response = await axios.get(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/auth/unverified-sellers`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      // Handle both array and object with sellers property
      const sellersList = Array.isArray(response.data) ? response.data : (response.data.sellers || []);
      setSellers(sellersList);
    } catch (error: any) {
      console.error('Error fetching sellers:', error);
      toast.error(error.response?.data?.message || 'Failed to load sellers');
      setSellers([]);
    } finally {
      setLoading(false);
    }
  };

  const handleApproveSeller = async (sellerId: string) => {
    try {
      setProcessingId(sellerId);
      await axios.put(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/auth/verify-seller/${sellerId}`,
        {},
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      toast.success('Seller approved successfully!');
      setSellers(sellers.filter(s => s._id !== sellerId));
    } catch (error: any) {
      console.error('Error approving seller:', error);
      toast.error(error.response?.data?.message || 'Failed to approve seller');
    } finally {
      setProcessingId(null);
    }
  };

  const handleRejectSeller = async (sellerId: string) => {
    try {
      setProcessingId(sellerId);
      const reason = rejectionReason[sellerId] || 'Not specified';

      await axios.put(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/auth/reject-seller/${sellerId}`,
        { reason },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      toast.success('Seller rejected successfully!');
      setSellers(sellers.filter(s => s._id !== sellerId));
      setShowRejectModal(null);
      setRejectionReason({});
    } catch (error: any) {
      console.error('Error rejecting seller:', error);
      toast.error(error.response?.data?.message || 'Failed to reject seller');
    } finally {
      setProcessingId(null);
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
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
            <div className="flex items-center justify-between gap-4">
              <div>
                <h1 className="font-display text-2xl sm:text-4xl font-bold mb-1">Seller Verification</h1>
                <p className="text-paper/60 text-sm">Approve or reject new seller applications</p>
              </div>
              <button
                onClick={fetchUnverifiedSellers}
                disabled={loading}
                className="flex items-center gap-2 border border-brass text-brass hover:bg-brass hover:text-white disabled:opacity-40 active:scale-[0.97] transition px-3 sm:px-6 py-2.5 sm:py-3 font-semibold text-sm shrink-0"
              >
                <RefreshCw className={`w-4 h-4 sm:w-5 sm:h-5 ${loading ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">Refresh</span>
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
                <p className="text-ink-muted">Loading sellers...</p>
              </div>
            </div>
          ) : sellers.length === 0 ? (
            <div className="border border-dashed border-hairline p-12 text-center">
              <CheckCircle className="w-16 h-16 text-moss mx-auto mb-4" />
              <h2 className="text-2xl font-bold text-ink mb-2">All Sellers Verified!</h2>
              <p className="text-ink-muted">There are no pending seller applications to review.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6">
              {/* Stats */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                <div className="bg-paper-raised border border-hairline p-6">
                  <Clock className="w-8 h-8 text-brass mb-2" />
                  <div className="text-3xl font-bold text-ink font-mono tabular-nums">{sellers.length}</div>
                  <p className="text-ink-muted text-sm">Pending Approvals</p>
                </div>
                <div className="bg-paper-raised border border-hairline p-6">
                  <Store className="w-8 h-8 text-ink-muted mb-2" />
                  <div className="text-3xl font-bold text-ink font-mono tabular-nums">{sellers.length}</div>
                  <p className="text-ink-muted text-sm">Total Applicants</p>
                </div>
                <div className="bg-paper-raised border border-hairline p-6">
                  <CheckCircle className="w-8 h-8 text-moss mb-2" />
                  <div className="text-3xl font-bold text-moss font-mono tabular-nums">0</div>
                  <p className="text-ink-muted text-sm">This Session</p>
                </div>
              </div>

              {/* Sellers List */}
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b-2 border-ink">
                      <th className="p-4 text-left font-semibold text-ink text-xs uppercase tracking-wide">Shop Name</th>
                      <th className="p-4 text-left font-semibold text-ink text-xs uppercase tracking-wide">Email</th>
                      <th className="p-4 text-left font-semibold text-ink text-xs uppercase tracking-wide">Phone</th>
                      <th className="p-4 text-left font-semibold text-ink text-xs uppercase tracking-wide">Applied On</th>
                      <th className="p-4 text-left font-semibold text-ink text-xs uppercase tracking-wide">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sellers.map((seller) => (
                      <tr key={seller._id} className="border-b border-hairline hover:bg-paper-raised transition-colors">
                        <td className="p-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 border border-hairline flex items-center justify-center shrink-0">
                              <Store className="w-5 h-5 text-brass" />
                            </div>
                            <span className="font-semibold text-ink">{seller.shopName}</span>
                          </div>
                        </td>
                        <td className="p-4">
                          <div className="flex items-center gap-2 text-ink-muted text-sm">
                            <Mail className="w-4 h-4 text-ink-muted" />
                            {seller.email}
                          </div>
                        </td>
                        <td className="p-4">
                          <div className="flex items-center gap-2 text-ink-muted text-sm">
                            <Phone className="w-4 h-4 text-ink-muted" />
                            {seller.phone || 'N/A'}
                          </div>
                        </td>
                        <td className="p-4 text-sm text-ink-muted font-mono tabular-nums">
                          {formatDate(seller.verificationRequestDate || seller.createdAt)}
                        </td>
                        <td className="p-4">
                          <div className="flex gap-3">
                            <button
                              onClick={() => handleApproveSeller(seller._id)}
                              disabled={processingId === seller._id}
                              className="flex items-center gap-2 bg-moss text-paper hover:opacity-90 disabled:opacity-40 active:scale-[0.98] transition font-semibold px-4 py-2 text-sm"
                            >
                              <CheckCircle className="w-4 h-4" />
                              {processingId === seller._id ? 'Processing...' : 'Approve'}
                            </button>
                            <button
                              onClick={() => setShowRejectModal(seller._id)}
                              disabled={processingId === seller._id}
                              className="flex items-center gap-2 bg-seal text-paper hover:opacity-90 disabled:opacity-40 active:scale-[0.98] transition font-semibold px-4 py-2 text-sm"
                            >
                              <XCircle className="w-4 h-4" />
                              {processingId === seller._id ? 'Processing...' : 'Reject'}
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

        {/* Reject Modal */}
        {showRejectModal && (
          <div className="fixed inset-0 bg-ink/50 flex items-center justify-center z-50 p-4 animate-overlay-in">
            <div className="bg-paper-raised border border-hairline max-w-md w-full animate-panel-in">
              <div className="bg-ink text-paper p-6 border-b border-seal/40">
                <h2 className="text-2xl font-bold flex items-center gap-2">
                  <XCircle className="w-6 h-6 text-seal" />
                  Reject Seller
                </h2>
              </div>
              <div className="p-6">
                <p className="text-ink-muted mb-4">
                  Please provide a reason for rejecting this seller application:
                </p>
                <textarea
                  value={rejectionReason[showRejectModal] || ''}
                  onChange={(e) =>
                    setRejectionReason({
                      ...rejectionReason,
                      [showRejectModal]: e.target.value,
                    })
                  }
                  placeholder="Enter rejection reason..."
                  className="w-full px-4 py-3 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition mb-4 resize-none"
                  rows={4}
                />
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setShowRejectModal(null);
                      setRejectionReason({});
                    }}
                    className="flex-1 px-4 py-2 border border-ink text-ink hover:bg-ink hover:text-paper active:scale-[0.98] transition font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleRejectSeller(showRejectModal)}
                    disabled={processingId === showRejectModal}
                    className="flex-1 px-4 py-2 bg-seal text-paper hover:opacity-90 disabled:opacity-40 active:scale-[0.98] transition font-semibold"
                  >
                    {processingId === showRejectModal ? 'Processing...' : 'Confirm Rejection'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default AdminSellerApproval;
