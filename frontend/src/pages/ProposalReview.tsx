import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, ListChecks, ShieldCheck, XCircle } from 'lucide-react';
import { toast } from 'sonner';

import { PageHeader } from '../components/operations/PageHeader';
import { Button } from '../components/ui/Button';
import { ErrorState, LoadingState } from '../components/ui/AsyncState';
import { authFetch } from '../lib/session';

type Money = { amount: string; currency: string };
type PreviewSide = {
  quantity: number | null;
  unitPrice: Money | null;
  lineTotal: Money | null;
  cartSubtotal: Money;
};
type ProposalPreview = {
  actionKind: string;
  currency: string;
  productName: string;
  availability: string;
  before: PreviewSide;
  after: PreviewSide;
};
type ProposalStatus = 'pending' | 'executed' | 'expired' | 'stale' | 'rejected';
type Proposal = {
  id: string;
  actionKind: string;
  status: ProposalStatus;
  expectedVersion: number;
  expiresAt: string;
  createdAt: string;
  preview: ProposalPreview;
  disclosures: string[];
};

const API = import.meta.env.VITE_BACKEND_URL || '';

const actionLabels: Record<string, string> = {
  'cart.add_item': 'Add to cart',
  'cart.update_quantity': 'Change cart quantity',
  'cart.remove_item': 'Remove from cart',
};

const statusLabels: Record<ProposalStatus, string> = {
  pending: 'Waiting for your confirmation',
  executed: 'Applied',
  expired: 'Expired',
  stale: 'Outdated',
  rejected: 'Not applicable',
};

const formatMoney = (money: Money | null) => (money ? `${money.amount} ${money.currency}` : '—');

const formatExpiry = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
};

// Distinct, deterministic outcomes for every non-executable state. The backend
// answers 409 proposal_not_executable with a machine reason; the message here
// always states clearly that nothing was changed.
const blockedMessages: Record<string, string> = {
  expired: 'This proposal expired before it was confirmed. Nothing was changed.',
  stale: 'Your cart changed after this proposal was created, so it can no longer be applied. Nothing was changed.',
  rejected: 'This proposal can no longer be applied to your cart. Nothing was changed.',
};

