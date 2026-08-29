import { ShieldCheck, Store, UserRound, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

export type AccountRole = 'user' | 'seller' | 'admin';

const roles: { value: AccountRole; title: string; detail: string; icon: LucideIcon }[] = [
  { value: 'user', title: 'Customer', detail: 'Browse products and manage your orders', icon: UserRound },
  { value: 'seller', title: 'Seller', detail: 'Manage products, inventory, and fulfilment', icon: Store },
  { value: 'admin', title: 'Admin (Demo only)', detail: 'Oversee sellers, users, and the marketplace', icon: ShieldCheck },
];

export const RoleSelector = ({ value, onChange }: { value: AccountRole; onChange: (role: AccountRole) => void }) => (
  <fieldset>
    <legend className="sr-only">Choose account type</legend>
    <div className="space-y-2">
      {roles.map(({ value: role, title, detail, icon: Icon }) => {
        const checked = value === role;
        return (
          <label key={role} className={cn('flex cursor-pointer items-center gap-3 rounded-[var(--radius-control)] border p-3.5 transition-colors', checked ? 'border-brass bg-brass-light/45' : 'border-hairline bg-paper-raised hover:border-ink-muted/50')}>
            <input type="radio" name="account-role" value={role} checked={checked} onChange={() => onChange(role)} className="sr-only" />
            <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full', checked ? 'bg-brass text-white' : 'bg-paper text-ink-muted')}>
              <Icon aria-hidden="true" className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-ink">{title}</span>
              <span className="block text-xs leading-relaxed text-ink-muted">{detail}</span>
            </span>
            <span aria-hidden="true" className={cn('h-4 w-4 rounded-full border-2', checked ? 'border-brass bg-brass shadow-[inset_0_0_0_3px_white]' : 'border-hairline')} />
          </label>
        );
      })}
    </div>
  </fieldset>
);
