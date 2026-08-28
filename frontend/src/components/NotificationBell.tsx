import React, { useEffect, useRef, useState } from "react";
import { Bell, X, CheckCheck, Package, AlertTriangle, ShoppingBag, Tag } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { getImageUrl } from "../lib/utils";

interface Notification {
  _id: string;
  type: "new_product" | "low_stock" | "order_update" | "discount";
  title: string;
  message: string;
  read: boolean;
  productId?: string;
  productName?: string;
  productImage?: string;
  createdAt: string;
}

const BACKEND = import.meta.env.VITE_BACKEND_URL;

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const token = localStorage.getItem("token");

  const fetchNotifications = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${BACKEND}/api/v1/notifications`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(data.notifications || []);
      setUnreadCount(data.unreadCount || 0);
    } catch (_) {}
  };

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const markRead = async (id: string) => {
    try {
      await fetch(`${BACKEND}/api/v1/notifications/read/${id}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}` },
      });
      setNotifications((prev) =>
        prev.map((n) => (n._id === id ? { ...n, read: true } : n))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch (_) {}
  };

  const markAllRead = async () => {
    try {
      await fetch(`${BACKEND}/api/v1/notifications/read-all`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}` },
      });
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch (_) {}
  };

  const deleteOne = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await fetch(`${BACKEND}/api/v1/notifications/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      setNotifications((prev) => prev.filter((n) => n._id !== id));
      setUnreadCount((c) => {
        const was = notifications.find((n) => n._id === id);
        return was && !was.read ? Math.max(0, c - 1) : c;
      });
    } catch (_) {}
  };

  const clearAll = async () => {
    try {
      await fetch(`${BACKEND}/api/v1/notifications`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      setNotifications([]);
      setUnreadCount(0);
    } catch (_) {}
  };

  const handleClick = (n: Notification) => {
    if (!n.read) markRead(n._id);
    if ((n.type === "new_product" || n.type === "discount") && n.productId) {
      setOpen(false);
      navigate(`/product-details-page?productId=${n.productId}`);
    } else if (n.type === "low_stock") {
      setOpen(false);
      navigate("/seller-panel");
    }
  };

  const getIcon = (type: Notification["type"]) => {
    if (type === "new_product") return <ShoppingBag className="w-5 h-5 text-brass" />;
    if (type === "low_stock") return <AlertTriangle className="w-5 h-5 text-seal" />;
    if (type === "discount") return <Tag className="w-5 h-5 text-seal" />;
    return <Package className="w-5 h-5 text-ink-muted" />;
  };

  if (!token) return null;

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell button */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-10 w-10 items-center justify-center rounded-[var(--radius-control)] text-ink-muted transition-colors hover:bg-paper hover:text-ink"
        title="Notifications"
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        aria-expanded={open}
        aria-controls="notification-panel"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute top-0.5 right-0.5 bg-seal text-paper rounded-full min-w-[18px] h-[18px] text-[11px] font-bold flex items-center justify-center px-1 leading-none">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div id="notification-panel" className="absolute right-0 top-[calc(100%+8px)] z-[1000] w-[360px] max-w-[calc(100vw-16px)] origin-top-right overflow-hidden rounded-[var(--radius-surface)] border border-hairline bg-paper-raised shadow-float animate-panel-in">
          {/* Header */}
          <div className="px-4 py-3.5 border-b border-brass/40 flex items-center justify-between bg-ink">
            <span className="text-paper font-bold text-[15px]">
              Notifications {unreadCount > 0 && `(${unreadCount} new)`}
            </span>
            <div className="flex gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  title="Mark all as read"
                  className="bg-paper/10 hover:bg-paper/20 text-paper px-2 py-1 text-xs flex items-center gap-1 transition"
                >
                  <CheckCheck className="w-4 h-4" /> All read
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  onClick={clearAll}
                  title="Clear all"
                  className="bg-paper/10 hover:bg-paper/20 text-paper px-2 py-1 text-xs transition"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* List */}
          <div className="max-h-[420px] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="py-10 px-4 text-center text-ink-muted">
                <Bell className="w-10 h-10 mx-auto mb-2 opacity-40" />
                <p className="text-sm">No notifications yet</p>
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n._id}
                  onClick={() => handleClick(n)}
                  className={`flex items-start gap-3 px-4 py-3 border-b border-hairline transition-colors relative ${
                    n.type === "new_product" || n.type === "low_stock" || n.type === "discount" ? "cursor-pointer" : ""
                  } ${n.read ? "bg-paper-raised hover:bg-paper" : "bg-brass-light/30 hover:bg-brass-light/50"}`}
                >
                  {/* Product thumbnail or icon */}
                  <div className="shrink-0 w-10 h-10 overflow-hidden flex items-center justify-center bg-paper border border-hairline">
                    {n.productImage ? (
                      <img
                        src={getImageUrl(n.productImage)}
                        alt={n.productName || ""}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      getIcon(n.type)
                    )}
                  </div>

                  {/* Text */}
                  <div className="flex-1 min-w-0">
                    <p className={`text-[13px] text-ink mb-0.5 truncate ${n.read ? "font-medium" : "font-bold"}`}>
                      {n.title}
                    </p>
                    <p className="text-xs text-ink-muted leading-snug line-clamp-2">
                      {n.message}
                    </p>
                    <p className="text-[11px] text-ink-muted/70 mt-1 tabular-nums">
                      {timeAgo(n.createdAt)}
                    </p>
                  </div>

                  {/* Unread dot */}
                  {!n.read && (
                    <div className="absolute right-9 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-brass shrink-0" />
                  )}

                  {/* Delete button */}
                  <button
                  onClick={(e) => deleteOne(e, n._id)}
                  title="Dismiss"
                  aria-label={`Dismiss ${n.title}`}
                    className="shrink-0 text-ink-muted/50 hover:text-ink p-0.5 transition"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
