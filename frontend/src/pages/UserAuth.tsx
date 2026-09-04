import React, { useState, useMemo } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import axios from 'axios';
import { AuthShell } from '../components/auth/AuthShell';
import { AuthField, PasswordField, DemoAccess } from '../components/auth/AuthFields';
import { GoogleLogin, type CredentialResponse } from '@react-oauth/google';
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
  const [success, setSuccess] = useState('');

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const user = await login(email, password);
      navigate(user.seller ? '/seller-panel' : '/');
    } catch (err: unknown) {
      setError((axios.isAxiosError(err) ? err.response?.data?.message : null) || 'Login failed');
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
      setSuccess(isSeller
        ? 'Account created. Your seller account is awaiting approval. Sign in once approved to continue.'
        : 'Your account is ready. Sign in to start shopping.');
    } catch (err: unknown) {
      setError((axios.isAxiosError(err) ? err.response?.data?.message : null) || 'Sign up failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSuccess = async (credentialResponse: CredentialResponse) => {
    setError('');
    setLoading(true);
    try {
      if (!credentialResponse.credential) throw new Error('Missing Google credential');
      await googleLogin(credentialResponse.credential);
      navigate('/');
    } catch (err: unknown) {
      setError((axios.isAxiosError(err) ? err.response?.data?.message : null) || 'Google Sign-In failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleError = () => {
    setError('Google Sign-In failed. Please try again.');
  };

  return (
    <AuthShell backTo="/auth" backLabel="Account options">
      <p className="auth-kicker">{isSeller ? 'Seller account' : 'Customer account'}</p>
      <h1 id="auth-title">{isSignUp ? (isSeller ? 'Your shop starts here.' : 'Make it yours.') : 'Welcome back.'}</h1>
      <p className="auth-intro">{isSignUp
        ? (isSeller ? 'Create your seller account. We’ll review your shop before you start selling.' : 'Create an account to keep your purchases and order updates in one place.')
        : (isSeller ? 'Sign in to manage your products, inventory, and orders.' : 'Sign in to pick up where you left off.')}</p>
      {error && <p role="alert" className="auth-notice auth-notice--error">{error}</p>}
      {success && <p role="status" className="auth-notice auth-notice--success">{success}</p>}
      <form className="auth-form" onSubmit={isSignUp ? handleSignUp : handleSignIn} aria-busy={loading}>
        <fieldset disabled={loading}>
          <legend className="sr-only">{isSignUp ? 'Create account details' : 'Sign-in details'}</legend>
          {isSignUp && <>
            <div className="auth-name-row">
              <AuthField id="first-name" name="given-name" label="First name" autoComplete="given-name" value={firstName} onChange={e => setFirstName(e.target.value)} required placeholder="First name" />
              <AuthField id="last-name" name="family-name" label="Last name" autoComplete="family-name" value={lastName} onChange={e => setLastName(e.target.value)} required placeholder="Last name" />
            </div>
            <AuthField id="phone" name="tel" label="Phone number (optional)" type="tel" autoComplete="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+977" />
          </>}
          <AuthField id="email" name="email" label="Email address" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@example.com" />
          {isSignUp && isSeller && <>
            <AuthField id="shop-name" name="organization" label="Shop name" autoComplete="organization" value={shopName} onChange={e => setShopName(e.target.value)} required placeholder="Your shop name" />
            <div className="auth-field"><div className="auth-label-row"><label htmlFor="shop-description">Shop description (optional)</label></div><textarea id="shop-description" name="shopDescription" value={shopDescription} onChange={e => setShopDescription(e.target.value)} rows={2} placeholder="What does your shop offer?" /></div>
          </>}
          <PasswordField id="password" name="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete={isSignUp ? 'new-password' : 'current-password'} placeholder={isSignUp ? 'Create a password' : 'Enter your password'} aside={!isSignUp && <Link className="auth-text-link" to="/forgot-password">Forgot password?</Link>} />
          {isSignUp && <PasswordField id="confirm-password" name="confirmPassword" label="Confirm password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required autoComplete="new-password" placeholder="Enter your password again" />}
          <button type="submit" className="auth-primary" disabled={loading}>{loading ? (isSignUp ? 'Creating account…' : 'Signing in…') : (isSignUp ? 'Create account' : 'Sign in')}<ArrowRight size={18} aria-hidden="true" /></button>
        </fieldset>
      </form>
      {!isSignUp && !isSeller && <>
        <div className="auth-divider">or continue with</div>
        <div className="auth-google">{loading ? <p role="status">Signing in…</p> : <GoogleLogin onSuccess={handleGoogleSuccess} onError={handleGoogleError} theme="outline" size="large" />}</div>
      </>}
      <p className="auth-switch">{isSignUp ? 'Already have an account?' : 'New to ShopSphere?'}{' '}
        <button type="button" className="auth-text-link" disabled={loading} onClick={() => { setIsSignUp(!isSignUp); setError(''); setSuccess(''); }}>{isSignUp ? 'Sign in' : 'Create an account'}</button>
      </p>
      {!isSignUp && <DemoAccess role={isSeller ? 'seller' : 'user'} onFill={(demoEmail, demoPassword) => { setEmail(demoEmail); setPassword(demoPassword); setError(''); }} />}
    </AuthShell>
  );
};

export default UserAuth;
