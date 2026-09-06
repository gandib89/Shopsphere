import { useSyncExternalStore } from 'react';

// The compare list follows the shopper across routes: pick a phone on the storefront, open
// another product page, add that one too, then open the table from the tray. A module-level
// store (rather than a context) keeps every surface — catalogue cards, product pages, the tray —
// reading the same list without threading a provider through the router.

export type CompareItem = {
  id: string;
  name: string;
  category: string;
  price: number;
  previousPrice?: number;
  rating?: number;
  reviews?: number;
  image: string;
  imageBackground?: 'white' | 'dark';
  inStock?: boolean;
  description?: string;
};

// Three columns is what a comparison table can show without turning into a horizontal scroll.
export const MAX_COMPARE = 3;

const STORAGE_KEY = 'shopsphere.compare';

const read = (): CompareItem[] => {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(stored) ? stored.filter(item => item?.id && item?.name).slice(0, MAX_COMPARE) : [];
  } catch {
    return [];
  }
};

let items: CompareItem[] = read();
const listeners = new Set<() => void>();

const commit = (next: CompareItem[]) => {
  items = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // A private window with storage blocked still compares, it just forgets on reload.
  }
  listeners.forEach(listener => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// A phone against a watch shares no row worth reading across, so the first pick fixes the
// category and every product outside it stops offering the toggle.
const lockedCategory = () => items[0]?.category ?? null;

export const compareStore = {
  items: () => items,
  has: (id: string) => items.some(item => item.id === id),
  locked: (item: CompareItem) =>
    !compareStore.has(item.id) &&
    (items.length >= MAX_COMPARE || (lockedCategory() !== null && item.category !== lockedCategory())),
  toggle: (item: CompareItem) => {
    if (compareStore.has(item.id)) return commit(items.filter(current => current.id !== item.id));
    if (compareStore.locked(item)) return;
    commit([...items, item]);
  },
  remove: (id: string) => commit(items.filter(item => item.id !== id)),
  clear: () => commit([]),
};

export function useCompare() {
  const list = useSyncExternalStore(subscribe, compareStore.items, compareStore.items);
  return {
    items: list,
    category: list[0]?.category ?? null,
    has: compareStore.has,
    locked: compareStore.locked,
    toggle: compareStore.toggle,
    remove: compareStore.remove,
    clear: compareStore.clear,
  };
}
