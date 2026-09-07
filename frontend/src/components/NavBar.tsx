import { useContext, useEffect, useRef, useState, type FormEvent } from "react";
import { AdminContext } from "./admin/AdminContext";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { ChevronDown, Home, LogIn, LogOut, Menu, Search, Settings, ShoppingCart, UserCircle, X } from "lucide-react";
import axios from "axios";
import { toast } from "sonner";
import NotificationBell from "./NotificationBell";
import OrbitMark from "./OrbitMark";
import { logout } from "../lib/session";

const API = `${import.meta.env.VITE_BACKEND_URL || ""}/api/v1`;
type CartResponse = { items?: { quantity: number }[] };

const navLink = "flex min-h-10 items-center gap-1.5 rounded-[var(--radius-control)] px-3 text-sm font-medium text-ink-muted transition-colors hover:bg-paper hover:text-ink aria-[current=page]:bg-paper aria-[current=page]:text-ink";
const navLinkMobile = "flex min-h-12 w-full items-center gap-3 border-b border-hairline px-1 text-sm font-medium text-ink transition-colors hover:text-brass";
const menuItem = "flex min-h-10 w-full items-center gap-2 px-3 text-left text-sm text-ink transition-colors hover:bg-paper";

export default function NavBar() {
  const insideAdmin = useContext(AdminContext);
  const token = localStorage.getItem("token");
  const isAdmin = localStorage.getItem("isAdmin") === "true";
  const isSeller = localStorage.getItem("isSeller") === "true";
  const isBuyer = Boolean(token) && !isAdmin && !isSeller;
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [showSignOutModal, setShowSignOutModal] = useState(false);
  const [term, setTerm] = useState("");
  const [cartCount, setCartCount] = useState(0);
  const accountMenu = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const handleSignOut = () => {
    setIsMenuOpen(false);
    setIsAccountOpen(false);
    setShowSignOutModal(true);
  };

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
        setIsAccountOpen(false);
        setShowSignOutModal(false);
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, []);

  useEffect(() => {
    if (!isAccountOpen) return;
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !accountMenu.current?.contains(event.target)) setIsAccountOpen(false);
    };
    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
  }, [isAccountOpen]);

  // Re-read the bag on every navigation: cart edits happen on other pages, so a
  // badge fetched once goes stale the moment the shopper leaves the cart.
  useEffect(() => {
    if (!isBuyer) { setCartCount(0); return; }
    const controller = new AbortController();
    axios.get<CartResponse>(`${API}/cart/get`, { signal: controller.signal })
      .then(({ data }) => setCartCount(data?.items?.reduce((total, item) => total + item.quantity, 0) ?? 0))
      .catch(() => undefined);
    return () => controller.abort();
  }, [isBuyer, location.pathname]);

  const confirmSignOut = async () => {
    await logout();
    setShowSignOutModal(false);
    toast.success("Signed out successfully");
    navigate("/auth");
  };

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setIsMenuOpen(false);
    const query = term.trim();
    navigate(query ? `/?q=${encodeURIComponent(query)}` : "/");
  };

  // Same control in both breakpoints: one row on desktop, its own row under the brand on mobile.
  const searchForm = (className: string) => (
    <form role="search" onSubmit={submitSearch} className={className}>
      <label className="flex w-full items-center gap-2 rounded-[var(--radius-control)] border border-hairline bg-paper px-3 transition-colors focus-within:border-brass">
        <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-muted" />
        <span className="sr-only">Search products</span>
        <input
          type="search"
          value={term}
          onChange={event => setTerm(event.target.value)}
          placeholder="Search products"
          className="min-h-10 w-full bg-transparent text-sm text-ink placeholder:text-ink-muted focus:outline-none"
        />
      </label>
      <button
        type="submit"
        className="ml-2 hidden min-h-10 shrink-0 items-center rounded-[var(--radius-control)] bg-brass px-4 text-sm font-semibold text-white transition-colors hover:bg-brass-dark lg:flex"
      >
        Search
      </button>
    </form>
  );

  const accountLinks = isAdmin
    ? [{ to: "/admin", label: "Admin panel", icon: Settings }]
    : isSeller
      ? [{ to: "/seller-panel", label: "Seller panel", icon: Settings }, { to: "/profile", label: "My profile", icon: UserCircle }]
      : [{ to: "/profile", label: "My profile", icon: UserCircle }, { to: "/my-orders", label: "My orders", icon: ShoppingCart }];

  if (insideAdmin) return null;

  return (
    <>
    <a
      href="#customer-content"
      className="fixed left-3 top-3 z-[110] -translate-y-24 rounded-[var(--radius-control)] bg-ink px-4 py-2 text-sm font-semibold text-white transition-transform focus:translate-y-0"
      onClick={event => {
        const target = document.getElementById("customer-content");
        if (!target) return;
        event.preventDefault();
        target.focus();
      }}
    >
      Skip to content
    </a>
    <nav
      aria-label="Main navigation"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
      className="store-navigation sticky top-0 z-50 border-b border-hairline bg-paper-raised"
    >
      <div className="container-store">
        <div className="flex h-16 items-center gap-3">
          {/* Logo */}
          <Link
            to="/"
            className="flex shrink-0 items-center gap-2.5 rounded-[var(--radius-control)] text-ink transition-opacity hover:opacity-75"
          >
            <OrbitMark />
            <span className="text-lg font-bold tracking-[-0.035em] text-ink">
              Shop<span className="text-brass">Sphere</span>
            </span>
          </Link>

          {searchForm("hidden min-w-0 flex-1 md:flex md:max-w-xl")}

          <div className="ml-auto flex items-center gap-1">
            {/* Desktop Navigation */}
            <div className="hidden items-center gap-1 md:flex">
              <NavLink to="/" className={navLink}>Home</NavLink>
              {isBuyer && <NavLink to="/my-orders" className={navLink}>Orders</NavLink>}
              {token && isAdmin && (
                <NavLink to="/admin" className={navLink}>
                  <Settings className="w-3.5 h-3.5" /> Admin
                </NavLink>
              )}
              {token && isSeller && (
                <NavLink to="/seller-panel" className={navLink}>
                  <Settings className="w-3.5 h-3.5" /> Seller Panel
                </NavLink>
              )}
            </div>

            {token && <NotificationBell />}

            {isBuyer && (
              <NavLink
                to="/cart"
                aria-label="Cart"
                className="relative flex h-10 w-10 items-center justify-center rounded-[var(--radius-control)] text-ink transition-colors hover:bg-paper hover:text-brass aria-[current=page]:bg-paper aria-[current=page]:text-brass"
              >
                <ShoppingCart aria-hidden="true" className="h-5 w-5" />
                {cartCount > 0 && (
                  <span
                    aria-live="polite"
                    className="absolute right-0 top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brass px-1 text-[11px] font-semibold leading-none text-white"
                  >
                    {cartCount > 99 ? "99+" : cartCount}
                  </span>
                )}
              </NavLink>
            )}

            {token ? (
              <div className="relative hidden md:block" ref={accountMenu}>
                <button
                  type="button"
                  onClick={() => setIsAccountOpen(open => !open)}
                  aria-expanded={isAccountOpen}
                  aria-haspopup="menu"
                  className="flex min-h-10 items-center gap-1.5 rounded-[var(--radius-control)] border border-hairline px-3 text-sm font-medium text-ink transition-colors hover:border-ink hover:bg-paper"
                >
                  <UserCircle aria-hidden="true" className="h-4 w-4" /> Account
                  <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 text-ink-muted" />
                </button>
                {isAccountOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 top-[calc(100%+0.5rem)] w-52 overflow-hidden rounded-[var(--radius-surface)] border border-hairline bg-paper-raised py-1 shadow-float"
                  >
                    {accountLinks.map(({ to, label, icon: Icon }) => (
                      <Link key={to} role="menuitem" to={to} className={menuItem} onClick={() => setIsAccountOpen(false)}>
                        <Icon aria-hidden="true" className="h-4 w-4 text-ink-muted" /> {label}
                      </Link>
                    ))}
                    <button
                      role="menuitem"
                      type="button"
                      onClick={handleSignOut}
                      className={`${menuItem} mt-1 border-t border-hairline pt-1 text-seal`}
                    >
                      <LogOut aria-hidden="true" className="h-4 w-4" /> Sign out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <Link
                to="/auth"
                className="hidden min-h-10 items-center gap-1.5 rounded-[var(--radius-control)] border border-brass bg-brass px-4 text-sm font-semibold text-white transition-colors hover:border-brass-dark hover:bg-brass-dark md:flex"
              >
                <LogIn className="w-3.5 h-3.5" /> Sign In
              </Link>
            )}

            {/* Mobile Menu Button */}
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-control)] text-ink transition-colors hover:bg-paper hover:text-brass md:hidden"
              aria-label={isMenuOpen ? "Close menu" : "Open menu"}
              aria-expanded={isMenuOpen}
              aria-controls="mobile-navigation"
            >
              {isMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {searchForm("flex pb-3 md:hidden")}

        {/* Mobile Navigation */}
        {isMenuOpen && (
          <div id="mobile-navigation" className="border-t border-hairline pb-4 md:hidden">
            <NavLink to="/" className={navLinkMobile} onClick={() => setIsMenuOpen(false)}>
              <Home className="w-4 h-4" /> Home
            </NavLink>

            {isBuyer && (
              <>
                <NavLink to="/my-orders" className={navLinkMobile} onClick={() => setIsMenuOpen(false)}>
                  <ShoppingCart className="w-4 h-4" /> My Orders
                </NavLink>
                <NavLink to="/cart" className={navLinkMobile} onClick={() => setIsMenuOpen(false)}>
                  <ShoppingCart className="w-4 h-4" /> My Cart
                </NavLink>
                <NavLink to="/profile" className={navLinkMobile} onClick={() => setIsMenuOpen(false)}>
                  <UserCircle className="w-4 h-4" /> My Profile
                </NavLink>
              </>
            )}

            {token && isAdmin && (
              <NavLink to="/admin" className={navLinkMobile} onClick={() => setIsMenuOpen(false)}>
                <Settings className="w-4 h-4" /> Admin Panel
              </NavLink>
            )}

            {token && isSeller && (
              <>
                <NavLink to="/seller-panel" className={navLinkMobile} onClick={() => setIsMenuOpen(false)}>
                  <Settings className="w-4 h-4" /> Seller Panel
                </NavLink>
                <NavLink to="/profile" className={navLinkMobile} onClick={() => setIsMenuOpen(false)}>
                  <UserCircle className="w-4 h-4" /> My Profile
                </NavLink>
              </>
            )}

            {token ? (
              <button
                onClick={handleSignOut}
                className="mt-2 flex min-h-12 w-full items-center gap-2.5 rounded-[var(--radius-control)] px-1 text-sm font-medium text-ink transition-colors hover:text-seal"
              >
                <LogOut className="w-4 h-4" /> Sign Out
              </button>
            ) : (
              <Link
                to="/auth"
                className="mt-3 flex min-h-12 w-full items-center justify-center gap-2.5 rounded-[var(--radius-control)] bg-brass px-3 text-sm font-semibold text-white transition-colors hover:bg-brass-dark"
                onClick={() => setIsMenuOpen(false)}
              >
                <LogIn className="w-4 h-4" /> Sign In
              </Link>
            )}
          </div>
        )}
      </div>
    </nav>

      <span id="customer-content" tabIndex={-1} className="sr-only" />

      {/* Sign Out Confirmation Modal */}
      {showSignOutModal && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-ink/45 p-4 animate-overlay-in"
          onClick={() => setShowSignOutModal(false)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="signout-title"
            className="w-full max-w-[360px] origin-center rounded-[var(--radius-surface)] border border-hairline bg-paper-raised p-7 text-center shadow-float animate-panel-in"
            onClick={e => e.stopPropagation()}
          >
            <div className="w-14 h-14 rounded-full border border-seal/40 bg-seal/5 flex items-center justify-center mx-auto mb-4">
              <LogOut className="w-6 h-6 text-seal" />
            </div>
            <h2 id="signout-title" className="mb-2 text-xl font-semibold text-ink">Sign out?</h2>
            <p className="text-sm text-ink-muted mb-7 leading-relaxed">Are you sure you want to sign out of your account?</p>
            <div className="flex gap-2.5">
              <button
                onClick={() => setShowSignOutModal(false)}
                className="flex-1 py-2.5 text-sm font-semibold border border-hairline bg-transparent text-ink hover:bg-paper active:scale-[0.98] transition"
              >
                Cancel
              </button>
              <button
                onClick={confirmSignOut}
                className="flex-1 py-2.5 text-sm font-semibold bg-seal text-paper hover:bg-seal/90 active:scale-[0.98] transition"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
