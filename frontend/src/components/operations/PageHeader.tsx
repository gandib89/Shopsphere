import type { ReactNode } from 'react';

type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
};

export const PageHeader = ({ eyebrow, title, description, action }: PageHeaderProps) => (
  <header className="border-b border-hairline bg-paper-raised">
    <div className="container-operate flex flex-col gap-5 py-7 sm:flex-row sm:items-end sm:justify-between sm:py-9">
      <div className="max-w-2xl">
        {eyebrow && (
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-brass">{eyebrow}</p>
        )}
        <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{title}</h1>
        {description && <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-muted sm:text-base">{description}</p>}
      </div>
      {action && <div className="shrink-0 self-start sm:self-auto">{action}</div>}
    </div>
  </header>
);
