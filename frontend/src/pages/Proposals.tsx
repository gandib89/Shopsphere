import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { PageHeader } from '../components/operations/PageHeader';
import { Button } from '../components/ui/Button';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/AsyncState';
import { authFetch } from '../lib/session';

type ProposalSummary = {
  id: string;
  actionKind: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  productName: string | null;
};

const API = import.meta.env.VITE_BACKEND_URL || '';

const actionLabels: Record<string, string> = {
  'cart.add_item': 'Add to cart',
  'cart.update_quantity': 'Change cart quantity',
  'cart.remove_item': 'Remove from cart',
  'order.cancel': 'Order cancellation',
  'order.return_request': 'Request order return',
  'listing.publish_draft': 'Publish draft as live listing',
  'listing.update_content': 'Update listing content',
  'product.set_price': 'Price change',
  'product.set_discount': 'Discount change',
  'sale.advance_fulfillment': 'Advance fulfillment',
};

const statusLabels: Record<string, string> = {
  pending: 'Waiting for your confirmation',
  executed: 'Applied',
  expired: 'Expired',
  stale: 'Outdated',
  rejected: 'Not applicable',
};

// First-party list of the owner's recent AI proposals (newest first, bounded
// server-side to 20). Uses only the normal browser session.
export default function Proposals() {
  const navigate = useNavigate();
  const [proposals, setProposals] = useState<ProposalSummary[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const response = await authFetch(`${API}/api/v1/proposals`);
      if (!response.ok) throw new Error('unavailable');
      const body = await response.json();
      setProposals(body.proposals);
    } catch {
      setError('The proposal service is unavailable');
      setProposals([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (proposals === null && !error) {
    return <main className="min-h-screen bg-paper"><LoadingState title="Loading proposals" /></main>;
  }
  if (error && proposals !== null && proposals.length === 0) {
    return (
      <main className="min-h-screen bg-paper">
        <ErrorState
          title="Something went wrong"
          description={error}
          action={<Button onClick={() => void load()}>Try again</Button>}
        />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-paper text-ink">
      <PageHeader
        eyebrow="AI proposals"
        title="Your AI cart proposals"
        description="Changes an AI assistant proposed for your cart. Each one is applied only after you review and confirm it."
      />
      <div className="container mx-auto max-w-3xl px-4 py-8 sm:px-6">
        {!proposals || proposals.length === 0 ? (
          <EmptyState
            title="No proposals yet"
            description="When an AI assistant proposes a cart change, you can review it here."
            action={<Button onClick={() => navigate('/cart')}>Go to cart</Button>}
          />
        ) : (
          <ul className="overflow-hidden border border-hairline bg-paper-raised shadow-sm" aria-label="Recent proposals">
            {proposals.map((proposal, index) => (
              <li key={proposal.id} className={index > 0 ? 'border-t border-hairline' : undefined}>
                <button
                  type="button"
                  onClick={() => {
                    toast.message('Opening proposal');
                    navigate(`/proposals/${encodeURIComponent(proposal.id)}`);
                  }}
                  className="flex min-h-[4.75rem] w-full items-center gap-4 px-4 py-3 text-left transition-colors duration-150 hover:bg-paper sm:px-5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-ink">{proposal.productName ?? actionLabels[proposal.actionKind] ?? 'Cart change'}</span>
                    <span className="mt-0.5 block text-sm leading-snug text-ink-muted">
                      {actionLabels[proposal.actionKind] ?? proposal.actionKind} · {statusLabels[proposal.status] ?? proposal.status}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
