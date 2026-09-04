import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { RoleSelector, type AccountRole } from '../components/auth/RoleSelector';
import { AuthShell } from '../components/auth/AuthShell';
import { DemoAccess } from '../components/auth/AuthFields';

const destinations: Record<AccountRole, string> = { user: '/user-auth', seller: '/seller-auth', admin: '/admin-auth' };

const AuthLanding = () => {
  const navigate = useNavigate();
  const [role, setRole] = useState<AccountRole>('user');
  return (
    <AuthShell>
      <p className="auth-kicker">Your account, your space</p>
      <h1 id="auth-title">Welcome to<br />ShopSphere.</h1>
      <p className="auth-intro">Choose how you’d like to continue. We’ll take you to the right place.</p>
      <RoleSelector value={role} onChange={setRole} />
      <button className="auth-primary" onClick={() => navigate(destinations[role])}>Continue as {role === 'user' ? 'customer' : role}<ArrowRight size={18} aria-hidden="true" /></button>
      <p className="auth-footnote">New here? Customers and sellers can create an account on the next screen.</p>
      <DemoAccess role={role} />
    </AuthShell>
  );
};
export default AuthLanding;
