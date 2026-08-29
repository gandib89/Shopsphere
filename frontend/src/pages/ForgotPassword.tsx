import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, ArrowLeft } from 'lucide-react';
import axios from 'axios';

const ForgotPassword = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await axios.post(`${import.meta.env.VITE_BACKEND_URL}/api/v1/auth/forgot-password`, { email });
      // Always show the same success state regardless of whether the email exists —
      // the backend deliberately never reveals that, so the UI shouldn't either.
      setSent(true);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

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
            <h1 className="text-2xl sm:text-3xl font-bold">Reset your password</h1>
            <p className="text-paper/60 text-sm mt-2">
              Enter your account email and we'll send you a link to reset it.
            </p>
          </div>

          <div className="p-5 sm:p-8">
            {sent ? (
              <div className="text-center py-4">
                <p className="text-ink font-semibold mb-2">Check your inbox</p>
                <p className="text-ink-muted text-sm">
                  If an account exists for <span className="font-semibold text-ink">{email}</span>, a
                  reset link is on its way. The link expires in 1 hour.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit}>
                {error && (
                  <div className="mb-4 p-4 border border-seal/40 bg-seal/5 text-seal text-sm">
                    {error}
                  </div>
                )}
                <div className="mb-6">
                  <label className="block text-ink font-semibold mb-2 text-sm">Email Address</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-3.5 w-5 h-5 text-ink-muted" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoComplete="email"
                      className="w-full pl-10 pr-4 py-3 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition text-sm"
                      placeholder="you@example.com"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 font-semibold text-white bg-brass hover:bg-brass-dark active:scale-[0.97] transition disabled:opacity-50 disabled:active:scale-100"
                >
                  {loading ? 'Sending...' : 'Send Reset Link'}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
