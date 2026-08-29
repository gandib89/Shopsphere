import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
const BACKEND_BASE = (import.meta.env.VITE_BACKEND_URL || '').replace('/api', '');
import { Users, ArrowLeft, Mail, Phone, User as UserIcon, Shield, CheckCircle } from "lucide-react";
import NavBar from "../components/NavBar.tsx";
import { authFetch } from "../lib/session";

const UserDetails = () => {
  interface User {
    _id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    role: string;
  }

  const navigate = useNavigate();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  const fetchUsers = async () => {
    const token = localStorage.getItem("token");

    if (!token) {
      setError("You must be logged in as an admin to access this page.");
      setLoading(false);
      return;
    }

    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    try {
      const baseUrl = `${BACKEND_BASE}/api/v1`;
      const res = await authFetch(`${baseUrl}/auth/getUser`, {
        method: "GET",
        headers,
      });

      if (!res.ok) throw new Error("Failed to fetch users");

      const data = await res.json();
      setUsers(data);
      setError("");
    } catch (err) {
      console.error("Error fetching users:", err);
      setError(
        err instanceof Error ? err.message : "An unknown error occurred"
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const filteredUsers = users.filter(user =>
    user.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.lastName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.role.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Role is carried by icon shape; color collapses to the shared semantic
  // buckets instead of a rainbow of pastel hues.
  const getRoleColor = (role: string) => {
    switch (role.toLowerCase()) {
      case "admin":
        return "border-seal text-seal";
      case "seller":
        return "border-brass text-brass";
      default:
        return "border-hairline text-ink-muted";
    }
  };

  const getRoleIcon = (role: string) => {
    switch (role.toLowerCase()) {
      case "admin":
        return <Shield className="w-4 h-4" />;
      case "seller":
        return <UserIcon className="w-4 h-4" />;
      default:
        return <Users className="w-4 h-4" />;
    }
  };

  if (error) {
    return (
      <>
        <NavBar />
        <div className="min-h-screen bg-paper flex items-center justify-center">
          <div className="text-center">
            <Users className="w-20 h-20 mx-auto mb-4 text-seal" />
            <h2 className="font-display text-2xl font-bold text-ink mb-2">Access Denied</h2>
            <p className="text-ink-muted mb-6">{error}</p>
            <button
              onClick={() => navigate("/admin")}
              className="px-6 py-3 bg-brass text-white hover:bg-brass-dark active:scale-[0.97] transition font-semibold"
            >
              Go to Admin Panel
            </button>
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
        <div className="bg-ink text-paper py-8 border-b border-brass/40">
          <div className="container mx-auto px-4">
            <div className="flex items-center gap-4 mb-2">
              <button
                onClick={() => navigate("/admin")}
                className="p-2 hover:text-brass transition-colors"
                title="Go back to admin"
              >
                <ArrowLeft className="w-6 h-6" />
              </button>
              <h1 className="font-display text-4xl font-bold">User Management</h1>
            </div>
            <p className="text-paper/60 ml-12">Manage all platform users and their roles</p>
          </div>
        </div>

        <div className="container mx-auto px-4 py-12 max-w-7xl">
          {loading ? (
            <div className="flex items-center justify-center min-h-screen">
              <div className="text-center">
                <Users className="w-12 h-12 mx-auto mb-4 text-brass animate-pulse" />
                <p className="text-ink-muted">Loading users...</p>
              </div>
            </div>
          ) : (
            <>
              {/* Search Bar */}
              <div className="mb-8">
                <input
                  type="text"
                  placeholder="Search by name, email, or role..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full px-6 py-3 border border-hairline bg-paper-raised text-ink focus:outline-none focus:border-brass transition font-medium"
                />
              </div>

              {/* Users Stats */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="bg-paper-raised border border-hairline p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-ink-muted text-sm font-semibold mb-1">Total Users</p>
                      <p className="text-3xl font-bold text-ink font-mono tabular-nums">{users.length}</p>
                    </div>
                    <Users className="w-12 h-12 text-brass opacity-20" />
                  </div>
                </div>

                <div className="bg-paper-raised border border-hairline p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-ink-muted text-sm font-semibold mb-1">Admin Count</p>
                      <p className="text-3xl font-bold text-ink font-mono tabular-nums">{users.filter(u => u.role === 'admin').length}</p>
                    </div>
                    <Shield className="w-12 h-12 text-seal opacity-20" />
                  </div>
                </div>

                <div className="bg-paper-raised border border-hairline p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-ink-muted text-sm font-semibold mb-1">Seller Count</p>
                      <p className="text-3xl font-bold text-ink font-mono tabular-nums">{users.filter(u => u.role === 'seller').length}</p>
                    </div>
                    <UserIcon className="w-12 h-12 text-brass opacity-20" />
                  </div>
                </div>
              </div>

              {/* Users Table */}
              {filteredUsers.length > 0 ? (
                <div className="bg-paper-raised border border-hairline overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="border-b-2 border-ink">
                          <th className="p-4 text-left font-semibold text-ink text-xs uppercase tracking-wide">Name</th>
                          <th className="p-4 text-left font-semibold text-ink text-xs uppercase tracking-wide">Email</th>
                          <th className="p-4 text-left font-semibold text-ink text-xs uppercase tracking-wide">Phone</th>
                          <th className="p-4 text-center font-semibold text-ink text-xs uppercase tracking-wide">Role</th>
                          <th className="p-4 text-center font-semibold text-ink text-xs uppercase tracking-wide">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredUsers.map((user) => (
                          <tr
                            key={user._id}
                            className="border-b border-hairline hover:bg-paper transition-colors"
                          >
                            <td className="p-4">
                              <div className="font-semibold text-ink">
                                {user.firstName} {user.lastName}
                              </div>
                              <p className="text-sm text-ink-muted font-mono tabular-nums">ID: {user._id.slice(-8)}</p>
                            </td>
                            <td className="p-4">
                              <div className="flex items-center gap-2 text-ink-muted">
                                <Mail className="w-4 h-4 text-brass" />
                                {user.email}
                              </div>
                            </td>
                            <td className="p-4">
                              <div className="flex items-center gap-2 text-ink-muted">
                                <Phone className="w-4 h-4 text-brass" />
                                {user.phone || "N/A"}
                              </div>
                            </td>
                            <td className="p-4 text-center">
                              <span className={`inline-flex items-center gap-2 px-3 py-1 text-sm font-bold border ${getRoleColor(user.role)}`}>
                                {getRoleIcon(user.role)}
                                {user.role.charAt(0).toUpperCase() + user.role.slice(1)}
                              </span>
                            </td>
                            <td className="p-4 text-center">
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 border border-moss text-moss text-sm font-semibold">
                                <CheckCircle className="w-3.5 h-3.5" /> Active
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="text-center py-12 border border-dashed border-hairline">
                  <Users className="w-16 h-16 mx-auto mb-4 text-ink-muted/40" />
                  <p className="text-ink-muted text-lg">
                    {searchTerm ? "No users found matching your search." : "No users available."}
                  </p>
                </div>
              )}

              {/* Results Count */}
              {filteredUsers.length > 0 && (
                <div className="mt-6 text-sm text-ink-muted">
                  Showing <span className="font-bold font-mono tabular-nums">{filteredUsers.length}</span> of <span className="font-bold font-mono tabular-nums">{users.length}</span> users
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default UserDetails;