export default function ProposalReview() {
  const { proposalId } = useParams<{ proposalId: string }>();
  const navigate = useNavigate();
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [blockReason, setBlockReason] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!proposalId) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    setNotFound(false);
    setLoadError('');
    try {
      const response = await authFetch(`${API}/api/v1/proposals/${encodeURIComponent(proposalId)}`);
      if (response.status === 404) {
        setNotFound(true);
      } else if (!response.ok) {
        setLoadError('The proposal service is unavailable');
      } else {
        const body = await response.json();
        setProposal(body.proposal);
      }
    } catch {
      setLoadError('The proposal service is unavailable');
    } finally {
      setLoading(false);
    }
  }, [proposalId]);

  useEffect(() => { void load(); }, [load]);

  const confirm = async () => {
    if (!proposalId || busy) return;
    setBusy(true);
    setBlockReason(null);
    try {
      const response = await authFetch(`${API}/api/v1/proposals/${encodeURIComponent(proposalId)}/execute`, { method: 'POST' });
      if (response.ok) {
        setProposal((current) => (current ? { ...current, status: 'executed' } : current));
        toast.success('Confirmed. Your cart now matches this reviewed change.');
      } else if (response.status === 404) {
        setNotFound(true);
        setProposal(null);
      } else if (response.status === 409) {
        const body = await response.json().catch(() => ({}));
        const reason = typeof body.reason === 'string' ? body.reason : 'rejected';
        setBlockReason(reason);
        setProposal((current) => (current ? { ...current, status: (reason as ProposalStatus) in statusLabels ? (reason as ProposalStatus) : current.status } : current));
        toast.error(blockedMessages[reason] ?? blockedMessages.rejected);
      } else {
        toast.error('The proposal could not be confirmed. Nothing was changed.');
      }
    } catch {
      toast.error('The proposal could not be confirmed. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <main className="min-h-screen bg-paper"><LoadingState title="Loading proposal" /></main>;
  if (notFound) {
    return (
      <main className="min-h-screen bg-paper">
        <ErrorState
          title="Proposal not found"
          description="This proposal does not exist or does not belong to this account."
          action={<Button onClick={() => navigate('/cart')}>Back to cart</Button>}
        />
      </main>
    );
  }
  if (loadError || !proposal) {
    return (
      <main className="min-h-screen bg-paper">
        <ErrorState
          title="Something went wrong"
          description={loadError || 'The proposal service is unavailable'}
          action={<Button onClick={() => void load()}>Try again</Button>}
        />
      </main>
    );
  }

  const { preview } = proposal;
  const isPending = proposal.status === 'pending';

  return (
    <main className="min-h-screen bg-paper text-ink">
      <PageHeader
        eyebrow="AI proposal"
        title={actionLabels[proposal.actionKind] ?? 'Review proposed cart change'}
        description="An AI assistant prepared this cart change. Nothing has changed yet — review the exact values below, then confirm."
      />
      <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
        <section aria-labelledby="proposal-target" className="border border-hairline bg-paper-raised p-6">
          <h2 id="proposal-target" className="text-xl font-bold">{preview.productName}</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Availability: {preview.availability} · Proposal status: {statusLabels[proposal.status]}
          </p>
          <dl className="mt-5 overflow-hidden border border-hairline text-sm">
            <div className="grid grid-cols-3 gap-2 bg-paper px-4 py-2 font-semibold">
              <span>Value</span>
              <span>Before</span>
              <span>After</span>
            </div>
            {([
              ['Quantity', preview.before.quantity ?? '—', preview.after.quantity ?? '—'],
              ['Unit price', formatMoney(preview.before.unitPrice), formatMoney(preview.after.unitPrice)],
              ['Line total', formatMoney(preview.before.lineTotal), formatMoney(preview.after.lineTotal)],
              ['Cart subtotal', formatMoney(preview.before.cartSubtotal), formatMoney(preview.after.cartSubtotal)],
            ] as const).map(([label, before, after]) => (
              <div key={label} className="grid grid-cols-3 gap-2 border-t border-hairline px-4 py-2 tabular-nums">
                <span className="font-medium">{label}</span>
                <span>{before}</span>
                <span>{after}</span>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-ink-muted">
            All amounts in {preview.currency}. Expires at {formatExpiry(proposal.expiresAt)} — after that this proposal cannot be applied.
          </p>
        </section>

        <section aria-labelledby="proposal-effects" className="border border-hairline bg-paper-raised p-6">
          <div className="mb-3 flex items-center gap-2">
            <ListChecks aria-hidden="true" className="h-5 w-5 text-moss" />
            <h2 id="proposal-effects" className="text-lg font-bold">What confirming will do</h2>
          </div>
          <ul className="space-y-2 text-sm leading-6">
            {proposal.disclosures.map((disclosure) => (
              <li key={disclosure} className="flex items-start gap-2">
                <ShieldCheck aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-moss" />
                <span>{disclosure}</span>
              </li>
            ))}
          </ul>
        </section>

        {proposal.status === 'executed' ? (
          <div role="status" className="flex items-start gap-3 border border-moss/40 bg-moss/10 p-4 text-sm leading-6">
            <CheckCircle2 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-moss" />
            <span>
              Confirmed. Your cart now reflects exactly the reviewed change. These changes were reviewed on this screen before they were applied.
            </span>
          </div>
        ) : isPending ? (
          <section aria-labelledby="proposal-confirm" className="border border-hairline bg-paper-raised p-6">
            <h2 id="proposal-confirm" className="text-lg font-bold">Confirm this change</h2>
            <p className="mt-2 text-sm leading-6 text-ink-muted">
              I have reviewed the exact before and after values and the effects listed above. Confirming applies exactly these values to my cart with my own ShopSphere session.
            </p>
            {blockReason && (
              <div role="alert" className="mt-3 flex items-start gap-3 border border-red-700 bg-red-50 p-4 text-sm text-red-800">
                <XCircle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
                <span>{blockedMessages[blockReason] ?? blockedMessages.rejected}</span>
              </div>
            )}
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <Button onClick={() => void confirm()} disabled={busy}>
                {busy ? 'Confirming…' : 'Confirm — apply exactly these changes'}
              </Button>
              <Button variant="quiet" onClick={() => navigate('/cart')}>Not now</Button>
            </div>
          </section>
        ) : (
          <div role="alert" className="border border-hairline bg-paper-raised p-4 text-sm leading-6">
            {blockedMessages[proposal.status] ?? 'This proposal can no longer be applied. Nothing was changed.'}
            <div className="mt-3"><Button variant="quiet" onClick={() => navigate('/cart')}>Back to cart</Button></div>
          </div>
        )}
      </div>
    </main>
  );
}
