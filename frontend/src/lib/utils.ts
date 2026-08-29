import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Rewrites localhost image URLs to the actual backend URL (needed for mobile/Capacitor)
export function getImageUrl(url: string | undefined | null): string {
  if (!url) return '/default-product.jpg';
  const base = getBackendOrigin();
  return url.replace(/^http:\/\/localhost:\d+/, base);
}

export function getBackendOrigin(): string {
  const configured = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/api\/?$/, '');
  return configured || window.location.origin;
}
