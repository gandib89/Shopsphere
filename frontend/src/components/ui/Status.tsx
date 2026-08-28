import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const tones: Record<StatusTone, string> = {
  neutral: 'border-hairline bg-paper text-ink-muted',
  info: 'border-brass/30 bg-brass-light/55 text-brass-dark',
  success: 'border-moss/30 bg-moss/10 text-moss',
  warning: 'border-accent/35 bg-accent/10 text-accent-dark',
  danger: 'border-seal/30 bg-seal/10 text-seal',
};

export const Status = ({ tone, children, className }: { tone: StatusTone; children: ReactNode; className?: string }) => (
  <span data-tone={tone} className={cn('inline-flex min-h-7 items-center rounded-full border px-2.5 py-1 text-xs font-semibold leading-none', tones[tone], className)}>
    {children}
  </span>
);
