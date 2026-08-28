import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
};

const variants: Record<ButtonVariant, string> = {
  primary: 'border border-brass bg-brass text-white hover:border-brass-dark hover:bg-brass-dark',
  secondary: 'border border-ink bg-transparent text-ink hover:bg-ink hover:text-white',
  quiet: 'border border-transparent bg-transparent text-ink hover:bg-paper hover:border-hairline',
  danger: 'border border-seal bg-seal text-white hover:bg-seal/90',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'min-h-9 px-3 text-sm',
  md: 'min-h-11 px-4 text-sm',
  lg: 'min-h-12 px-5 text-base',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', loading = false, disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />}
      <span>{children}</span>
    </button>
  );
});

type IconButtonProps = Omit<ButtonProps, 'aria-label'> & {
  label: string;
  children: ReactNode;
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, className, variant = 'quiet', children, ...props },
  ref,
) {
  return (
    <Button
      ref={ref}
      variant={variant}
      aria-label={label}
      className={cn('h-11 w-11 shrink-0 px-0', className)}
      {...props}
    >
      <span aria-hidden="true">{children}</span>
    </Button>
  );
});
