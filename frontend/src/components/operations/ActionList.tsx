import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

export type ActionItem = {
  key: string;
  icon: ReactNode;
  title: string;
  description: string;
  count?: number;
  onSelect: () => void;
};

type ActionListProps = {
  label: string;
  items: ActionItem[];
};

export const ActionList = ({ label, items }: ActionListProps) => (
  <ul aria-label={label} className="overflow-hidden rounded-[var(--radius-surface)] border border-hairline bg-paper-raised shadow-sm">
    {items.map((item, index) => (
      <li key={item.key} className={index > 0 ? 'border-t border-hairline' : undefined}>
        <button
          type="button"
          onClick={item.onSelect}
          className="group flex min-h-[4.75rem] w-full items-center gap-4 px-4 py-3 text-left transition-colors duration-150 hover:bg-paper sm:px-5"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-control)] bg-brass/10 text-brass [&>svg]:h-5 [&>svg]:w-5">
            {item.icon}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-ink">{item.title}</span>
            <span className="mt-0.5 block text-sm leading-snug text-ink-muted">{item.description}</span>
          </span>
          {item.count !== undefined && (
            <span aria-label={`${item.count} items`} className="shrink-0 tabular-nums text-lg font-semibold text-ink">
              {item.count}
            </span>
          )}
          <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-muted transition-transform group-hover:translate-x-0.5" />
        </button>
      </li>
    ))}
  </ul>
);
