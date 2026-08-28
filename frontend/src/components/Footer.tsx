import { Link } from "react-router-dom";
import { Mail, Phone, MapPin } from "lucide-react";
import OrbitMark from "./OrbitMark";

const Footer = () => {
  const currentYear = new Date().getFullYear();
  const token = localStorage.getItem('token');
  const isLoggedIn = !!token;

  return (
    <footer className="border-t border-hairline bg-paper-raised" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="container-store py-10 sm:py-12">
        <div className="grid gap-9 lg:grid-cols-[1.15fr_2fr] lg:gap-16">
          <div>
            <div className="mb-4 flex items-center gap-2">
              <OrbitMark size={22} />
              <span className="text-lg font-semibold tracking-tight text-ink">
                Shop<span className="text-brass">Sphere</span>
              </span>
            </div>
            <p className="max-w-sm text-sm leading-relaxed text-ink-muted">
              A focused marketplace for premium Apple products and accessories, with vetted sellers and delivery across Nepal.
            </p>
            <ul className="mt-5 space-y-2 text-sm text-ink-muted">
              <li><a href="mailto:support@shopsphere.com" className="flex items-center gap-2 hover:text-brass"><Mail className="h-4 w-4 text-brass" aria-hidden="true" />support@shopsphere.com</a></li>
              <li><a href="tel:+9779800000000" className="flex items-center gap-2 hover:text-brass"><Phone className="h-4 w-4 text-brass" aria-hidden="true" />+977 9800000000</a></li>
              <li className="flex items-center gap-2"><MapPin className="h-4 w-4 text-brass" aria-hidden="true" />Masbar-7, Pokhara</li>
            </ul>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            <nav aria-label="Shop categories">
              <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.14em] text-ink">Shop</h2>
              <ul className="space-y-2.5">
              {[
                { to: "/", label: "All Products" },
                { to: "/?category=iPhone", label: "iPhone" },
                { to: "/?category=MacBook", label: "MacBook" },
                { to: "/?category=iPad", label: "iPad" },
                { to: "/?category=Apple+Watch", label: "Apple Watch" },
                { to: "/?category=Accessories", label: "Accessories" },
              ].map(({ to, label }) => (
                <li key={to}>
                  <Link to={to} className="text-sm text-ink-muted hover:text-brass transition">{label}</Link>
                </li>
              ))}
              </ul>
            </nav>

            <nav aria-label="Account links">
              <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.14em] text-ink">Account</h2>
              <ul className="space-y-2.5">
              {!isLoggedIn ? (
                <li>
                  <Link to="/auth" className="text-sm text-ink-muted hover:text-brass transition">Sign In</Link>
                </li>
              ) : (
                <>
                  <li>
                    <Link to="/profile" className="text-sm text-ink-muted hover:text-brass transition">My Profile</Link>
                  </li>
                  <li>
                    <Link to="/my-orders" className="text-sm text-ink-muted hover:text-brass transition">My Orders</Link>
                  </li>
                  <li>
                    <Link to="/cart" className="text-sm text-ink-muted hover:text-brass transition">My Cart</Link>
                  </li>
                </>
              )}
              </ul>
            </nav>

            <div>
              <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.14em] text-ink">Marketplace</h2>
              <p className="text-sm leading-relaxed text-ink-muted">Vetted sellers<br />eSewa payments<br />Nepal delivery<br />Local support</p>
            </div>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-2 border-t border-hairline pt-5 text-xs text-ink-muted sm:flex-row sm:items-center sm:justify-between">
          <p>© {currentYear} ShopSphere.</p>
          <p>Built for straightforward buying and selling.</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
