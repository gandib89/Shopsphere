import { useState, type ReactNode } from 'react';
import { Menu, Moon, Search, ShoppingBag, Sun, UserCircle, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import OrbitMark from './OrbitMark';

type DemoHeaderProps = {
  homePath: string;
  homeLabel: string;
  navigationLabel: string;
  bagCount: number | null;
  accountActions?: ReactNode;
  darkMode?: boolean;
  onToggleTheme?: () => void;
  onSearch?: () => void;
  headerSearch?: ReactNode;
  onShop: () => void;
  onAbout: () => void;
  onContact: () => void;
  onAccount?: () => void;
  onBag?: () => void;
};

// Share the header styling while allowing each demo to choose its search control.
export default function DemoHeader({ homePath, homeLabel, navigationLabel, bagCount, accountActions, darkMode, onToggleTheme, onSearch, headerSearch, onShop, onAbout, onContact, onAccount, onBag }: DemoHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = (action: () => void) => {
    setMenuOpen(false);
    action();
  };

  return (
    <header className="ui-redesign-header">
      <div className="ui-redesign-shell ui-redesign-nav">
        <Link to={homePath} className="ui-redesign-brand" aria-label={homeLabel}>
          <OrbitMark size={27} />
          <span>ShopSphere</span>
        </Link>
        {headerSearch}
        <nav className="ui-redesign-links" aria-label={navigationLabel}>
          <button type="button" onClick={onShop}>Shop</button>
          <button type="button" onClick={onAbout}>About us</button>
          <button type="button" onClick={onContact}>Contact</button>
        </nav>
        <div className="ui-redesign-actions">
          {!headerSearch && onSearch && <button type="button" className="ui-icon-button" onClick={() => navigate(onSearch)} aria-label="Search products"><Search aria-hidden="true" /></button>}
          <button type="button" className="ui-icon-button ui-account-button" onClick={onAccount} aria-label="Your account"><UserCircle aria-hidden="true" /></button>
          {accountActions}
          <button type="button" className="ui-bag-button" onClick={onBag} aria-label={bagCount === null ? 'Shopping bag' : `Shopping bag with ${bagCount} items`}>
            <ShoppingBag aria-hidden="true" /><span>Bag</span>{bagCount !== null && <strong aria-live="polite">{bagCount}</strong>}
          </button>
          {onToggleTheme && (
            <button type="button" className="ui-icon-button" onClick={onToggleTheme} aria-label={darkMode ? 'Use light theme' : 'Use dark theme'}>
              {darkMode ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
            </button>
          )}
          <button type="button" className="ui-icon-button ui-menu-button" onClick={() => setMenuOpen((current) => !current)} aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen}>
            {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>
        </div>
      </div>
      {menuOpen && (
        <nav className="ui-redesign-mobile-nav" aria-label={`Mobile ${navigationLabel.toLowerCase()}`}>
          <button type="button" onClick={() => navigate(onShop)}>Shop</button>
          <button type="button" onClick={() => navigate(onAbout)}>About us</button>
          <button type="button" onClick={() => navigate(onContact)}>Contact</button>
        </nav>
      )}
    </header>
  );
}
