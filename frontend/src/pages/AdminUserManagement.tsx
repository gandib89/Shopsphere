import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Edit2, Trash2, Mail, Users, Search } from 'lucide-react';
import axios from 'axios';
import { toast } from 'sonner';
import CreateCustomer from '../components/account/CreateCustomer';
import CreateSeller from '../components/account/CreateSeller';
import { Dialog } from '../components/ui/Dialog';
import { Field } from '../components/ui/Field';
import { Button } from '../components/ui/Button';
import { AdminEmptyState, AdminHeading } from '../components/admin/AdminUi';

interface User {
  _id: string;
  id?: string;
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
const normalizeUser = (user: User & { id?: string }): User => ({ ...user, _id: user._id || user.id || '' });

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
  const [searchParams, setSearchParams] = useSearchParams();
  const [users, setUsers] = useState<User[]>([]);
  const [stats, setStats] = useState<Statistics | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState<'customer' | 'seller' | null>(null);
  const requestedRole = searchParams.get('role');
  const filter: 'all' | 'user' | 'seller' | 'admin' = requestedRole === 'user' || requestedRole === 'seller' || requestedRole === 'admin' ? requestedRole : 'all';
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showMessageModal, setShowMessageModal] = useState(false);
  const [messageData, setMessageData] = useState({ subject: '', message: '' });
  const [modalError, setModalError] = useState('');

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
      setUsers(response.data.map(normalizeUser));
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
    setModalError('');
    setEditingUser({ ...user });
    setShowEditModal(true);
  };

  const handleUpdateUser = async () => {
    if (!editingUser) return;
    if (!editingUser.firstName.trim() || !editingUser.lastName.trim() || !/^\S+@\S+\.\S+$/.test(editingUser.email)) { setModalError('Enter a first name, last name, and valid email address.'); return; }
    setModalError('');
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

      setUsers(users.map(u => u._id === editingUser._id ? normalizeUser(response.data.user) : u));
      setShowEditModal(false);
      setEditingUser(null);
      toast.success('User updated successfully');
    } catch (err: any) {
      console.error('Error updating user:', err);
      toast.error(err.response?.data?.message || 'Failed to update user');
    }
  };

  const handleSendMessage = async () => {
    setModalError('');
    if (!selectedUser || !messageData.subject || !messageData.message) {
      setModalError('Enter both a subject and message.');
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
    <main>
      <AdminHeading title={filter === 'user' ? 'Customers' : 'User management'} description={filter === 'user' ? 'Manage customer accounts and support requests.' : 'Manage customers, sellers, and administrator accounts.'}>
        <button className="admin-button" onClick={() => setCreating('seller')}>Add seller</button>
        <button className="admin-button admin-button--primary" onClick={() => setCreating('customer')}>Add customer</button>
      </AdminHeading>

        {creating && <section className="admin-panel mb-6 p-5" aria-label={`Create ${creating}`}>
          {creating === 'seller' ? <CreateSeller onCancel={() => setCreating(null)} /> : <CreateCustomer onCancel={() => setCreating(null)} onCreated={() => {
            setCreating(null); setSearchTerm(''); setSearchParams({ role: 'user' });
            toast.success('Customer created.'); void fetchUsers(); void fetchStats();
          }} />}
        </section>}

        {/* Statistics Cards */}
        {stats && (
          <section className="admin-panel mb-6" aria-label="Account totals">
            <div className="admin-stats admin-stats--accounts">
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
          </section>
        )}

        {/* Filters and Search */}
        <section className="admin-panel">
          <div className="admin-toolbar">
            {/* Search */}
            <div className="flex-1 w-full flex items-center border border-hairline bg-paper-raised overflow-hidden transition-colors duration-150 focus-within:border-brass">
              <div className="px-3.5 flex items-center border-r border-hairline">
                <Search size={16} className="text-brass" />
              </div>
              <label htmlFor="admin-user-search" className="sr-only">Search users by name or email</label>
              <input
                id="admin-user-search"
                type="search"
                aria-label="Search users by name or email"
                placeholder="Search by name or email…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="flex-1 px-3.5 py-2.5 text-sm text-ink bg-transparent outline-none"
              />
              {searchTerm && (
                <button onClick={() => setSearchTerm('')} aria-label="Clear user search" className="min-h-11 px-3.5 text-ink-muted hover:text-ink text-lg leading-none">×</button>
              )}
            </div>
            {/* Role filter pills */}
            <div className="admin-tabs mb-0 shrink-0" aria-label="Account role filters">
              {(['all', 'user', 'seller', 'admin'] as const).map((role) => (
                <button
                  key={role}
                  onClick={() => setSearchParams(role === 'all' ? {} : { role })}
                  aria-pressed={filter === role}
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
            <AdminEmptyState
              icon={<Users />}
              title={users.length ? 'No matching accounts' : 'No accounts yet'}
              description={users.length ? 'Try another search or role filter.' : 'Create the first customer or seller account for this marketplace.'}
              action={users.length
                ? <button className="admin-button" onClick={() => { setSearchTerm(''); setSearchParams({}); }}>Clear filters</button>
                : <><button className="admin-button admin-button--primary" onClick={() => setCreating('customer')}>Add first customer</button><button className="admin-button" onClick={() => setCreating('seller')}>Add seller</button></>}
            />
          ) : (
            <><div className="admin-table-wrap admin-desktop-table">
              <table className="admin-table">
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
                          {user.role === 'seller' ? <Link className="admin-text-link" to={'/admin/sellers/' + user._id}>{user.firstName} {user.lastName}</Link> : <>{user.firstName} {user.lastName}</>}
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
                          {user.role === 'seller' && <Link className="admin-button" to={'/admin/sellers/' + user._id}>View seller</Link>}
                          <button
                            onClick={() => handleEditUser(user)}
                            className="flex h-11 w-11 items-center justify-center text-ink-muted hover:text-brass active:scale-[0.97] transition"
                            aria-label={`Edit ${user.firstName} ${user.lastName}`}
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => {
                              setSelectedUser(user);
                              setModalError('');
                              setShowMessageModal(true);
                            }}
                            className="flex h-11 w-11 items-center justify-center text-ink-muted hover:text-ink active:scale-[0.97] transition"
                            aria-label={`Message ${user.firstName} ${user.lastName}`}
                          >
                            <Mail className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteUser(user._id, user.email)}
                            className="flex h-11 w-11 items-center justify-center text-ink-muted hover:text-seal active:scale-[0.97] transition"
                            aria-label={`Delete ${user.firstName} ${user.lastName}`}
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
            <div className="admin-mobile-cards">{filteredUsers.map(user => <article className="admin-mobile-card" key={user._id}><div><h2 className="font-semibold text-ink">{user.firstName} {user.lastName}</h2><p className="text-xs text-ink-muted">{user.email}</p></div><dl><div><dt>Role</dt><dd>{getRoleLabel(user.role, user.isVerified)}</dd></div><div><dt>Joined</dt><dd>{new Date(user.createdAt).toLocaleDateString()}</dd></div></dl><div className="admin-mobile-card-actions"><button className="admin-button" onClick={() => handleEditUser(user)}>Edit</button><button className="admin-button" onClick={() => { setSelectedUser(user); setShowMessageModal(true); setModalError(''); }}>Message</button></div></article>)}</div></>
          )}
        </section>

        <Dialog open={showEditModal && !!editingUser} title="Edit user details" description="Update the account information shown across ShopSphere." onClose={() => { setShowEditModal(false); setModalError(''); }} footer={<><Button variant="quiet" onClick={() => setShowEditModal(false)}>Cancel</Button><Button onClick={() => void handleUpdateUser()}>Update user</Button></>}>
          {editingUser && <div className="space-y-4">
            {modalError && <p className="text-sm text-seal" role="alert">{modalError}</p>}
            <Field id="edit-first-name" label="First name" required><input id="edit-first-name" data-autofocus value={editingUser.firstName} onChange={event => setEditingUser({ ...editingUser, firstName: event.target.value })} className="w-full rounded-[var(--radius-control)] border border-hairline bg-paper px-4 py-3" /></Field>
            <Field id="edit-last-name" label="Last name" required><input id="edit-last-name" value={editingUser.lastName} onChange={event => setEditingUser({ ...editingUser, lastName: event.target.value })} className="w-full rounded-[var(--radius-control)] border border-hairline bg-paper px-4 py-3" /></Field>
            <Field id="edit-email" label="Email" required><input id="edit-email" type="email" value={editingUser.email} onChange={event => setEditingUser({ ...editingUser, email: event.target.value })} className="w-full rounded-[var(--radius-control)] border border-hairline bg-paper px-4 py-3" /></Field>
            <Field id="edit-phone" label="Phone"><input id="edit-phone" type="tel" value={editingUser.phone || ''} onChange={event => setEditingUser({ ...editingUser, phone: event.target.value })} className="w-full rounded-[var(--radius-control)] border border-hairline bg-paper px-4 py-3" /></Field>
            {editingUser.role === 'seller' && <><Field id="edit-shop" label="Shop name" required><input id="edit-shop" value={editingUser.shopName || ''} onChange={event => setEditingUser({ ...editingUser, shopName: event.target.value })} className="w-full rounded-[var(--radius-control)] border border-hairline bg-paper px-4 py-3" /></Field><Field id="edit-shop-description" label="Shop description"><textarea id="edit-shop-description" rows={3} value={editingUser.shopDescription || ''} onChange={event => setEditingUser({ ...editingUser, shopDescription: event.target.value })} className="w-full rounded-[var(--radius-control)] border border-hairline bg-paper px-4 py-3" /></Field></>}
          </div>}
        </Dialog>
        <Dialog open={showMessageModal && !!selectedUser} title="Send message" description={selectedUser ? `This message will be emailed to ${selectedUser.email}.` : undefined} onClose={() => { setShowMessageModal(false); setModalError(''); }} footer={<><Button variant="quiet" onClick={() => setShowMessageModal(false)}>Cancel</Button><Button onClick={() => void handleSendMessage()}><Mail className="h-4 w-4" aria-hidden="true" />Send message</Button></>}>
          <div className="space-y-4">
            {modalError && <p className="text-sm text-seal" role="alert">{modalError}</p>}
            <Field id="message-subject" label="Subject" required><input id="message-subject" data-autofocus value={messageData.subject} onChange={event => setMessageData({ ...messageData, subject: event.target.value })} className="w-full rounded-[var(--radius-control)] border border-hairline bg-paper px-4 py-3" /></Field>
            <Field id="message-body" label="Message" required><textarea id="message-body" rows={6} value={messageData.message} onChange={event => setMessageData({ ...messageData, message: event.target.value })} className="w-full rounded-[var(--radius-control)] border border-hairline bg-paper px-4 py-3" /></Field>
          </div>
        </Dialog>
    </main>
  );
}

export default AdminUserManagement;
