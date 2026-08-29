import { useState, useEffect } from 'react';
import { Edit2, Trash2, Mail, Users, X, Search } from 'lucide-react';
import axios from 'axios';
import { toast } from 'sonner';
import NavBar from '../components/NavBar';

interface User {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  role: 'user' | 'seller' | 'admin';
  shopName?: string;
  shopDescription?: string;
  isVerified?: boolean;
  createdAt: string;
}

interface Statistics {
  totalUsers: number;
  totalSellers: number;
  verifiedSellers: number;
  unverifiedSellers: number;
  totalAdmins: number;
  totalAccounts: number;
}

function AdminUserManagement() {
  const token = localStorage.getItem('token');
  const [users, setUsers] = useState<User[]>([]);
  const [stats, setStats] = useState<Statistics | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'user' | 'seller' | 'admin'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showMessageModal, setShowMessageModal] = useState(false);
  const [messageData, setMessageData] = useState({ subject: '', message: '' });

  useEffect(() => {
    if (!token || localStorage.getItem('isAdmin') !== 'true') {
      window.location.hash = '/auth';
      return;
    }
    fetchUsers();
    fetchStats();
  }, [token]);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const response = await axios.get(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/users/all`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      setUsers(response.data);
    } catch (err) {
      console.error('Error fetching users:', err);
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const response = await axios.get(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/users/stats`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      setStats(response.data);
    } catch (err) {
      console.error('Error fetching stats:', err);
    }
  };

  const handleDeleteUser = async (userId: string, email: string) => {
    if (!confirm(`Are you sure you want to delete user ${email}? This action cannot be undone.`)) {
      return;
    }

    try {
      await axios.delete(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/users/${userId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      toast.success(`User ${email} deleted successfully`);
      setUsers(users.filter(u => u._id !== userId));
      fetchStats();
    } catch (err) {
      console.error('Error deleting user:', err);
      toast.error('Failed to delete user');
    }
  };

  const handleEditUser = (user: User) => {
    setEditingUser({ ...user });
    setShowEditModal(true);
  };

  const handleUpdateUser = async () => {
    if (!editingUser) return;

    try {
      const response = await axios.put(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/users/${editingUser._id}`,
        {
          firstName: editingUser.firstName,
          lastName: editingUser.lastName,
          email: editingUser.email,
          phone: editingUser.phone,
          shopName: editingUser.shopName,
          shopDescription: editingUser.shopDescription,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      setUsers(users.map(u => u._id === editingUser._id ? response.data.user : u));
      setShowEditModal(false);
      setEditingUser(null);
      toast.success('User updated successfully');
    } catch (err: any) {
      console.error('Error updating user:', err);
      toast.error(err.response?.data?.message || 'Failed to update user');
    }
  };

  const handleSendMessage = async () => {
    if (!selectedUser || !messageData.subject || !messageData.message) {
      toast.error('Please fill in all fields');
      return;
    }

    try {
      await axios.post(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/users/${selectedUser._id}/send-message`,
        messageData,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      toast.success(`Message sent to ${selectedUser.email}`);
      setShowMessageModal(false);
      setMessageData({ subject: '', message: '' });
      setSelectedUser(null);
    } catch (err) {
      console.error('Error sending message:', err);
      toast.error('Failed to send message');
    }
  };

  const filteredUsers = users.filter((user) => {
    const matchesFilter = filter === 'all' || user.role === filter;
    const matchesSearch =
      user.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.lastName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.email.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  // Role badges collapse to the four-bucket semantic system: only a seller's
  // verification state carries meaning (pending vs. active); every other
  // role is neutral, not a status.
  const getRoleBadgeClasses = (role: string, isVerified?: boolean) => {
    if (role === 'seller') {
      return isVerified ? 'border-moss text-moss' : 'border-brass text-brass';
    }
    return 'border-hairline text-ink-muted';
  };

  const getRoleLabel = (role: string, isVerified?: boolean) => {
    if (role === 'seller') {
      return isVerified ? 'Verified Seller' : 'Pending Seller';
    }
    return role.charAt(0).toUpperCase() + role.slice(1);
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
                <h1 className="font-display text-2xl sm:text-4xl font-bold mb-1">User Management</h1>
                <p className="text-paper/60 text-sm">Manage users, sellers, and admins</p>
              </div>
              <button
                onClick={fetchUsers}
                className="border border-brass text-brass hover:bg-brass hover:text-white active:scale-[0.97] transition px-3 sm:px-6 py-2.5 sm:py-3 font-semibold text-sm shrink-0"
              >
                Refresh
              </button>
            </div>
          </div>
        </div>

        {/* Statistics Cards */}
        {stats && (
          <div className="container mx-auto px-4 py-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="bg-paper-raised border border-hairline p-6">
                <p className="text-ink-muted text-xs uppercase tracking-wide mb-1">Total Users</p>
                <p className="text-3xl font-bold text-ink font-mono tabular-nums">{stats.totalUsers}</p>
              </div>
              <div className="bg-paper-raised border border-hairline p-6">
                <p className="text-ink-muted text-xs uppercase tracking-wide mb-1">Total Sellers</p>
                <p className="text-3xl font-bold text-ink font-mono tabular-nums">{stats.totalSellers}</p>
              </div>
              <div className="bg-paper-raised border border-hairline p-6">
                <p className="text-ink-muted text-xs uppercase tracking-wide mb-1">Verified Sellers</p>
                <p className="text-3xl font-bold text-moss font-mono tabular-nums">{stats.verifiedSellers}</p>
              </div>
              <div className="bg-paper-raised border border-hairline p-6">
                <p className="text-ink-muted text-xs uppercase tracking-wide mb-1">Pending Sellers</p>
                <p className="text-3xl font-bold text-brass font-mono tabular-nums">{stats.unverifiedSellers}</p>
              </div>
              <div className="bg-paper-raised border border-hairline p-6">
                <p className="text-ink-muted text-xs uppercase tracking-wide mb-1">Total Admins</p>
                <p className="text-3xl font-bold text-ink font-mono tabular-nums">{stats.totalAdmins}</p>
              </div>
            </div>
          </div>
        )}

        {/* Filters and Search */}
        <div className="container mx-auto px-4 py-6">
          <div className="mb-6 flex flex-col md:flex-row gap-3 md:items-center">
            {/* Search */}
            <div className="flex-1 w-full flex items-center border border-hairline bg-paper-raised overflow-hidden transition-colors duration-150 focus-within:border-brass">
              <div className="px-3.5 flex items-center border-r border-hairline">
                <Search size={16} className="text-brass" />
              </div>
              <input
                type="text"
                placeholder="Search by name or email..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="flex-1 px-3.5 py-2.5 text-sm text-ink bg-transparent outline-none"
              />
              {searchTerm && (
                <button onClick={() => setSearchTerm('')} className="px-3.5 text-ink-muted hover:text-ink text-lg leading-none">×</button>
              )}
            </div>
            {/* Role filter pills */}
            <div className="flex gap-1.5 shrink-0">
              {(['all', 'user', 'seller', 'admin'] as const).map((role) => (
                <button
                  key={role}
                  onClick={() => setFilter(role)}
                  className={`px-3.5 py-1.5 text-[13px] font-medium border transition-colors duration-150 ${
                    filter === role
                      ? 'bg-ink text-paper border-ink'
                      : 'bg-transparent text-ink-muted border-hairline hover:border-brass hover:text-brass'
                  }`}
                >
                  {role === 'all' ? 'All' : role.charAt(0).toUpperCase() + role.slice(1) + 's'}
                </button>
              ))}
            </div>
          </div>

          {/* Users Table */}
          {loading ? (
            <div className="text-center py-12">
              <p className="text-ink-muted">Loading users...</p>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-hairline">
              <Users className="w-16 h-16 mx-auto text-ink-muted/40 mb-4" />
              <p className="text-ink-muted">No users found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b-2 border-ink">
                    <th className="p-4 text-left font-semibold text-ink text-xs uppercase tracking-wide">Name</th>
                    <th className="p-4 text-left font-semibold text-ink text-xs uppercase tracking-wide">Email</th>
                    <th className="p-4 text-left font-semibold text-ink text-xs uppercase tracking-wide">Role</th>
                    <th className="p-4 text-left font-semibold text-ink text-xs uppercase tracking-wide">Phone</th>
                    <th className="p-4 text-left font-semibold text-ink text-xs uppercase tracking-wide">Joined</th>
                    <th className="p-4 text-left font-semibold text-ink text-xs uppercase tracking-wide">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((user) => (
                    <tr key={user._id} className="border-b border-hairline hover:bg-paper transition-colors">
                      <td className="p-4">
                        <div className="font-semibold text-ink">
                          {user.firstName} {user.lastName}
                        </div>
                        {user.shopName && (
                          <div className="text-xs text-ink-muted">{user.shopName}</div>
                        )}
                      </td>
                      <td className="p-4 text-sm text-ink-muted">{user.email}</td>
                      <td className="p-4">
                        <span className={`px-3 py-1 border text-xs font-semibold uppercase tracking-wide ${getRoleBadgeClasses(user.role, user.isVerified)}`}>
                          {getRoleLabel(user.role, user.isVerified)}
                        </span>
                      </td>
                      <td className="p-4 text-sm text-ink-muted">{user.phone || '-'}</td>
                      <td className="p-4 text-sm text-ink-muted font-mono tabular-nums">
                        {new Date(user.createdAt).toLocaleDateString()}
                      </td>
                      <td className="p-4">
                        <div className="flex gap-1">
                          <button
                            onClick={() => handleEditUser(user)}
                            className="p-2 text-ink-muted hover:text-brass active:scale-[0.97] transition"
                            title="Edit user"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => {
                              setSelectedUser(user);
                              setShowMessageModal(true);
                            }}
                            className="p-2 text-ink-muted hover:text-ink active:scale-[0.97] transition"
                            title="Send message"
                          >
                            <Mail className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteUser(user._id, user.email)}
                            className="p-2 text-ink-muted hover:text-seal active:scale-[0.97] transition"
                            title="Delete user"
                          >
                            <Trash2 className="w-4 h-4" />
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

        {/* Edit User Modal */}
        {showEditModal && editingUser && (
          <div className="fixed inset-0 bg-ink/50 flex items-center justify-center z-50 p-4 animate-overlay-in">
            <div className="bg-paper-raised border border-hairline max-w-md w-full animate-panel-in">
              <div className="flex items-center justify-between p-6 border-b border-hairline">
                <h2 className="text-xl font-bold text-ink">Edit User Details</h2>
                <button
                  onClick={() => setShowEditModal(false)}
                  className="text-ink-muted hover:text-ink transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <input
                  type="text"
                  placeholder="First Name"
                  value={editingUser.firstName}
                  onChange={(e) => setEditingUser({ ...editingUser, firstName: e.target.value })}
                  className="w-full px-4 py-2 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition"
                />
                <input
                  type="text"
                  placeholder="Last Name"
                  value={editingUser.lastName}
                  onChange={(e) => setEditingUser({ ...editingUser, lastName: e.target.value })}
                  className="w-full px-4 py-2 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition"
                />
                <input
                  type="email"
                  placeholder="Email"
                  value={editingUser.email}
                  onChange={(e) => setEditingUser({ ...editingUser, email: e.target.value })}
                  className="w-full px-4 py-2 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition"
                />
                <input
                  type="tel"
                  placeholder="Phone"
                  value={editingUser.phone || ''}
                  onChange={(e) => setEditingUser({ ...editingUser, phone: e.target.value })}
                  className="w-full px-4 py-2 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition"
                />
                {editingUser.role === 'seller' && (
                  <>
                    <input
                      type="text"
                      placeholder="Shop Name"
                      value={editingUser.shopName || ''}
                      onChange={(e) => setEditingUser({ ...editingUser, shopName: e.target.value })}
                      className="w-full px-4 py-2 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition"
                    />
                    <textarea
                      placeholder="Shop Description"
                      value={editingUser.shopDescription || ''}
                      onChange={(e) => setEditingUser({ ...editingUser, shopDescription: e.target.value })}
                      className="w-full px-4 py-2 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition resize-none"
                      rows={3}
                    />
                  </>
                )}
              </div>

              <div className="flex gap-3 p-6 border-t border-hairline">
                <button
                  onClick={() => setShowEditModal(false)}
                  className="flex-1 px-4 py-2 border border-ink text-ink hover:bg-ink hover:text-paper active:scale-[0.98] transition font-semibold"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUpdateUser}
                  className="flex-1 px-4 py-2 bg-brass text-white hover:bg-brass-dark active:scale-[0.97] transition font-semibold"
                >
                  Update
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Message Modal */}
        {showMessageModal && selectedUser && (
          <div className="fixed inset-0 bg-ink/50 flex items-center justify-center z-50 p-4 animate-overlay-in">
            <div className="bg-paper-raised border border-hairline max-w-md w-full animate-panel-in">
              <div className="flex items-center justify-between p-6 border-b border-hairline">
                <h2 className="text-xl font-bold text-ink">Send Message</h2>
                <button
                  onClick={() => setShowMessageModal(false)}
                  className="text-ink-muted hover:text-ink transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div className="border border-hairline bg-paper p-4">
                  <p className="text-sm text-ink-muted">Sending to:</p>
                  <p className="font-semibold text-ink">{selectedUser.email}</p>
                </div>
                <input
                  type="text"
                  placeholder="Message Subject"
                  value={messageData.subject}
                  onChange={(e) => setMessageData({ ...messageData, subject: e.target.value })}
                  className="w-full px-4 py-2 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition"
                />
                <textarea
                  placeholder="Message Content"
                  value={messageData.message}
                  onChange={(e) => setMessageData({ ...messageData, message: e.target.value })}
                  className="w-full px-4 py-2 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition resize-none"
                  rows={6}
                />
              </div>

              <div className="flex gap-3 p-6 border-t border-hairline">
                <button
                  onClick={() => setShowMessageModal(false)}
                  className="flex-1 px-4 py-2 border border-ink text-ink hover:bg-ink hover:text-paper active:scale-[0.98] transition font-semibold"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSendMessage}
                  className="flex-1 px-4 py-2 bg-brass text-white hover:bg-brass-dark active:scale-[0.97] transition font-semibold flex items-center justify-center gap-2"
                >
                  <Mail className="w-4 h-4" />
                  Send
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default AdminUserManagement;
