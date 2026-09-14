import AccountDeletion from '../components/account/AccountDeletion';
import { useEffect, useState } from "react";
import NavBar from "../components/NavBar";
import { ArrowLeft, User, Pencil, X, Store, Phone, Mail, Check, Lock, Eye, EyeOff } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { authFetch } from "../lib/session";

interface UserProfile {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  homeStreet?: string;
  homeCity?: string;
  homeState?: string;
  homeZipCode?: string;
  role: string;
  shopName: string;
  shopDescription: string;
  isVerified?: boolean;
  googleId?: string;
  hasPassword?: boolean;
  createdAt: string;
}

const provinces = ['Koshi', 'Madhesh', 'Bagmati', 'Gandaki', 'Lumbini', 'Karnali', 'Sudurpashchim'];

const Profile = () => {
  const navigate = useNavigate();
  const token = localStorage.getItem("token");
  const isSeller = localStorage.getItem("isSeller") === "true";

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    homeStreet: "",
    homeCity: "",
    homeState: "",
    homeZipCode: "",
    shopName: "",
    shopDescription: "",
  });
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);

  useEffect(() => {
    if (!token) { navigate("/auth"); return; }
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const res = await authFetch(`${import.meta.env.VITE_BACKEND_URL}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load profile");
      const data: UserProfile = await res.json();
      setProfile(data);
      setForm({
        firstName: data.firstName || "",
        lastName: data.lastName || "",
        phone: data.phone || "",
        homeStreet: data.homeStreet || "",
        homeCity: data.homeCity || "",
        homeState: data.homeState || "",
        homeZipCode: data.homeZipCode || "",
        shopName: data.shopName || "",
        shopDescription: data.shopDescription || "",
      });
    } catch (err) {
      toast.error("Failed to load profile");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!form.firstName.trim() || !form.lastName.trim()) {
      toast.error("First and last name are required");
      return;
    }
    try {
      setSaving(true);
      const res = await authFetch(`${import.meta.env.VITE_BACKEND_URL}/api/v1/auth/profile`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("Failed to update profile");
      const data = await res.json();
      setProfile(data.user);
      setEditing(false);
      toast.success("Profile updated successfully!");
    } catch (err) {
      toast.error("Failed to update profile. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (profile) {
      setForm({
        firstName: profile.firstName || "",
        lastName: profile.lastName || "",
        phone: profile.phone || "",
        homeStreet: profile.homeStreet || "",
        homeCity: profile.homeCity || "",
        homeState: profile.homeState || "",
        homeZipCode: profile.homeZipCode || "",
        shopName: profile.shopName || "",
        shopDescription: profile.shopDescription || "",
      });
    }
    setEditing(false);
  };

  const handlePasswordChange = async () => {
    if (!passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
      toast.error("All password fields are required");
      return;
    }
    if (passwordForm.newPassword.length < 6) {
      toast.error("New password must be at least 6 characters");
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.error("New passwords do not match");
      return;
    }
    try {
      setChangingPassword(true);
      const res = await authFetch(`${import.meta.env.VITE_BACKEND_URL}/api/v1/auth/update-password`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to update password");
      toast.success("Password updated successfully!");
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setShowPasswordForm(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to update password");
    } finally {
      setChangingPassword(false);
    }
  };

  if (loading) {
    return (
      <>
        <NavBar />
        <div className="flex items-center justify-center min-h-screen bg-paper">
          <div className="text-center">
            <User className="w-12 h-12 mx-auto mb-4 text-brass animate-pulse" />
            <p className="text-ink-muted">Loading profile...</p>
          </div>
        </div>
      </>
    );
  }

  if (!profile) return null;

  const roleLabel = profile.role === "seller" ? "Seller" : profile.role === "admin" ? "Admin" : "Customer";

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
              <h1 className="font-display text-2xl sm:text-4xl font-bold">My Profile</h1>
            </div>
            <p className="text-paper/60 text-sm ml-11">View and manage your account details</p>
          </div>
        </div>

        <div className={`container mx-auto px-4 py-10 max-w-2xl ${editing ? 'pb-64' : ''}`}>
          {/* Avatar & Role Card */}
          <div className="bg-paper-raised border border-hairline p-6 mb-6 flex items-center gap-5">
            <div className="w-20 h-20 rounded-full bg-ink text-paper border-2 border-brass flex items-center justify-center text-3xl font-bold shrink-0">
              {profile.firstName[0]}{profile.lastName[0]}
            </div>
            <div>
              <h2 className="text-2xl font-bold text-ink">
                {profile.firstName} {profile.lastName}
              </h2>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs font-semibold px-3 py-1 border border-hairline text-ink-muted uppercase tracking-wide">
                  {roleLabel}
                </span>
                {profile.role === "seller" && (
                  <span className={`text-xs font-semibold px-3 py-1 border uppercase tracking-wide ${
                    profile.isVerified ? "border-moss text-moss" : "border-brass text-brass"
                  }`}>
                    {profile.isVerified ? "Verified" : "Pending Verification"}
                  </span>
                )}
              </div>
              <p className="text-xs text-ink-muted mt-1 font-mono tabular-nums">
                Member since {new Date(profile.createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
              </p>
            </div>
            {!editing && (
              <button
                onClick={() => setEditing(true)}
                className="ml-auto flex items-center gap-2 px-4 py-2 bg-brass text-white hover:bg-brass-dark active:scale-[0.97] transition font-semibold text-sm shrink-0"
              >
                <Pencil className="w-4 h-4" />
                Edit Profile
              </button>
            )}
          </div>

          {/* Profile Details */}
          <div className="bg-paper-raised border border-hairline p-6 space-y-5">
            <h3 className="text-lg font-bold text-ink border-b border-hairline pb-2">Personal Information</h3>

            {/* First Name */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1">First Name</label>
                {editing ? (
                  <input
                    type="text"
                    value={form.firstName}
                    onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                    className="w-full px-3 py-2 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition text-sm"
                  />
                ) : (
                  <p className="text-ink font-medium">{profile.firstName}</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1">Last Name</label>
                {editing ? (
                  <input
                    type="text"
                    value={form.lastName}
                    onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                    className="w-full px-3 py-2 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition text-sm"
                  />
                ) : (
                  <p className="text-ink font-medium">{profile.lastName}</p>
                )}
              </div>
            </div>

            {/* Email (read-only) */}
            <div>
              <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1">Email Address</label>
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-ink-muted shrink-0" />
                <p className="text-ink-muted">{profile.email}</p>
                <span className="text-xs text-ink-muted italic">(cannot be changed)</span>
              </div>
            </div>

            {/* Phone */}
            <div>
              <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1">Phone Number</label>
              {editing ? (
                <div className="flex items-center gap-2">
                  <Phone className="w-4 h-4 text-ink-muted shrink-0" />
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="e.g. 9841234567"
                    className="flex-1 px-3 py-2 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition text-sm"
                  />
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Phone className="w-4 h-4 text-ink-muted shrink-0" />
                  <p className="text-ink font-medium">{profile.phone || <span className="text-ink-muted italic">Not provided</span>}</p>
                </div>
              )}
            </div>

            <h3 className="text-lg font-bold text-ink border-b border-hairline pb-2 pt-2">Home Address</h3>
            {editing ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label htmlFor="home-street" className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1">Street, ward, or local address</label>
                  <input id="home-street" autoComplete="street-address" value={form.homeStreet} onChange={(e) => setForm({ ...form, homeStreet: e.target.value })} className="w-full px-3 py-2 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition text-sm" />
                </div>
                <div>
                  <label htmlFor="home-city" className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1">Municipality or city</label>
                  <input id="home-city" autoComplete="address-level2" value={form.homeCity} onChange={(e) => setForm({ ...form, homeCity: e.target.value })} className="w-full px-3 py-2 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition text-sm" />
                </div>
                <div>
                  <label htmlFor="home-state" className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1">Province</label>
                  <select id="home-state" autoComplete="address-level1" value={form.homeState} onChange={(e) => setForm({ ...form, homeState: e.target.value })} className="w-full px-3 py-2 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition text-sm">
                    <option value="">Select province</option>
                    {provinces.map(province => <option key={province}>{province}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="home-postal-code" className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1">Postal code</label>
                  <input id="home-postal-code" autoComplete="postal-code" value={form.homeZipCode} onChange={(e) => setForm({ ...form, homeZipCode: e.target.value })} className="w-full px-3 py-2 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition text-sm" />
                </div>
                <div>
                  <label htmlFor="home-country" className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1">Country</label>
                  <input id="home-country" value="Nepal" readOnly className="w-full px-3 py-2 border border-hairline bg-paper text-ink-muted text-sm" />
                </div>
              </div>
            ) : (
              <p className="text-ink font-medium">
                {[profile.homeStreet, profile.homeCity, profile.homeState, profile.homeZipCode].filter(Boolean).join(', ') || <span className="text-ink-muted italic">Not provided</span>}
                {(profile.homeStreet || profile.homeCity || profile.homeState || profile.homeZipCode) && <span className="block text-sm text-ink-muted mt-1">Nepal</span>}
              </p>
            )}

            {/* Seller-only fields */}
            {isSeller && (
              <>
                <h3 className="text-lg font-bold text-ink border-b border-hairline pb-2 pt-2">Shop Information</h3>

                <div>
                  <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1">Shop Name</label>
                  {editing ? (
                    <div className="flex items-center gap-2">
                      <Store className="w-4 h-4 text-ink-muted shrink-0" />
                      <input
                        type="text"
                        value={form.shopName}
                        onChange={(e) => setForm({ ...form, shopName: e.target.value })}
                        placeholder="Your shop name"
                        className="flex-1 px-3 py-2 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition text-sm"
                      />
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Store className="w-4 h-4 text-ink-muted shrink-0" />
                      <p className="text-ink font-medium">{profile.shopName || <span className="text-ink-muted italic">Not provided</span>}</p>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1">Shop Description</label>
                  {editing ? (
                    <textarea
                      value={form.shopDescription}
                      onChange={(e) => setForm({ ...form, shopDescription: e.target.value })}
                      rows={3}
                      placeholder="Describe your shop..."
                      className="w-full px-3 py-2 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition text-sm resize-none"
                      onFocus={(e) => {
                        const el = e.currentTarget;
                        setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 400);
                        setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 700);
                      }}
                    />
                  ) : (
                    <p className="text-ink-muted">{profile.shopDescription || <span className="text-ink-muted italic">Not provided</span>}</p>
                  )}
                </div>
              </>
            )}

            {/* Action Buttons */}
            {editing && (
              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 flex items-center justify-center gap-2 bg-brass text-white hover:bg-brass-dark disabled:opacity-50 active:scale-[0.97] transition font-semibold px-4 py-3"
                >
                  {saving ? (
                    <>
                      <div className="w-4 h-4 border-2 border-ink border-t-transparent rounded-full animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      Save Changes
                    </>
                  )}
                </button>
                <button
                  onClick={handleCancel}
                  disabled={saving}
                  className="flex-1 flex items-center justify-center gap-2 border border-ink text-ink hover:bg-ink hover:text-paper disabled:opacity-50 active:scale-[0.98] transition font-semibold px-4 py-3"
                >
                  <X className="w-4 h-4" />
                  Cancel
                </button>
              </div>
            )}
          </div>

          {/* Change Password Section */}
          <div className="bg-paper-raised border border-hairline p-6 space-y-5 mt-6">
            <h3 className="text-lg font-bold text-ink border-b border-hairline pb-2 flex items-center gap-2">
              <Lock className="w-5 h-5 text-brass" />
              Change Password
            </h3>

            {profile.googleId ? (
              <div className="border border-hairline bg-paper p-4">
                <p className="text-sm text-ink-muted">
                  You signed in with Google. Password change is not available for Google accounts.
                </p>
              </div>
            ) : !showPasswordForm ? (
              <button
                onClick={() => setShowPasswordForm(true)}
                className="w-full flex items-center justify-center gap-2 bg-brass text-white hover:bg-brass-dark active:scale-[0.97] transition font-semibold px-4 py-3"
              >
                <Lock className="w-4 h-4" />
                Update Password
              </button>
            ) : (
              <>
                <div>
                  <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1">Current Password</label>
                  <div className="relative">
                    <input
                      type={showCurrentPassword ? "text" : "password"}
                      value={passwordForm.currentPassword}
                      onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                      placeholder="Enter current password"
                      className="w-full px-3 py-2 pr-10 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink transition"
                    >
                      {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1">New Password</label>
                  <div className="relative">
                    <input
                      type={showNewPassword ? "text" : "password"}
                      value={passwordForm.newPassword}
                      onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                      placeholder="Enter new password (min 6 characters)"
                      className="w-full px-3 py-2 pr-10 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink transition"
                    >
                      {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1">Confirm New Password</label>
                  <div className="relative">
                    <input
                      type={showConfirmPassword ? "text" : "password"}
                      value={passwordForm.confirmPassword}
                      onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                      placeholder="Re-enter new password"
                      className="w-full px-3 py-2 pr-10 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink transition"
                    >
                      {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setShowPasswordForm(false);
                      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
                    }}
                    className="flex-1 flex items-center justify-center gap-2 border border-ink text-ink hover:bg-ink hover:text-paper active:scale-[0.98] transition font-semibold px-4 py-3"
                  >
                    <X className="w-4 h-4" />
                    Cancel
                  </button>
                  <button
                    onClick={handlePasswordChange}
                    disabled={changingPassword}
                    className="flex-1 flex items-center justify-center gap-2 bg-brass text-white hover:bg-brass-dark disabled:opacity-50 active:scale-[0.97] transition font-semibold px-4 py-3"
                  >
                    {changingPassword ? (
                      <>
                        <div className="w-4 h-4 border-2 border-ink border-t-transparent rounded-full animate-spin" />
                        Updating...
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        Save Password
                      </>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
          {profile && ["user", "seller"].includes(profile.role) && <AccountDeletion name={profile.firstName} hasPassword={profile.hasPassword ?? !profile.googleId} googleLinked={!!profile.googleId} />}
        </div>
      </div>
    </>
  );
};

export default Profile;
