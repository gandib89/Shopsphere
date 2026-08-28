import { cn } from '../../lib/utils';

const formatNpr = (amount: number) => `Rs. ${Math.round(amount).toLocaleString('en-US')}`;

export const Money = ({ amount, previousAmount, className }: { amount: number; previousAmount?: number; className?: string }) => (
  <div className={cn('flex flex-wrap items-baseline gap-x-2 gap-y-1 tabular-nums', className)}>
    <span className="text-lg font-semibold tracking-tight text-ink">{formatNpr(amount)}</span>
    {previousAmount && previousAmount > amount ? (
      <span className="text-sm text-ink-muted line-through">{formatNpr(previousAmount)}</span>
    ) : null}
  </div>
);
