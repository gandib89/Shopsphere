import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Lock, ArrowLeft, Shield } from 'lucide-react';
import { login } from '../lib/session';

const isDemo = import.meta.env.VITE_DEMO_MODE !== 'false';

const AdminAuth = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleAdminSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const user = await login(email, password);
      // login() no longer filters by role, so a non-admin's correct password
      // would otherwise get past this admin-only gate.
      if (!user.admin) {
        setError('This account does not have admin access.');
        return;
      }
      navigate('/admin');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Admin login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-paper">
      <div className="w-full max-w-md">
        {/* Back Button */}
        <button
          onClick={() => navigate('/auth-landing')}
          className="flex items-center gap-2 text-ink-muted hover:text-brass mb-8 transition"
        >
          <ArrowLeft className="w-5 h-5" />
          Back to Role Selection
        </button>

        {/* Card */}
        <div className="bg-paper-raised border border-hairline overflow-hidden">
          {/* Header */}
          <div className="bg-ink p-8 text-paper border-b border-brass/40">
            <div className="flex items-center gap-3 mb-4">
              <Shield className="w-7 h-7 text-brass" />
              <h1 className="font-display text-3xl font-bold">Admin Login</h1>
            </div>
            <p className="text-paper/60 text-sm">
              Platform Administrator Access{isDemo ? ' — Demo Only' : ''}
            </p>
          </div>

          {/* Content */}
          <div className="p-8">
            {/* Warning / Demo Note */}
            <div className="mb-6 p-4 border border-hairline">
              {isDemo ? (
                <>
                  <p className="text-sm text-ink-muted">
                    This admin login is provided for demo purposes only.
                  </p>
                  <p className="mt-2 text-sm font-mono text-ink">
                    shopsphere675@gmail.com / Qwerty@9876
                  </p>
                </>
              ) : (
                <p className="text-sm text-ink-muted">
                  This is an admin-only access zone. Unauthorized access is prohibited.
                </p>
              )}
            </div>

            {/* Error Message */}
            {error && (
              <div className="mb-4 p-4 border border-seal/40 bg-seal/5 text-seal text-sm">
                {error}
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleAdminSignIn}>
              {/* Email Field */}
              <div className="mb-4">
                <label className="block text-ink font-semibold mb-2 text-sm">
                  Admin Email
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3.5 w-5 h-5 text-ink-muted" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full pl-10 pr-4 py-3 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition"
                    placeholder="admin@shopsphere.com"
                    autoComplete="email"
                  />
                </div>
              </div>

              {/* Password Field */}
              <div className="mb-6">
                <label className="block text-ink font-semibold mb-2 text-sm">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3.5 w-5 h-5 text-ink-muted" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full pl-10 pr-4 py-3 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition"
                    placeholder="••••••••"
                    autoComplete="current-password"
                  />
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 font-semibold text-white bg-brass hover:bg-brass-dark active:scale-[0.98] transition disabled:opacity-50 disabled:active:scale-100"
              >
                {loading ? 'Authenticating...' : 'Sign In as Admin'}
              </button>
            </form>

            {/* Additional Security Info */}
            <div className="mt-6 p-4 border-t border-hairline">
              <p className="text-xs text-ink-muted text-center">
                All admin activities are logged and monitored for security purposes.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminAuth;
