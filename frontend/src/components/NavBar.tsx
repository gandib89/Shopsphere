import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ShoppingCart, Home, LogOut, LogIn, Settings, Menu, X, UserCircle } from "lucide-react";
import { toast } from "sonner";
import NotificationBell from "./NotificationBell";
import OrbitMark from "./OrbitMark";
import { logout } from "../lib/session";

const navLink = "flex min-h-10 items-center gap-1.5 rounded-[var(--radius-control)] px-3 text-sm font-medium text-ink-muted transition-colors hover:bg-paper hover:text-ink";
const navLinkMobile = "flex min-h-12 w-full items-center gap-3 border-b border-hairline px-1 text-sm font-medium text-ink transition-colors hover:text-brass";

export default function NavBar() {
  const token = localStorage.getItem("token");
  const isAdmin = localStorage.getItem("isAdmin") === "true";
  const isSeller = localStorage.getItem("isSeller") === "true";
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showSignOutModal, setShowSignOutModal] = useState(false);
  const navigate = useNavigate();

  const handleSignOut = () => {
    setIsMenuOpen(false);
    setShowSignOutModal(true);
  };

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
        setShowSignOutModal(false);
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, []);

  const confirmSignOut = async () => {
    await logout();
    setShowSignOutModal(false);
    toast.success("Signed out successfully");
    navigate("/auth");
  };

  return (
    <>
    <nav
      aria-label="Main navigation"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
      className="sticky top-0 z-50 border-b border-hairline bg-paper-raised"
    >
      <div className="container-store">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link
            to="/"
            className="flex items-center gap-2.5 rounded-[var(--radius-control)] text-ink transition-opacity hover:opacity-75"
          >
            <OrbitMark />
            <span className="text-lg font-bold tracking-[-0.035em] text-ink">
              Shop<span className="text-brass">Sphere</span>
            </span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-1">
            <Link to="/" className={navLink}>Home</Link>

            {token && !isAdmin && !isSeller && (
              <>
                <Link to="/my-orders" className={navLink}>Orders</Link>
                <Link to="/cart" className={navLink}>
                  <ShoppingCart className="w-3.5 h-3.5" /> Cart
                </Link>
                <Link to="/profile" className={navLink}>
                  <UserCircle className="w-3.5 h-3.5" /> Profile
                </Link>
              </>
            )}

            {token && isAdmin && (
              <Link to="/admin" className={navLink}>
                <Settings className="w-3.5 h-3.5" /> Admin
              </Link>
            )}

            {token && isSeller && (
              <>
                <Link to="/seller-panel" className={navLink}>
                  <Settings className="w-3.5 h-3.5" /> Seller Panel
                </Link>
                <Link to="/profile" className={navLink}>
                  <UserCircle className="w-3.5 h-3.5" /> Profile
                </Link>
              </>
            )}

            {token ? (
              <>
                <NotificationBell />
                <button
                  onClick={handleSignOut}
                  className="ml-2 flex min-h-10 items-center gap-1.5 rounded-[var(--radius-control)] border border-hairline px-4 text-sm font-semibold text-ink transition-colors hover:border-ink hover:bg-paper"
                >
                  <LogOut className="w-3.5 h-3.5" /> Sign Out
                </button>
              </>
            ) : (
              <Link
                to="/auth"
                className="ml-2 flex min-h-10 items-center gap-1.5 rounded-[var(--radius-control)] border border-brass bg-brass px-4 text-sm font-semibold text-white transition-colors hover:border-brass-dark hover:bg-brass-dark"
              >
                <LogIn className="w-3.5 h-3.5" /> Sign In
              </Link>
            )}
          </div>

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

        {/* Mobile Navigation */}
        {isMenuOpen && (
          <div id="mobile-navigation" className="border-t border-hairline pb-4 md:hidden">
            <Link to="/" className={navLinkMobile} onClick={() => setIsMenuOpen(false)}>
              <Home className="w-4 h-4" /> Home
            </Link>

            {token && !isAdmin && !isSeller && (
              <>
                <Link to="/my-orders" className={navLinkMobile} onClick={() => setIsMenuOpen(false)}>
                  <ShoppingCart className="w-4 h-4" /> My Orders
                </Link>
                <Link to="/cart" className={navLinkMobile} onClick={() => setIsMenuOpen(false)}>
                  <ShoppingCart className="w-4 h-4" /> My Cart
                </Link>
                <Link to="/profile" className={navLinkMobile} onClick={() => setIsMenuOpen(false)}>
                  <UserCircle className="w-4 h-4" /> My Profile
                </Link>
              </>
            )}

            {token && isAdmin && (
              <Link to="/admin" className={navLinkMobile} onClick={() => setIsMenuOpen(false)}>
                <Settings className="w-4 h-4" /> Admin Panel
              </Link>
            )}

            {token && isSeller && (
              <>
                <Link to="/seller-panel" className={navLinkMobile} onClick={() => setIsMenuOpen(false)}>
                  <Settings className="w-4 h-4" /> Seller Panel
                </Link>
                <Link to="/profile" className={navLinkMobile} onClick={() => setIsMenuOpen(false)}>
                  <UserCircle className="w-4 h-4" /> My Profile
                </Link>
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
