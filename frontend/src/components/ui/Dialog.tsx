import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from './Button';

type DialogProps = {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
};

const focusableSelector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({ open, title, description, onClose, children, footer }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = `dialog-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusables = () => Array.from(panel?.querySelectorAll<HTMLElement>(focusableSelector) || []);
    requestAnimationFrame(() => (panel?.querySelector<HTMLElement>('[data-autofocus]') || focusables()[0] || panel)?.focus());

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) { event.preventDefault(); panel?.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/55 p-4 animate-overlay-in" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? `${titleId}-description` : undefined} tabIndex={-1} className="max-h-[min(85dvh,720px)] w-full max-w-lg overflow-y-auto rounded-[var(--radius-surface)] border border-hairline bg-paper-raised shadow-float animate-panel-in">
      <div className="flex items-start justify-between gap-4 border-b border-hairline px-5 py-4">
        <div><h2 id={titleId} className="text-xl font-semibold text-ink">{title}</h2>{description && <p id={`${titleId}-description`} className="mt-1 text-sm leading-relaxed text-ink-muted">{description}</p>}</div>
        <IconButton type="button" label={`Close ${title}`} onClick={onClose}><X className="h-5 w-5" /></IconButton>
      </div>
      <div className="px-5 py-5">{children}</div>
      {footer && <div className="flex flex-col-reverse gap-2 border-t border-hairline px-5 py-4 sm:flex-row sm:justify-end">{footer}</div>}
    </div>
  </div>;
}
