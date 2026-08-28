import { forwardRef, useId, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

type FieldChromeProps = {
  label: string;
  name: string;
  hint?: string;
  error?: string;
};

const controlClass = 'min-h-11 w-full rounded-[var(--radius-control)] border border-hairline bg-paper-raised px-3.5 py-2.5 text-sm text-ink transition-colors placeholder:text-ink-muted/65 hover:border-ink-muted focus:border-brass focus:outline-none disabled:cursor-not-allowed disabled:bg-paper disabled:text-ink-muted';

const FieldChrome = ({ id, label, hint, error, children }: FieldChromeProps & { id: string; children: React.ReactNode }) => {
  const messageId = `${id}-message`;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-ink">{label}</label>
      {children}
      {(error || hint) && (
        <p id={messageId} className={cn('text-xs leading-relaxed', error ? 'text-seal' : 'text-ink-muted')}>
          {error || hint}
        </p>
      )}
    </div>
  );
};

export type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & FieldChromeProps;

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, name, hint, error, id: providedId, className, ...props },
  ref,
) {
  const generatedId = useId();
  const id = providedId || `${name}-${generatedId}`;
  const messageId = error || hint ? `${id}-message` : undefined;
  return (
    <FieldChrome id={id} label={label} name={name} hint={hint} error={error}>
      <input ref={ref} id={id} name={name} aria-invalid={error ? true : undefined} aria-describedby={messageId} className={cn(controlClass, className)} {...props} />
    </FieldChrome>
  );
});

export type TextAreaFieldProps = TextareaHTMLAttributes<HTMLTextAreaElement> & FieldChromeProps;

export const TextAreaField = forwardRef<HTMLTextAreaElement, TextAreaFieldProps>(function TextAreaField(
  { label, name, hint, error, id: providedId, className, ...props },
  ref,
) {
  const generatedId = useId();
  const id = providedId || `${name}-${generatedId}`;
  const messageId = error || hint ? `${id}-message` : undefined;
  return (
    <FieldChrome id={id} label={label} name={name} hint={hint} error={error}>
      <textarea ref={ref} id={id} name={name} aria-invalid={error ? true : undefined} aria-describedby={messageId} className={cn(controlClass, 'min-h-28 resize-y', className)} {...props} />
    </FieldChrome>
  );
});

export type SelectFieldProps = SelectHTMLAttributes<HTMLSelectElement> & FieldChromeProps;

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, name, hint, error, id: providedId, className, children, ...props },
  ref,
) {
  const generatedId = useId();
  const id = providedId || `${name}-${generatedId}`;
  const messageId = error || hint ? `${id}-message` : undefined;
  return (
    <FieldChrome id={id} label={label} name={name} hint={hint} error={error}>
      <select ref={ref} id={id} name={name} aria-invalid={error ? true : undefined} aria-describedby={messageId} className={cn(controlClass, className)} {...props}>
        {children}
      </select>
    </FieldChrome>
  );
});
