import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Tag, Plus, Trash2, Power, Bell } from "lucide-react";
import axios from "axios";
import { toast } from "sonner";
import NavBar from "../components/NavBar";

interface PromoCode {
  _id: string;
  code: string;
  description: string;
  discountType: "percentage" | "fixed";
  discountValue: number;
  minPurchase: number;
  maxDiscount: number | null;
  usageLimit: number | null;
  usedCount: number;
  validFrom: string;
  validUntil: string;
  isActive: boolean;
  createdAt: string;
}

function PromoManagement() {
  const navigate = useNavigate();
  const token = localStorage.getItem("token");
  
  const [promoCodes, setPromoCodes] = useState<PromoCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  
  const [formData, setFormData] = useState({
    code: "",
    description: "",
    discountType: "percentage" as "percentage" | "fixed",
    discountValue: 0,
    minPurchase: 0,
    maxDiscount: "",
    usageLimit: "",
    validFrom: "",
    validUntil: "",
  });

  useEffect(() => {
    if (!token || localStorage.getItem("isAdmin") !== "true") {
      window.location.hash = "/auth";
      return;
    }
    fetchPromoCodes();
  }, [token]);

  const fetchPromoCodes = async () => {
    try {
      setLoading(true);
      const response = await axios.get(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/promo/all`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      setPromoCodes(response.data.promoCodes || []);
    } catch (error) {
      console.error("Error fetching promo codes:", error);
      toast.error("Failed to load promo codes");
    } finally {
      setLoading(false);
    }
  };

  const handleCreatePromo = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.code || !formData.description || !formData.validFrom || !formData.validUntil) {
      toast.error("Please fill in all required fields");
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        code: formData.code.toUpperCase(),
        description: formData.description,
        discountType: formData.discountType,
        discountValue: formData.discountValue,
        minPurchase: formData.minPurchase || 0,
        maxDiscount: formData.maxDiscount ? parseFloat(formData.maxDiscount) : null,
        usageLimit: formData.usageLimit ? parseInt(formData.usageLimit) : null,
        validFrom: formData.validFrom,
        validUntil: formData.validUntil,
      };

      await axios.post(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/promo/create`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      toast.success("Promo code created successfully!");
      setShowCreateForm(false);
      setFormData({
        code: "",
        description: "",
        discountType: "percentage",
        discountValue: 0,
        minPurchase: 0,
        maxDiscount: "",
        usageLimit: "",
        validFrom: "",
        validUntil: "",
      });
      fetchPromoCodes();
    } catch (error: any) {
      console.error("Error creating promo code:", error);
      toast.error(error.response?.data?.message || "Failed to create promo code");
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (id: string) => {
    try {
      await axios.put(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/promo/toggle/${id}`,
        {},
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      toast.success("Promo code status updated");
      fetchPromoCodes();
    } catch (error) {
      console.error("Error toggling promo code:", error);
      toast.error("Failed to update promo code status");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this promo code?")) return;
    
    try {
      await axios.delete(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/promo/delete/${id}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      toast.success("Promo code deleted");
      fetchPromoCodes();
    } catch (error) {
      console.error("Error deleting promo code:", error);
      toast.error("Failed to delete promo code");
    }
  };

  const handleNotifyUsers = async (id: string, code: string) => {
    if (!confirm(`Send notification about promo code "${code}" to all users?`)) return;
    
    try {
      const response = await axios.post(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/promo/notify/${id}`,
        {},
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      toast.success(response.data.message || "Notifications sent to all users");
    } catch (error: any) {
      console.error("Error sending notifications:", error);
      toast.error(error.response?.data?.message || "Failed to send notifications");
    }
  };

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
              <h1 className="text-2xl sm:text-4xl font-bold">Promo Code Management</h1>
            </div>
            <p className="text-paper/60 text-sm ml-11">Create and manage discount promo codes</p>
          </div>
        </div>

        {/* Content */}
        <div className="container mx-auto px-4 sm:px-6 py-6 sm:py-10">
          {/* Create Button */}
          <div className="mb-6">
            <button
              onClick={() => setShowCreateForm(!showCreateForm)}
              className="inline-flex items-center gap-2 bg-brass text-white hover:bg-brass-dark active:scale-[0.97] transition font-semibold px-6 py-3"
            >
              <Plus className="w-5 h-5" />
              {showCreateForm ? "Cancel" : "Create New Promo Code"}
            </button>
          </div>

          {/* Create Form */}
          {showCreateForm && (
            <div className="bg-paper-raised border border-hairline p-6 mb-6">
              <h2 className="text-xl font-bold text-ink mb-6">Create Promo Code</h2>
              <form onSubmit={handleCreatePromo} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">
                      Code *
                    </label>
                    <input
                      type="text"
                      value={formData.code}
                      onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                      placeholder="e.g., SAVE20"
                      className="w-full px-4 py-2 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition uppercase font-mono"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">
                      Description *
                    </label>
                    <input
                      type="text"
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      placeholder="e.g., 20% off your purchase"
                      className="w-full px-4 py-2 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">
                      Discount Type *
                    </label>
                    <select
                      value={formData.discountType}
                      onChange={(e) => setFormData({ ...formData, discountType: e.target.value as "percentage" | "fixed" })}
                      className="w-full px-4 py-2 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition"
                    >
                      <option value="percentage">Percentage</option>
                      <option value="fixed">Fixed Amount</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">
                      Discount Value * {formData.discountType === "percentage" ? "(%)" : "(Rs.)"}
                    </label>
                    <input
                      type="number"
                      value={formData.discountValue}
                      onChange={(e) => setFormData({ ...formData, discountValue: parseFloat(e.target.value) })}
                      min="0"
                      step="0.01"
                      className="w-full px-4 py-2 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition font-mono"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">
                      Min Purchase (Rs.) (Optional)
                    </label>
                    <input
                      type="number"
                      value={formData.minPurchase}
                      onChange={(e) => setFormData({ ...formData, minPurchase: parseFloat(e.target.value) })}
                      min="0"
                      className="w-full px-4 py-2 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">
                      Max Discount (Rs.) (Optional)
                    </label>
                    <input
                      type="number"
                      value={formData.maxDiscount}
                      onChange={(e) => setFormData({ ...formData, maxDiscount: e.target.value })}
                      min="0"
                      placeholder="No limit"
                      className="w-full px-4 py-2 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">
                      Usage Limit (Optional)
                    </label>
                    <input
                      type="number"
                      value={formData.usageLimit}
                      onChange={(e) => setFormData({ ...formData, usageLimit: e.target.value })}
                      min="1"
                      placeholder="Unlimited"
                      className="w-full px-4 py-2 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">
                      Valid From *
                    </label>
                    <input
                      type="date"
                      value={formData.validFrom}
                      onChange={(e) => setFormData({ ...formData, validFrom: e.target.value })}
                      className="w-full px-4 py-2 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition font-mono"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">
                      Valid Until *
                    </label>
                    <input
                      type="date"
                      value={formData.validUntil}
                      onChange={(e) => setFormData({ ...formData, validUntil: e.target.value })}
                      className="w-full px-4 py-2 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition font-mono"
                      required
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full bg-brass text-white hover:bg-brass-dark disabled:opacity-50 active:scale-[0.97] transition font-semibold px-6 py-3"
                >
                  {submitting ? "Creating..." : "Create Promo Code"}
                </button>
              </form>
            </div>
          )}

          {/* Promo Codes List */}
          <div className="bg-paper-raised border border-hairline p-6">
            <h2 className="text-xl font-bold text-ink mb-6">Existing Promo Codes</h2>

            {loading ? (
              <div className="text-center py-8 text-ink-muted">Loading promo codes...</div>
            ) : promoCodes.length === 0 ? (
              <div className="border border-dashed border-hairline py-10 text-center text-ink-muted">
                <Tag className="w-10 h-10 mx-auto mb-3 text-ink-muted" />
                <p>No promo codes created yet</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b-2 border-ink">
                      <th className="p-4 text-left font-semibold text-ink text-xs uppercase tracking-wide">Code</th>
                      <th className="p-4 text-left font-semibold text-ink text-xs uppercase tracking-wide">Description</th>
                      <th className="p-4 text-left font-semibold text-ink text-xs uppercase tracking-wide">Discount</th>
                      <th className="p-4 text-right font-semibold text-ink text-xs uppercase tracking-wide">Min Purchase</th>
                      <th className="p-4 text-center font-semibold text-ink text-xs uppercase tracking-wide">Used</th>
                      <th className="p-4 text-left font-semibold text-ink text-xs uppercase tracking-wide">Valid Until</th>
                      <th className="p-4 text-center font-semibold text-ink text-xs uppercase tracking-wide">Status</th>
                      <th className="p-4 text-center font-semibold text-ink text-xs uppercase tracking-wide">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {promoCodes.map((promo) => (
                      <tr key={promo._id} className="border-b border-hairline hover:bg-paper transition-colors">
                        <td className="p-4 font-mono font-bold text-ink">{promo.code}</td>
                        <td className="p-4 text-ink-muted text-sm">{promo.description}</td>
                        <td className="p-4 font-mono tabular-nums font-semibold text-brass">
                          {promo.discountType === "percentage"
                            ? `${promo.discountValue}%`
                            : `Rs. ${promo.discountValue}`}
                        </td>
                        <td className="p-4 text-right font-mono tabular-nums text-ink-muted text-sm">
                          Rs. {promo.minPurchase}
                        </td>
                        <td className="p-4 text-center font-mono tabular-nums text-ink-muted text-sm">
                          {promo.usedCount}/{promo.usageLimit || "∞"}
                        </td>
                        <td className="p-4 text-ink-muted text-sm font-mono tabular-nums">
                          {new Date(promo.validUntil).toLocaleDateString()}
                        </td>
                        <td className="p-4 text-center">
                          <span
                            className={`inline-block px-2.5 py-1 border text-xs font-semibold uppercase tracking-wide ${
                              promo.isActive ? "border-moss text-moss" : "border-hairline text-ink-muted"
                            }`}
                          >
                            {promo.isActive ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td className="p-4">
                          <div className="flex flex-wrap items-center justify-center gap-2">
                            <button
                              onClick={() => handleToggleStatus(promo._id)}
                              className="inline-flex items-center gap-1.5 border border-ink text-ink hover:bg-ink hover:text-paper active:scale-[0.98] transition font-semibold text-xs px-3 py-1.5"
                            >
                              <Power className="w-3.5 h-3.5" />
                              {promo.isActive ? "Disable" : "Enable"}
                            </button>
                            {promo.isActive && (
                              <button
                                onClick={() => handleNotifyUsers(promo._id, promo.code)}
                                className="inline-flex items-center gap-1.5 border border-brass text-brass hover:bg-brass hover:text-white active:scale-[0.98] transition font-semibold text-xs px-3 py-1.5"
                              >
                                <Bell className="w-3.5 h-3.5" />
                                Notify
                              </button>
                            )}
                            <button
                              onClick={() => handleDelete(promo._id)}
                              className="inline-flex items-center gap-1.5 border border-seal text-seal hover:bg-seal/5 active:scale-[0.98] transition font-semibold text-xs px-3 py-1.5"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export default PromoManagement;
