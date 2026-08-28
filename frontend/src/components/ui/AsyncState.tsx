import type { ReactNode } from 'react';

type StateProps = {
  title: string;
  description?: string;
  action?: ReactNode;
};

const StateFrame = ({ title, description, action, role }: StateProps & { role?: 'alert' | 'status' }) => (
  <section role={role} className="mx-auto flex max-w-md flex-col items-center px-5 py-14 text-center">
    <h2 className="text-xl font-semibold tracking-tight text-ink">{title}</h2>
    {description && <p className="mt-2 text-sm leading-relaxed text-ink-muted">{description}</p>}
    {action && <div className="mt-6">{action}</div>}
  </section>
);

export const LoadingState = ({ title = 'Loading', description }: Partial<StateProps>) => (
  <div role="status" className="flex min-h-48 items-center justify-center gap-3 px-5 py-10 text-sm text-ink-muted">
    <span aria-hidden="true" className="h-5 w-5 animate-spin rounded-full border-2 border-brass border-r-transparent" />
    <span>{description || title}</span>
  </div>
);

export const EmptyState = (props: StateProps) => <StateFrame {...props} role="status" />;

export const ErrorState = (props: StateProps) => <StateFrame {...props} role="alert" />;
