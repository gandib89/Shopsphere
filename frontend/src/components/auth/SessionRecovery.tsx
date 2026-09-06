import { useEffect, useState, type ReactNode } from 'react';
import { refreshSession } from '../../lib/session';
import { ErrorState, LoadingState } from '../ui/AsyncState';
import { Button } from '../ui/Button';

// Account pages must not issue requests or read role hints until refresh has settled.
export function SessionRecovery({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>(() => localStorage.getItem('token') ? 'loading' : 'ready');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!localStorage.getItem('token')) { setState('ready'); return; }
    let active = true;
    setState('loading');
    refreshSession().then(() => {
      if (active) setState('ready');
    }).catch(() => {
      if (active) setState('unavailable');
    });
    const retry = () => setAttempt(value => value + 1);
    window.addEventListener('online', retry);
    return () => { active = false; window.removeEventListener('online', retry); };
  }, [attempt]);

  if (state === 'loading') return <LoadingState description="Restoring your session…" />;
  if (state === 'unavailable') return <ErrorState title="Unable to reconnect" description="We couldn’t restore your session. Check your connection and try again." action={<Button onClick={() => setAttempt(value => value + 1)}>Try again</Button>} />;
  return <>{children}</>;
}
