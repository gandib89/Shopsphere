import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { productPath } from '../lib/routes';
import { Button, IconButton } from './ui/Button';
import { useCompare, type CompareItem } from '../lib/compareStore';
import { specFields, specValue } from '../lib/productSpecs';
import '../pages/storefront-demo.css';

const formatNpr = (amount: number) => `NPR ${new Intl.NumberFormat('en-NP').format(amount)}`;

// The tray and its table are the same on every route, so both the catalogue and a product page
// render this one component and only supply what "buy" means where they sit.
type CompareBarProps = {
  onBuy?: (item: CompareItem) => void;
  buyLabel?: (item: CompareItem) => string;
  buyDisabled?: (item: CompareItem) => boolean;
};

export default function CompareBar({ onBuy, buyLabel, buyDisabled }: CompareBarProps) {
  const { items, category, remove, clear } = useCompare();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const navigate = useNavigate();

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  if (items.length === 0) return null;

  const rows: Array<{ label: string; value: (item: CompareItem) => string }> = [
    { label: 'Price', value: item => formatNpr(item.price) },
    { label: 'Previous price', value: item => (item.previousPrice ? formatNpr(item.previousPrice) : '—') },
    { label: 'Rating', value: item => (item.reviews ? `${item.rating} out of 5` : 'No reviews yet') },
    { label: 'Reviews', value: item => `${item.reviews ?? 0}` },
    { label: 'Availability', value: item => (item.inStock === false ? 'Sold out' : 'In stock') },
    { label: 'Highlight', value: item => item.description || '—' },
    // Spec rows come from the category's published field list, so both columns show the same
    // labels in the same order even when one product does not publish a value for a row.
    ...specFields(category || '').map(field => ({
      label: field,
      value: (item: CompareItem) => specValue(item.name, field),
    })),
  ];

  const buy = onBuy ?? (item => navigate(productPath(item.id)));
  const label = buyLabel ?? (() => 'View product');

  return (
    <>
      <div className="ux-demo-compare-tray" role="region" aria-label="Compare products">
        <p className="text-sm font-semibold">Comparing {category}</p>
        <ul className="ux-demo-compare-chips">
          {items.map(item => (
            <li key={item.id}>
              <span>{item.name}</span>
              <button type="button" aria-label={`Remove ${item.name} from comparison`} onClick={() => remove(item.id)}>
                <X aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="quiet" onClick={clear}>Clear</Button>
          <Button
            disabled={items.length < 2}
            onClick={event => { trigger.current = event.currentTarget; setOpen(true); }}
          >
            {items.length < 2 ? 'Pick one more' : `Compare ${items.length}`}
          </Button>
        </div>
      </div>

      {open && items.length > 1 && (
        <div
          className="fixed inset-0 z-50 flex bg-ink/35 p-4 sm:p-8"
          role="presentation"
          onClick={close}
          onKeyDown={event => { if (event.key === 'Escape') close(); }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="compare-title"
            className="m-auto flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-[var(--radius-surface)] border border-hairline bg-paper-raised shadow-float"
            onClick={event => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-hairline px-5 py-4">
              <h2 id="compare-title" className="font-semibold">Comparing {category}</h2>
              <IconButton autoFocus label="Close comparison" onClick={close}><X className="h-5 w-5" /></IconButton>
            </div>
            <div className="overflow-auto p-5">
              <table className="ux-demo-compare-table">
                <caption className="sr-only">{items.map(item => item.name).join(' compared with ')}</caption>
                <thead>
                  <tr>
                    <td />
                    {items.map(item => (
                      <th key={item.id} scope="col">
                        <span className="ux-demo-product-media block aspect-[4/3]" data-background={item.imageBackground ?? 'white'}>
                          <img src={item.image} alt="" className="h-full w-full object-contain" />
                        </span>
                        <span className="mt-2 block text-sm font-semibold">{item.name}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.label}>
                      <th scope="row">{row.label}</th>
                      {items.map(item => <td key={item.id}>{row.value(item)}</td>)}
                    </tr>
                  ))}
                  <tr>
                    <th scope="row">Buy</th>
                    {items.map(item => (
                      <td key={item.id}>
                        <Button className="w-full" disabled={buyDisabled?.(item)} onClick={() => buy(item)}>{label(item)}</Button>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
