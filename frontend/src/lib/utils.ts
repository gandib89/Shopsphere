import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Rewrites localhost image URLs to the actual backend URL (needed for mobile/Capacitor)
export function getImageUrl(url: string | undefined | null): string {
  if (!url) return '/default-product.jpg';
  const base = (import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000/api').replace('/api', '');
  return url.replace(/^http:\/\/localhost:\d+/, base);
}