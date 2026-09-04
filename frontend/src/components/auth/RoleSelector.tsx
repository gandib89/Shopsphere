import { ShieldCheck, Store, UserRound, type LucideIcon } from 'lucide-react';

export type AccountRole = 'user' | 'seller' | 'admin';

const roles: { value: AccountRole; title: string; detail: string; icon: LucideIcon }[] = [
  { value: 'user', title: 'Customer', detail: 'Browse products and manage your orders', icon: UserRound },
  { value: 'seller', title: 'Seller', detail: 'Manage products, inventory, and fulfilment', icon: Store },
  { value: 'admin', title: 'Administrator', detail: 'Oversee sellers and the marketplace', icon: ShieldCheck },
];

export const RoleSelector = ({ value, onChange }: { value: AccountRole; onChange: (role: AccountRole) => void }) => (
  <fieldset className="auth-roles">
    <legend className="sr-only">Choose account type</legend>
    <div className="auth-role-list">
      {roles.map(({ value: role, title, detail, icon: Icon }) => {
        const checked = value === role;
        return (
          <label key={role} className={`auth-role${checked ? ' is-selected' : ''}`}>
            <input type="radio" name="account-role" value={role} checked={checked} onChange={() => onChange(role)} className="sr-only" />
            <span className="auth-role-icon">
              <Icon aria-hidden="true" className="h-5 w-5" />
            </span>
            <span className="auth-role-copy">
              <span className="auth-role-title">{title}</span>
              <span className="auth-role-detail">{detail}</span>
            </span>
            <span aria-hidden="true" className="auth-role-radio" />
          </label>
        );
      })}
    </div>
  </fieldset>
);
