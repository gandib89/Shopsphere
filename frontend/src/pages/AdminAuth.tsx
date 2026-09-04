import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import axios from 'axios';
import { AuthShell } from '../components/auth/AuthShell';
import { AuthField, PasswordField, DemoAccess } from '../components/auth/AuthFields';
import { login } from '../lib/session';

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
    } catch (err: unknown) {
      setError((axios.isAxiosError(err) ? err.response?.data?.message : null) || 'Admin login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell backTo="/auth" backLabel="Account options">
      <p className="auth-kicker">Administrator access</p>
      <h1 id="auth-title">Manage the<br />marketplace.</h1>
      <p className="auth-intro">Sign in with an approved administrator account to continue.</p>
      {error && <p role="alert" className="auth-notice auth-notice--error">{error}</p>}
      <form className="auth-form" onSubmit={handleAdminSignIn} aria-busy={loading}>
        <fieldset disabled={loading}>
          <legend className="sr-only">Administrator sign-in details</legend>
          <AuthField id="admin-email" name="email" label="Admin email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@example.com" />
          <PasswordField id="admin-password" name="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" placeholder="Enter your password" />
          <button type="submit" className="auth-primary" disabled={loading}>{loading ? 'Signing in…' : 'Sign in as admin'}<ArrowRight size={18} aria-hidden="true" /></button>
        </fieldset>
      </form>
      <p className="auth-footnote">This workspace is reserved for authorized ShopSphere administrators.</p>
      <DemoAccess role="admin" onFill={(demoEmail, demoPassword) => { setEmail(demoEmail); setPassword(demoPassword); setError(''); }} />
    </AuthShell>
  );
};

export default AdminAuth;
