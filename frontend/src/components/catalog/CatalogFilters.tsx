import { useEffect, useState, type CSSProperties } from 'react';
import type { StorefrontProduct } from '../StorefrontView';
import './catalog-filters.css';

type FilterChoice = { field: 'brands' | 'types'; value: string };
export type CatalogFilterValue = { price: [number, number] | null; inStock: boolean; brands: string[]; types: string[]; priority: FilterChoice[] };
export const emptyFilters: CatalogFilterValue = { price: null, inStock: false, brands: [], types: [], priority: [] };
export function productBrand(product: StorefrontProduct): string {
  if (product.brand?.trim()) return product.brand.trim();
  if (/\b(Apple|iPhone|iPad|MacBook|iMac|AirPods|Mac mini|Mac Studio|Mac Pro|Magic Keyboard|Magic Mouse|Magic Trackpad|AirTag)\b/i.test(product.name)) return 'Apple';
  const namedBrand = /^(Marshall|Ugreen|Beats|Havit|Rapoo|Anker|Belkin|Samsung|Sony|JBL|Logitech)\b/i.exec(product.name.trim());
  return namedBrand ? namedBrand[1][0].toUpperCase() + namedBrand[1].slice(1).toLowerCase() : ''; 
}
export function matchesCatalogFilters(product: StorefrontProduct, filters: CatalogFilterValue) {
  return (!filters.price || (product.price >= filters.price[0] && product.price <= filters.price[1]))
    && (!filters.inStock || product.inStock === true)
    && (!filters.brands.length || filters.brands.includes(productBrand(product)))
    && (!filters.types.length || filters.types.includes(product.category));
}
export function catalogFilterRank(product: StorefrontProduct, filters: CatalogFilterValue) {
  for (let index = filters.priority.length - 1; index >= 0; index -= 1) {
    const choice = filters.priority[index];
    if (choice.field === 'brands' ? productBrand(product) === choice.value : product.category === choice.value) return index;
  }
  return -1;
}

export default function CatalogFilters({ products, value, onChange }: {
  products: StorefrontProduct[]; value: CatalogFilterValue; onChange: (value: CatalogFilterValue) => void;
}) {
  const prices = products.map(product => product.price).filter(Number.isFinite);
  const lower = prices.length ? Math.floor(Math.min(...prices)) : 0;
  const upper = prices.length ? Math.ceil(Math.max(...prices)) : 0;
  const brands = [...new Set(products.map(productBrand).filter(Boolean))].sort();
  const types = [...new Set(products.map(product => product.category))].sort();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const active = Boolean(value.price || value.inStock || value.brands.length || value.types.length);
  const toggle = (field: 'brands' | 'types', item: string) => setDraft(current => {
    const selected = current[field].includes(item);
    const priority = current.priority.filter(choice => choice.field !== field || choice.value !== item);
    return {
      ...current,
      [field]: selected ? current[field].filter(entry => entry !== item) : [...current[field], item],
      priority: selected ? priority : [...priority, { field, value: item }],
    };
  });
  const reset = () => {
    setDraft(emptyFilters);
    onChange(emptyFilters);
  };
  return <aside className="catalog-filters" aria-label="Product filters" data-section-scroll-ignore>
    <details open>
      <summary>Filters <span className="catalog-filter-chevron" aria-hidden="true">⌄</span></summary>
      <div className="catalog-filter-body">
        <PriceFilter key={[lower, upper, value.price?.join('-')].join(':')} lower={lower} upper={upper} applied={value.price} onApply={price => onChange({ ...draft, price })} />
        <fieldset><legend>Status</legend><label className="catalog-check"><input type="checkbox" checked={draft.inStock} onChange={event => setDraft(current => ({ ...current, inStock: event.target.checked }))} />In stock</label></fieldset>
        {brands.length > 0 && <fieldset><legend>Brand</legend>{brands.map(brand => <label className="catalog-check" key={brand}><input type="checkbox" checked={draft.brands.includes(brand)} onChange={() => toggle('brands', brand)} />{brand}</label>)}</fieldset>}
        {types.length > 0 && <fieldset><legend>Type</legend>{types.map(type => <label className="catalog-check" key={type}><input type="checkbox" checked={draft.types.includes(type)} onChange={() => toggle('types', type)} />{type}</label>)}</fieldset>}
        {active && <button type="button" className="catalog-reset" onClick={reset}>Reset filters</button>}
      </div>
    </details>
  </aside>;
}

function PriceFilter({ lower, upper, applied, onApply }: { lower: number; upper: number; applied: [number, number] | null; onApply: (price: [number, number] | null) => void }) {
  const [minimum, setMinimum] = useState(String(applied?.[0] ?? lower));
  const [maximum, setMaximum] = useState(String(applied?.[1] ?? upper));
  const min = Number(minimum), max = Number(maximum);
  const valid = minimum !== '' && maximum !== '' && Number.isFinite(min) && Number.isFinite(max) && min >= lower && max <= upper && min <= max;
  const span = upper - lower || 1;
  const style = { '--range-start': Math.max(0, Math.min(100, (min - lower) / span * 100)) + '%', '--range-end': Math.max(0, Math.min(100, (max - lower) / span * 100)) + '%' } as CSSProperties;
  return <form className="catalog-price" onSubmit={event => { event.preventDefault(); if (valid) onApply(min === lower && max === upper ? null : [min, max]); }}>
    <fieldset><legend>Price</legend>
      <div className="catalog-price-inputs">
        <label><span>NPR</span><input aria-label="Minimum price" type="number" min={lower} max={upper} step="any" value={minimum} onChange={event => setMinimum(event.target.value)} /></label>
        <span>to</span>
        <label><span>NPR</span><input aria-label="Maximum price" type="number" min={lower} max={upper} step="any" value={maximum} onChange={event => setMaximum(event.target.value)} /></label>
      </div>
      <div className="catalog-price-range" style={style}>
        <div className="catalog-range-track" />
        <input aria-label="Minimum price slider" type="range" min={lower} max={upper} disabled={lower === upper} value={Math.max(lower, Math.min(upper, min))} onChange={event => setMinimum(String(Math.min(Number(event.target.value), max)))} />
        <input aria-label="Maximum price slider" type="range" min={lower} max={upper} disabled={lower === upper} value={Math.max(lower, Math.min(upper, max))} onChange={event => setMaximum(String(Math.max(Number(event.target.value), min)))} />
      </div>
      {!valid && <p className="catalog-price-error" role="status">Enter a valid minimum and maximum within this range.</p>}
      <button type="submit" className="catalog-apply" disabled={!valid || lower === upper}>Apply</button>
    </fieldset>
  </form>;
}
