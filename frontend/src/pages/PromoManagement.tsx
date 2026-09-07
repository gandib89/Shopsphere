import React, { useEffect, useState } from "react";
import { Tag, Plus, Trash2, Power, Bell } from "lucide-react";
import axios from "axios";
import { toast } from "sonner";
import { AdminEmptyState, AdminHeading } from "../components/admin/AdminUi";

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
  const token = localStorage.getItem("token");
  
  const [promoCodes, setPromoCodes] = useState<PromoCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  
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

  const updateFormField = <K extends keyof typeof formData,>(
    field: K,
    value: (typeof formData)[K],
  ) => {
    setFormData(current => ({ ...current, [field]: value }));
    setFormErrors(current => {
      const next = { ...current };
      delete next[field];
      return next;
    });
    setFormError("");
  };

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

    const errors: Record<string, string> = {};
    if (!/^[A-Z0-9_-]{3,20}$/.test(formData.code.trim())) errors.code = "Use 3–20 letters, numbers, hyphens, or underscores.";
    if (formData.description.trim().length < 5) errors.description = "Describe the offer in at least 5 characters.";
    if (!Number.isFinite(formData.discountValue) || formData.discountValue <= 0) errors.discountValue = "Enter a discount greater than zero.";
    if (formData.discountType === "percentage" && formData.discountValue > 100) errors.discountValue = "A percentage discount cannot exceed 100%.";
    if (!formData.validFrom) errors.validFrom = "Choose when this code becomes valid.";
    if (!formData.validUntil) errors.validUntil = "Choose when this code expires.";
    if (formData.validFrom && formData.validUntil && formData.validUntil <= formData.validFrom) errors.validUntil = "The expiry must be after the start date.";
    if (formData.maxDiscount && Number(formData.maxDiscount) <= 0) errors.maxDiscount = "Enter a positive limit or leave this blank.";
    if (formData.usageLimit && (!Number.isInteger(Number(formData.usageLimit)) || Number(formData.usageLimit) < 1)) errors.usageLimit = "Enter a whole number of at least 1.";
    setFormErrors(errors);
    if (Object.keys(errors).length) {
      setFormError("Review the highlighted fields before creating this promo code.");
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    setFormError("");

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
      setFormErrors({});
      setFormError("");
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
      const message = error.response?.data?.message || "Failed to create promo code";
      setFormError(message);
      toast.error(message);
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
    <main>
      <AdminHeading title="Promo Code Management" description="Create and manage customer discounts.">
        <button
          onClick={() => { setShowCreateForm(!showCreateForm); setFormError(""); setFormErrors({}); }}
          aria-expanded={showCreateForm}
          aria-controls="create-promo-form"
          className="admin-button admin-button--primary"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {showCreateForm ? "Cancel" : "Create New Promo Code"}
        </button>
      </AdminHeading>

          {/* Create Form */}
          {showCreateForm && (
            <section id="create-promo-form" className="admin-panel p-6 mb-6">
              <h2 className="text-xl font-bold text-ink mb-6">Create Promo Code</h2>
              <form onSubmit={handleCreatePromo} className="space-y-4" noValidate>
                {formError && <p className="border border-seal/40 bg-seal/5 px-4 py-3 text-sm text-seal" role="alert">{formError}</p>}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="promo-code" className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">
                      Code *
                    </label>
                    <input
                      id="promo-code"
                      type="text"
                      value={formData.code}
                      onChange={(e) => updateFormField("code", e.target.value.toUpperCase())}
                      placeholder="e.g., SAVE20"
                      className="w-full px-4 py-2 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition uppercase font-mono"
                      required
                      aria-invalid={!!formErrors.code}
                      aria-describedby={formErrors.code ? "promo-code-error" : undefined}
                    />
                    {formErrors.code && <p id="promo-code-error" className="mt-1 text-sm text-seal">{formErrors.code}</p>}
                  </div>

                  <div>
                    <label htmlFor="promo-description" className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">
                      Description *
                    </label>
                    <input
                      id="promo-description"
                      type="text"
                      value={formData.description}
                      onChange={(e) => updateFormField("description", e.target.value)}
                      placeholder="e.g., 20% off your purchase"
                      className="w-full px-4 py-2 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition"
                      required
                      aria-invalid={!!formErrors.description}
                      aria-describedby={formErrors.description ? "promo-description-error" : undefined}
                    />
                    {formErrors.description && <p id="promo-description-error" className="mt-1 text-sm text-seal">{formErrors.description}</p>}
                  </div>

                  <div>
                    <label htmlFor="promo-discount-type" className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">
                      Discount Type *
                    </label>
                    <select
                      id="promo-discount-type"
                      value={formData.discountType}
                      onChange={(e) => updateFormField("discountType", e.target.value as "percentage" | "fixed")}
                      className="w-full px-4 py-2 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition"
                    >
                      <option value="percentage">Percentage</option>
                      <option value="fixed">Fixed Amount</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="promo-discount-value" className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">
                      Discount Value * {formData.discountType === "percentage" ? "(%)" : "(Rs.)"}
                    </label>
                    <input
                      id="promo-discount-value"
                      type="number"
                      value={formData.discountValue}
                      onChange={(e) => updateFormField("discountValue", Number(e.target.value))}
                      min="0"
                      step="0.01"
                      className="w-full px-4 py-2 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition font-mono"
                      required
                      aria-invalid={!!formErrors.discountValue}
                      aria-describedby={formErrors.discountValue ? "promo-discount-value-error" : undefined}
                    />
                    {formErrors.discountValue && <p id="promo-discount-value-error" className="mt-1 text-sm text-seal">{formErrors.discountValue}</p>}
                  </div>

                  <div>
                    <label htmlFor="promo-min-purchase" className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">
                      Min Purchase (Rs.) (Optional)
                    </label>
                    <input
                      id="promo-min-purchase"
                      type="number"
                      value={formData.minPurchase}
                      onChange={(e) => updateFormField("minPurchase", Number(e.target.value))}
                      min="0"
                      className="w-full px-4 py-2 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition font-mono"
                    />
                  </div>

                  <div>
                    <label htmlFor="promo-max-discount" className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">
                      Max Discount (Rs.) (Optional)
                    </label>
                    <input
                      id="promo-max-discount"
                      type="number"
                      value={formData.maxDiscount}
                      onChange={(e) => updateFormField("maxDiscount", e.target.value)}
                      min="0"
                      placeholder="No limit"
                      className="w-full px-4 py-2 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition font-mono"
                      aria-invalid={!!formErrors.maxDiscount}
                      aria-describedby={formErrors.maxDiscount ? "promo-max-discount-error" : undefined}
                    />
                    {formErrors.maxDiscount && <p id="promo-max-discount-error" className="mt-1 text-sm text-seal">{formErrors.maxDiscount}</p>}
                  </div>

                  <div>
                    <label htmlFor="promo-usage-limit" className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">
                      Usage Limit (Optional)
                    </label>
                    <input
                      id="promo-usage-limit"
                      type="number"
                      value={formData.usageLimit}
                      onChange={(e) => updateFormField("usageLimit", e.target.value)}
                      min="1"
                      placeholder="Unlimited"
                      className="w-full px-4 py-2 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition font-mono"
                      aria-invalid={!!formErrors.usageLimit}
                      aria-describedby={formErrors.usageLimit ? "promo-usage-limit-error" : undefined}
                    />
                    {formErrors.usageLimit && <p id="promo-usage-limit-error" className="mt-1 text-sm text-seal">{formErrors.usageLimit}</p>}
                  </div>

                  <div>
                    <label htmlFor="promo-valid-from" className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">
                      Valid From *
                    </label>
                    <input
                      id="promo-valid-from"
                      type="date"
                      value={formData.validFrom}
                      onChange={(e) => updateFormField("validFrom", e.target.value)}
                      className="w-full px-4 py-2 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition font-mono"
                      required
                      aria-invalid={!!formErrors.validFrom}
                      aria-describedby={formErrors.validFrom ? "promo-valid-from-error" : undefined}
                    />
                    {formErrors.validFrom && <p id="promo-valid-from-error" className="mt-1 text-sm text-seal">{formErrors.validFrom}</p>}
                  </div>

                  <div>
                    <label htmlFor="promo-valid-until" className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">
                      Valid Until *
                    </label>
                    <input
                      id="promo-valid-until"
                      type="date"
                      value={formData.validUntil}
                      onChange={(e) => updateFormField("validUntil", e.target.value)}
                      className="w-full px-4 py-2 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition font-mono"
                      required
                      aria-invalid={!!formErrors.validUntil}
                      aria-describedby={formErrors.validUntil ? "promo-valid-until-error" : undefined}
                    />
                    {formErrors.validUntil && <p id="promo-valid-until-error" className="mt-1 text-sm text-seal">{formErrors.validUntil}</p>}
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
            </section>
          )}

          {/* Promo Codes List */}
          <section className="admin-panel">
            <div className="admin-panel-head"><div><h2>Existing promo codes</h2><p>Enable, notify customers, or remove an offer.</p></div></div>

            {loading ? (
              <p className="admin-empty" role="status">Loading promo codes…</p>
            ) : promoCodes.length === 0 ? (
              <AdminEmptyState icon={<Tag />} title="No promo codes yet" description="Create your first offer when you are ready to run a customer promotion." action={<button className="admin-button admin-button--primary" onClick={() => setShowCreateForm(true)}>Create first promo code</button>} />
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
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
          </section>
    </main>
  );
}

export default PromoManagement;
