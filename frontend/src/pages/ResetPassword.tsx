import React, { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Lock, ArrowLeft } from 'lucide-react';
import axios from 'axios';

const ResetPassword = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      await axios.post(`${import.meta.env.VITE_BACKEND_URL}/api/v1/auth/reset-password`, { token, newPassword });
      setDone(true);
      setTimeout(() => navigate('/user-auth'), 2500);
    } catch (err: any) {
      setError(err.response?.data?.message || 'This reset link is invalid or has expired.');
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-paper">
        <div className="w-full max-w-md bg-paper-raised border border-hairline p-8 text-center">
          <p className="text-seal font-semibold mb-4">This reset link is missing its token.</p>
          <Link to="/forgot-password" className="text-brass hover:text-brass-dark font-semibold text-sm">
            Request a new reset link
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-paper">
      <div className="w-full max-w-md">
        <button
          onClick={() => navigate('/user-auth')}
          className="flex items-center gap-2 text-ink-muted hover:text-brass mb-6 transition"
        >
          <ArrowLeft className="w-5 h-5" />
          Back to Sign In
        </button>

        <div className="bg-paper-raised border border-hairline overflow-hidden">
          <div className="bg-ink p-6 sm:p-8 text-paper border-b border-brass/40">
            <h1 className="text-2xl sm:text-3xl font-bold">Set a new password</h1>
          </div>

          <div className="p-5 sm:p-8">
            {done ? (
              <div className="text-center py-4">
                <p className="text-ink font-semibold mb-2">Password updated</p>
                <p className="text-ink-muted text-sm">
                  You've been signed out everywhere for safety. Redirecting to sign in...
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit}>
                {error && (
                  <div className="mb-4 p-4 border border-seal/40 bg-seal/5 text-seal text-sm">
                    {error}
                  </div>
                )}
                <div className="mb-4">
                  <label className="block text-ink font-semibold mb-2 text-sm">New Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-3.5 w-5 h-5 text-ink-muted" />
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      className="w-full pl-10 pr-4 py-3 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition text-sm"
                      placeholder="At least 8 characters"
                    />
                  </div>
                </div>
                <div className="mb-6">
                  <label className="block text-ink font-semibold mb-2 text-sm">Confirm New Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-3.5 w-5 h-5 text-ink-muted" />
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      className="w-full pl-10 pr-4 py-3 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition text-sm"
                      placeholder="••••••••"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 font-semibold text-white bg-brass hover:bg-brass-dark active:scale-[0.97] transition disabled:opacity-50 disabled:active:scale-100"
                >
                  {loading ? 'Updating...' : 'Update Password'}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;
