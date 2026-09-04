import type { ReactNode } from 'react';
import { ArrowLeft, ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import OrbitMark from '../OrbitMark';
import './auth.css';

export function AuthShell({ children, backTo = '/', backLabel = 'Back to store' }: {
  children: ReactNode; backTo?: string; backLabel?: string;
}) {
  return (
    <div className="auth-page">
      <header className="auth-topbar">
        <Link to="/" className="auth-brand" aria-label="ShopSphere home">
          <OrbitMark size={30} /><span>ShopSphere</span>
        </Link>
        <Link to={backTo} className="auth-back"><ArrowLeft size={16} aria-hidden="true" />{backLabel}</Link>
      </header>
      <main className="auth-layout">
        <aside className="auth-editorial" aria-label="Welcome to ShopSphere">
          <img src="/images/shopsphere-redesign-hero.webp" alt="" className="auth-editorial-image" />
          <div className="auth-editorial-copy">
            <p className="auth-eyebrow">Technology, thoughtfully chosen</p>
            <h2>Good things.<br />All in one place.</h2>
            <p>Your next device, your orders, and a little help when you need it.</p>
          </div>
          <div className="auth-editorial-footer"><span>Made for your everyday.</span><ArrowUpRight size={20} aria-hidden="true" /></div>
        </aside>
        <section className="auth-content" aria-labelledby="auth-title">{children}</section>
      </main>
      <footer className="auth-footer"><span>ShopSphere · Nepal</span><span>A better way to buy technology.</span></footer>
    </div>
  );
}
