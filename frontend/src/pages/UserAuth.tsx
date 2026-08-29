import React, { useState, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Mail, Lock, Store, ArrowLeft, ShoppingBag } from 'lucide-react';
import { GoogleLogin } from '@react-oauth/google';
import { login, register, googleLogin } from '../lib/session';

const UserAuth = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const isSeller = useMemo(() => location.pathname === '/seller-auth', [location.pathname]);

  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [shopName, setShopName] = useState('');
  const [shopDescription, setShopDescription] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await login(email, password);
      navigate(user.seller ? '/seller-panel' : '/');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      await register({
        email,
        password,
        firstName,
        lastName,
        phone,
        role: isSeller ? 'seller' : 'user',
        ...(isSeller && { shopName, shopDescription }),
      });
      setEmail(''); setPassword(''); setConfirmPassword('');
      setFirstName(''); setLastName(''); setPhone('');
      setShopName(''); setShopDescription('');
      setIsSignUp(false);
      if (isSeller) {
        alert('✅ Account created successfully!\n\n⏳ Your seller account is pending admin approval.\n\nPlease sign in to continue once approved.');
      } else {
        alert('✅ Account created successfully!\n\nPlease log in to continue.');
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Sign up failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSuccess = async (credentialResponse: any) => {
    setError('');
    setLoading(true);
    try {
      await googleLogin(credentialResponse.credential);
      navigate('/');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Google Sign-In failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleError = () => {
    setError('Google Sign-In failed. Please try again.');
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-paper">
      <div className="w-full max-w-md">
        {/* Back Button */}
        <button
          onClick={() => navigate('/auth-landing')}
          className="flex items-center gap-2 text-ink-muted hover:text-brass mb-6 transition"
        >
          <ArrowLeft className="w-5 h-5" />
          Back to Role Selection
        </button>

        {/* Card */}
        <div className="bg-paper-raised border border-hairline overflow-hidden">
          {/* Header */}
          <div className="bg-ink p-6 sm:p-8 text-paper border-b border-brass/40">
            <div className="flex items-center gap-3 mb-3">
              {isSeller ? <Store className="w-8 h-8 text-brass" /> : <ShoppingBag className="w-8 h-8 text-brass" />}
              <h1 className="text-2xl sm:text-3xl font-bold">
                {isSignUp ? 'Create Account' : 'Welcome Back'}
              </h1>
            </div>
            <p className="text-paper/60 text-sm">
              {isSeller ? 'Seller Account' : 'Customer Account'}
            </p>
          </div>

          {/* Content */}
          <div className="p-5 sm:p-8">
            {error && (
              <div className="mb-4 p-4 border border-seal/40 bg-seal/5 text-seal text-sm">
                {error}
              </div>
            )}

            <form onSubmit={isSignUp ? handleSignUp : handleSignIn}>
              {/* Name Fields (Sign Up Only) */}
              {isSignUp && (
                <>
                  <div className="mb-4 grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-ink font-semibold mb-2 text-sm">First Name</label>
                      <input
                        type="text"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        required
                        className="w-full px-4 py-3 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition text-sm"
                        placeholder="Ram"
                      />
                    </div>
                    <div>
                      <label className="block text-ink font-semibold mb-2 text-sm">Last Name</label>
                      <input
                        type="text"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        required
                        className="w-full px-4 py-3 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition text-sm"
                        placeholder="Thapa"
                      />
                    </div>
                  </div>
                  <div className="mb-4">
                    <label className="block text-ink font-semibold mb-2 text-sm">Phone Number</label>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full px-4 py-3 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition text-sm"
                      placeholder="+977 9800000000"
                    />
                  </div>
                </>
              )}

              {/* Email */}
              <div className="mb-4">
                <label className="block text-ink font-semibold mb-2 text-sm">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3.5 w-5 h-5 text-ink-muted" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full pl-10 pr-4 py-3 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition text-sm"
                    placeholder="you@example.com"
                    autoComplete="email"
                  />
                </div>
              </div>

              {/* Shop Name (Seller Sign Up Only) */}
              {isSignUp && isSeller && (
                <div className="mb-4">
                  <label className="block text-ink font-semibold mb-2 text-sm">Shop Name</label>
                  <input
                    type="text"
                    value={shopName}
                    onChange={(e) => setShopName(e.target.value)}
                    required
                    className="w-full px-4 py-3 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition text-sm"
                    placeholder="Your Shop Name"
                  />
                </div>
              )}

              {/* Shop Description (Seller Sign Up Only) */}
              {isSignUp && isSeller && (
                <div className="mb-4">
                  <label className="block text-ink font-semibold mb-2 text-sm">Shop Description</label>
                  <textarea
                    value={shopDescription}
                    onChange={(e) => setShopDescription(e.target.value)}
                    className="w-full px-4 py-3 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition text-sm"
                    placeholder="Tell us about your shop..."
                    rows={3}
                  />
                </div>
              )}

              {/* Password */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-ink font-semibold text-sm">Password</label>
                  {!isSignUp && (
                    <button
                      type="button"
                      onClick={() => navigate('/forgot-password')}
                      className="text-brass hover:text-brass-dark transition text-xs font-semibold"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-3.5 w-5 h-5 text-ink-muted" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full pl-10 pr-4 py-3 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition text-sm"
                    placeholder="••••••••"
                    autoComplete={isSignUp ? 'new-password' : 'current-password'}
                  />
                </div>
              </div>

              {/* Confirm Password (Sign Up Only) */}
              {isSignUp && (
                <div className="mb-6">
                  <label className="block text-ink font-semibold mb-2 text-sm">Confirm Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-3.5 w-5 h-5 text-ink-muted" />
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      className="w-full pl-10 pr-4 py-3 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition text-sm"
                      placeholder="••••••••"
                      autoComplete="new-password"
                    />
                  </div>
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 font-semibold text-white bg-brass hover:bg-brass-dark active:scale-[0.97] transition disabled:opacity-50 disabled:active:scale-100"
              >
                {loading ? 'Loading...' : isSignUp ? 'Create Account' : 'Sign In'}
              </button>

              {/* Google Sign-In (Customer Sign In Only) */}
              {!isSignUp && !isSeller && (
                <>
                  <div className="relative my-6">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-hairline"></div>
                    </div>
                    <div className="relative flex justify-center text-sm">
                      <span className="px-2 bg-paper-raised text-ink-muted">Or continue with</span>
                    </div>
                  </div>
                  <div className="flex justify-center">
                    <GoogleLogin onSuccess={handleGoogleSuccess} onError={handleGoogleError} theme="outline" size="large" />
                  </div>
                </>
              )}
            </form>

            {/* Toggle Sign In/Up */}
            <p className="text-center text-ink-muted mt-6 text-sm">
              {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
              <button
                type="button"
                onClick={() => { setIsSignUp(!isSignUp); setError(''); }}
                className="text-brass hover:text-brass-dark transition font-semibold"
              >
                {isSignUp ? 'Sign In' : 'Sign Up'}
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserAuth;
