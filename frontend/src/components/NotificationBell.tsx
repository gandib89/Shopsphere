import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { productPath } from '../lib/routes';
import { AlertTriangle, Bell, CheckCheck, Package, ShoppingBag, Tag, X } from 'lucide-react';
import { authFetch } from '../lib/session';
import { getImageUrl } from '../lib/utils';

interface Notification { _id: string; type: 'new_product' | 'low_stock' | 'order_update' | 'discount'; title: string; message: string; read: boolean; productId?: string; productName?: string; productImage?: string; createdAt: string }
const backend = import.meta.env.VITE_BACKEND_URL;
const timeAgo = (value: string) => { const minutes = Math.floor((Date.now() - new Date(value).getTime()) / 60000); if (minutes < 1) return 'just now'; if (minutes < 60) return `${minutes}m ago`; const hours = Math.floor(minutes / 60); return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`; };

export default function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const token = localStorage.getItem('token');

  const fetchNotifications = useCallback(async () => {
    if (!token) return;
    try { const response = await authFetch(`${backend}/api/v1/notifications`); if (!response.ok) throw new Error(); const data = await response.json(); setNotifications(data.notifications || []); setUnreadCount(data.unreadCount || 0); setError(''); }
    catch { setError('Notifications are unavailable.'); }
  }, [token]);

  useEffect(() => { void fetchNotifications(); const timer = window.setInterval(() => void fetchNotifications(), 30000); return () => window.clearInterval(timer); }, [fetchNotifications]);
  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>('button')?.focus();
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); triggerRef.current?.focus(); } };
    const outside = (event: globalThis.MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('keydown', close); document.addEventListener('mousedown', outside);
    return () => { document.removeEventListener('keydown', close); document.removeEventListener('mousedown', outside); };
  }, [open]);

  const request = async (path: string, method: string) => { const response = await authFetch(`${backend}${path}`, { method }); if (!response.ok) throw new Error(); };
  const markRead = async (notification: Notification) => { if (notification.read) return; try { await request(`/api/v1/notifications/read/${notification._id}`, 'PUT'); setNotifications(previous => previous.map(item => item._id === notification._id ? { ...item, read: true } : item)); setUnreadCount(count => Math.max(0, count - 1)); } catch { setError('Could not update that notification.'); } };
  const openNotification = async (notification: Notification) => { await markRead(notification); if ((notification.type === 'new_product' || notification.type === 'discount') && notification.productId) { setOpen(false); navigate(productPath(notification.productId)); } else if (notification.type === 'low_stock') { setOpen(false); navigate('/seller-products?stock=lowstock'); } else if (notification.type === 'order_update') { setOpen(false); navigate('/my-orders'); } };
  const markAll = async () => { try { await request('/api/v1/notifications/read-all', 'PUT'); setNotifications(previous => previous.map(item => ({ ...item, read: true }))); setUnreadCount(0); } catch { setError('Could not mark notifications as read.'); } };
  const clearAll = async () => { try { await request('/api/v1/notifications', 'DELETE'); setNotifications([]); setUnreadCount(0); } catch { setError('Could not clear notifications.'); } };
  const dismiss = async (event: MouseEvent, notification: Notification) => { event.stopPropagation(); try { await request(`/api/v1/notifications/${notification._id}`, 'DELETE'); setNotifications(previous => previous.filter(item => item._id !== notification._id)); if (!notification.read) setUnreadCount(count => Math.max(0, count - 1)); } catch { setError('Could not dismiss that notification.'); } };
  const icon = (type: Notification['type']) => type === 'new_product' ? <ShoppingBag className="h-5 w-5 text-brass" /> : type === 'low_stock' ? <AlertTriangle className="h-5 w-5 text-seal" /> : type === 'discount' ? <Tag className="h-5 w-5 text-seal" /> : <Package className="h-5 w-5 text-ink-muted" />;

  if (!token) return null;
  return <div className="relative" ref={rootRef}>
    <button ref={triggerRef} onClick={() => setOpen(value => !value)} className="relative flex h-10 w-10 items-center justify-center rounded-[var(--radius-control)] text-ink-muted hover:bg-paper hover:text-ink" aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'} aria-haspopup="dialog" aria-expanded={open} aria-controls="notification-panel"><Bell className="h-5 w-5" aria-hidden="true" />{unreadCount > 0 && <span className="absolute right-0.5 top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-seal px-1 text-[11px] font-bold text-paper" aria-hidden="true">{unreadCount > 99 ? '99+' : unreadCount}</span>}</button>
    {open && <div ref={panelRef} id="notification-panel" role="dialog" aria-label="Notifications" className="absolute right-0 top-[calc(100%+8px)] z-[1000] w-[360px] max-w-[calc(100vw-16px)] overflow-hidden rounded-[var(--radius-surface)] border border-hairline bg-paper-raised shadow-float animate-panel-in">
      <header className="flex items-center justify-between gap-3 border-b border-brass/40 bg-ink px-4 py-3 text-paper"><h2 className="text-[15px] font-bold">Notifications {unreadCount > 0 && `(${unreadCount} new)`}</h2><div className="flex gap-1">{unreadCount > 0 && <button onClick={() => void markAll()} className="flex min-h-9 items-center gap-1 px-2 text-xs hover:bg-paper/10"><CheckCheck className="h-4 w-4" aria-hidden="true" />All read</button>}{notifications.length > 0 && <button onClick={() => void clearAll()} className="min-h-9 px-2 text-xs hover:bg-paper/10">Clear</button>}</div></header>
      {error && <p className="border-b border-seal/30 bg-seal/5 px-4 py-2 text-xs text-seal" role="alert">{error}</p>}
      <div className="max-h-[420px] overflow-y-auto">{notifications.length === 0 ? <div className="px-4 py-10 text-center text-sm text-ink-muted"><Bell className="mx-auto mb-2 h-10 w-10 opacity-40" aria-hidden="true" />No notifications yet</div> : notifications.map(notification => <div key={notification._id} className={`flex items-stretch border-b border-hairline ${notification.read ? 'bg-paper-raised' : 'bg-brass-light/30'}`}>
        <button onClick={() => void openNotification(notification)} className="flex min-w-0 flex-1 items-start gap-3 px-4 py-3 text-left hover:bg-paper"><span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden border border-hairline bg-paper" aria-hidden="true">{notification.productImage ? <img src={getImageUrl(notification.productImage)} alt="" className="h-full w-full object-cover" /> : icon(notification.type)}</span><span className="min-w-0 flex-1"><strong className="block truncate text-[13px] text-ink">{notification.title}</strong><span className="mt-0.5 line-clamp-2 block text-xs leading-snug text-ink-muted">{notification.message}</span><span className="mt-1 block text-[11px] text-ink-muted">{timeAgo(notification.createdAt)}{!notification.read && ' · unread'}</span></span></button>
        <button onClick={event => void dismiss(event, notification)} className="w-11 shrink-0 text-ink-muted hover:bg-paper hover:text-ink" aria-label={`Dismiss ${notification.title}`}><X className="mx-auto h-4 w-4" aria-hidden="true" /></button>
      </div>)}</div>
    </div>}
  </div>;
}
