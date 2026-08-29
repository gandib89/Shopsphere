import { useState } from 'react';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import OrbitMark from '../components/OrbitMark';
import { RoleSelector, type AccountRole } from '../components/auth/RoleSelector';
import { Button } from '../components/ui/Button';

const destinations: Record<AccountRole, string> = {
  user: '/user-auth',
  seller: '/seller-auth',
  admin: '/admin-auth',
};

const isDemo = import.meta.env.VITE_DEMO_MODE !== 'false';

const AuthLanding = () => {
  const navigate = useNavigate();
  const [role, setRole] = useState<AccountRole>('user');

  return (
    <main className="min-h-screen bg-paper">
      <div className="container-store flex min-h-screen items-center py-6 sm:py-10">
        <div className="grid w-full overflow-hidden rounded-[var(--radius-surface)] border border-hairline bg-paper-raised lg:grid-cols-[0.9fr_1.1fr]">
          <section className="p-6 sm:p-10 lg:p-14">
            <Link to="/" className="inline-flex min-h-10 items-center gap-2 rounded-[var(--radius-control)] text-sm font-medium text-ink-muted hover:text-ink">
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
              Back to store
            </Link>

            <div className="mt-8 flex items-center gap-2.5">
              <OrbitMark size={28} />
              <span className="text-xl font-bold tracking-[-0.04em] text-ink">Shop<span className="text-brass">Sphere</span></span>
            </div>

            <div className="mt-8 max-w-md">
              <p className="text-sm font-semibold text-brass">Welcome back</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-4xl">Choose your workspace.</h1>
              <p className="mt-3 text-sm leading-relaxed text-ink-muted">Your account type determines the tools and information you’ll see after signing in.</p>
            </div>

            <div className="mt-7 max-w-md">
              <RoleSelector value={role} onChange={setRole} />
              <Button className="mt-5 w-full" size="lg" onClick={() => navigate(destinations[role])}>
                Continue as {role === 'user' ? 'customer' : role}
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Button>
              <p className="mt-4 text-center text-xs text-ink-muted">New customers and sellers can create an account on the next screen.</p>

              {isDemo && (
                <div className="mt-6 rounded-[var(--radius-control)] border border-hairline bg-paper p-4 text-xs text-ink-muted">
                  <p className="font-semibold text-ink">Demo credentials</p>
                  <p className="mt-1">Admin sign-in is provided for demo purposes only.</p>
                  <ul className="mt-2 space-y-1 font-mono">
                    <li>Customer: customer1@shopsphere.test / ShopSphereDemo!2026</li>
                    <li>Seller: seller1@shopsphere.test / ShopSphereDemo!2026</li>
                    <li>Admin: shopsphere675@gmail.com / Qwerty@9876</li>
                  </ul>
                </div>
              )}
            </div>
          </section>

          <aside className="hidden bg-ink p-12 text-white lg:flex lg:flex-col lg:justify-between">
            <div>
              <p className="text-sm font-semibold text-brass-light">One marketplace. Clear responsibilities.</p>
              <h2 className="mt-3 max-w-md text-4xl font-semibold leading-tight tracking-[-0.04em]">Buy with confidence. Operate without clutter.</h2>
            </div>
            <ul className="mt-12 space-y-5 text-sm text-white/72">
              {[
                'Current stock and pricing from vetted sellers',
                'Role-specific order and inventory tools',
                'Secure eSewa checkout for Nepal',
              ].map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brass text-white"><Check aria-hidden="true" className="h-3 w-3" /></span>
                  {item}
                </li>
              ))}
            </ul>
            <p className="mt-12 text-xs text-white/45">ShopSphere · Pokhara, Nepal</p>
          </aside>
        </div>
      </div>
    </main>
  );
};

export default AuthLanding;
