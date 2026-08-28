import { LockKeyhole } from 'lucide-react';
import { Button } from '../ui/Button';

type CartSummaryProps = {
  itemCount: number;
  subtotal: number;
  onCheckout: () => void;
};

const formatMoney = (amount: number) => `Rs. ${Math.round(amount).toLocaleString('en-US')}`;

export const CartSummary = ({ itemCount, subtotal, onCheckout }: CartSummaryProps) => (
  <aside aria-labelledby="order-summary-title" className="rounded-[var(--radius-surface)] border border-hairline bg-paper-raised p-5 shadow-sm lg:sticky lg:top-24 sm:p-6">
    <h2 id="order-summary-title" className="text-xl font-semibold text-ink">Order summary</h2>
    <p className="mt-1 text-sm text-ink-muted">{itemCount} {itemCount === 1 ? 'item' : 'items'} in this order</p>

    <dl className="mt-6 space-y-3 text-sm">
      <div className="flex justify-between gap-4">
        <dt className="text-ink-muted">Subtotal</dt>
        <dd className="tabular-nums font-medium text-ink">{formatMoney(subtotal)}</dd>
      </div>
      <div className="flex justify-between gap-4">
        <dt className="text-ink-muted">Delivery</dt>
        <dd className="font-medium text-moss">Free</dd>
      </div>
      <div className="flex justify-between gap-4 border-t border-hairline pt-4">
        <dt className="font-semibold text-ink">Total</dt>
        <dd className="tabular-nums text-xl font-semibold tracking-tight text-ink">{formatMoney(subtotal)}</dd>
      </div>
    </dl>

    <Button onClick={onCheckout} className="mt-6 w-full">Proceed to checkout</Button>
    <p className="mt-4 flex items-center justify-center gap-2 text-xs text-ink-muted">
      <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" />
      Secure payment through eSewa
    </p>
  </aside>
);
