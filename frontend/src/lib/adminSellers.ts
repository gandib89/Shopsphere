import { useEffect, useState } from 'react';
import { authFetch } from './session';

export type AdminSeller = {
  id: string; firstName: string; lastName: string; email: string; phone?: string | null;
  shopName?: string | null; shopDescription?: string | null; isVerified: boolean;
  createdAt: string; verificationRequestDate?: string | null; verificationApprovedDate?: string | null;
  verificationRejectionReason?: string | null;
};
export type SellerProduct = { id: string; name: string; category: string; quantity: number; price: number; images: string[] };
export type SellerOrder = { id: string; firstName: string; lastName: string; totalPrice: number; quantity: number; status: string; createdAt: string; product?: { name: string } };
export type SellerList = { items: AdminSeller[]; total: number; page: number; pageSize: number };
export type SellerDetail = { seller: AdminSeller; items: (SellerProduct | SellerOrder)[]; total: number; page: number; pageSize: number; view: 'products' | 'orders' };
export const sellerName = (seller: AdminSeller) => seller.shopName || [seller.firstName, seller.lastName].filter(Boolean).join(' ') || 'Unnamed shop';
export const sellerStatus = (seller: AdminSeller) => seller.isVerified ? 'Verified' : seller.verificationRejectionReason ? 'Rejected' : 'Pending verification';

export function useAdminSellerResource<T>(path: string) {
  const [state, setState] = useState<{ path: string; data: T | null; error: string; loading: boolean }>({ path, data: null, error: '', loading: true });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ path, data: null, error: '', loading: true });
    void (async () => {
      try {
        const response = await authFetch(`${import.meta.env.VITE_BACKEND_URL}/api/v1/users/sellers${path}`, { signal: controller.signal });
        if (!response.ok) throw new Error(response.status === 404 ? 'Seller not found. This account may no longer be a seller.' : response.status === 401 || response.status === 403 ? 'Administrator access is required. Please sign in again.' : 'Could not load seller information. Please try again.');
        const data = await response.json() as T;
        if (!controller.signal.aborted) setState({ path, data, error: '', loading: false });
      } catch (err) {
        if (!controller.signal.aborted) setState({ path, data: null, error: err instanceof Error ? err.message : 'Could not load seller information.', loading: false });
      }
    })();
    return () => controller.abort();
  }, [path, version]);
  return { ...(state.path === path ? state : { data: null, error: '', loading: true }), reload: () => setVersion(value => value + 1) };
}
