import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, ListChecks, ShieldCheck, XCircle } from 'lucide-react';
import { toast } from 'sonner';

import { PageHeader } from '../components/operations/PageHeader';
import { Button } from '../components/ui/Button';
import { ErrorState, LoadingState } from '../components/ui/AsyncState';
import { authFetch } from '../lib/session';

type Money = { amount: string; currency: string };
type CartPreviewSide = {
  quantity: number | null;
  unitPrice: Money | null;
  lineTotal: Money | null;
  cartSubtotal: Money;
};
type CartPreview = {
  actionKind: 'cart.add_item' | 'cart.update_quantity' | 'cart.remove_item';
  currency: string;
  productName: string;
  availability: string;
  before: CartPreviewSide;
  after: CartPreviewSide;
};
// Listing proposals (#26): a publish proposal previews the exact draft content
// a live product would be created from; a content-change proposal previews the
// exact before/after of the changed allowlisted fields only. No money fields
// exist anywhere in the listing shapes.
type ListingContentSide = { name?: string; description?: string; images?: string[] };
type ListingPublishPreview = {
  actionKind: 'listing.publish_draft';
  draftId: string;
  title: string;
  description: string;
  highlights: string[];
  sourceProductId: string | null;
};
type ListingContentPreview = {
  actionKind: 'listing.update_content';
  productId: string;
  productName: string;
  before: ListingContentSide;
  after: ListingContentSide;
};
type ProposalPreview = CartPreview | ListingPublishPreview | ListingContentPreview;
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
  'listing.publish_draft': 'Publish listing draft',
  'listing.update_content': 'Update listing content',
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
// always states clearly that nothing was changed. Listing proposals (#26) get
// their own stale/rejected wording (the cart text would misstate what moved);
// expiry is target-neutral and shared.
const cartBlockedMessages: Record<string, string> = {
  expired: 'This proposal expired before it was confirmed. Nothing was changed.',
  stale: 'Your cart changed after this proposal was created, so it can no longer be applied. Nothing was changed.',
  rejected: 'This proposal can no longer be applied to your cart. Nothing was changed.',
};
const listingBlockedMessages: Record<string, string> = {
  expired: 'This proposal expired before it was confirmed. Nothing was changed.',
  stale: 'The listing changed after this proposal was created, so it can no longer be applied. Nothing was changed.',
  rejected: 'This proposal can no longer be applied to your listing. Nothing was changed.',
};
const blockedMessageFor = (actionKind: string, reason: string) => {
  const messages = actionKind.startsWith('listing.') ? listingBlockedMessages : cartBlockedMessages;
  return messages[reason] ?? cartBlockedMessages.rejected;
};

const isCartKind = (actionKind: string) => actionKind.startsWith('cart.');
const backPathFor = (actionKind: string) => (isCartKind(actionKind) ? '/cart' : '/seller-products');

export default function ProposalReview() {
  const { proposalId } = useParams<{ proposalId: string }>();
  const navigate = useNavigate();
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [blockReason, setBlockReason] = useState<string | null>(null);

  const cartKind = proposal ? isCartKind(proposal.actionKind) : true;
  const backPath = proposal ? backPathFor(proposal.actionKind) : '/cart';

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
        toast.success(cartKind
          ? 'Confirmed. Your cart now matches this reviewed change.'
          : 'Confirmed. Your listing now matches this reviewed change.');
      } else if (response.status === 404) {
        setNotFound(true);
        setProposal(null);
      } else if (response.status === 409) {
        const body = await response.json().catch(() => ({}));
        const reason = typeof body.reason === 'string' ? body.reason : 'rejected';
        setBlockReason(reason);
        setProposal((current) => (current ? { ...current, status: (reason as ProposalStatus) in statusLabels ? (reason as ProposalStatus) : current.status } : current));
        toast.error(blockedMessageFor(proposal?.actionKind ?? 'cart.add_item', reason));
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
          action={<Button onClick={() => navigate(backPath)}>Back</Button>}
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
        title={actionLabels[proposal.actionKind] ?? (cartKind ? 'Review proposed cart change' : 'Review proposed listing change')}
        description={cartKind
          ? 'An AI assistant prepared this cart change. Nothing has changed yet — review the exact values below, then confirm.'
          : 'An AI assistant prepared this listing proposal. Nothing has changed yet — review the exact content below, then confirm.'}
      />
      <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
        {preview.actionKind === 'listing.publish_draft' ? (
          <section aria-labelledby="proposal-target" className="border border-hairline bg-paper-raised p-6">
            <h2 id="proposal-target" className="text-xl font-bold">{preview.title}</h2>
            <p className="mt-1 text-sm text-ink-muted">
              Publishing creates one new live product with exactly this content · Proposal status: {statusLabels[proposal.status]}
            </p>
            <dl className="mt-5 border border-hairline text-sm">
              <div className="border-b border-hairline bg-paper px-4 py-2 font-semibold">Exact description to be created</div>
              <div className="px-4 py-3">
                <p className="whitespace-pre-line leading-6">{preview.description}</p>
              </div>
              {preview.highlights.length > 0 && (
                <>
                  <div className="border-y border-hairline bg-paper px-4 py-2 font-semibold">Highlights included in the description</div>
                  <div className="px-4 py-3">
                    <ul className="list-disc space-y-1 pl-5 leading-6">
                      {preview.highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}
                    </ul>
                  </div>
                </>
              )}
              <div className="border-t border-hairline bg-paper px-4 py-2 font-semibold">Source draft</div>
              <div className="px-4 py-3 leading-6">
                <p>Draft {preview.draftId}{preview.sourceProductId ? ` · drafted from product ${preview.sourceProductId}` : ''}</p>
                <p className="mt-1 text-ink-muted">No price, stock, or images are set by this proposal — configure them in ShopSphere afterward.</p>
              </div>
            </dl>
            <p className="mt-3 text-xs text-ink-muted">
              Expires at {formatExpiry(proposal.expiresAt)} — after that this proposal cannot be applied.
            </p>
          </section>
        ) : preview.actionKind === 'listing.update_content' ? (
          <section aria-labelledby="proposal-target" className="border border-hairline bg-paper-raised p-6">
            <h2 id="proposal-target" className="text-xl font-bold">{preview.productName}</h2>
            <p className="mt-1 text-sm text-ink-muted">
              Applies to your live listing · Proposal status: {statusLabels[proposal.status]}
            </p>
            <dl className="mt-5 overflow-hidden border border-hairline text-sm">
              <div className="grid grid-cols-3 gap-2 bg-paper px-4 py-2 font-semibold">
                <span>Content</span>
                <span>Before</span>
                <span>After</span>
              </div>
              {([
                ['Name', preview.before.name, preview.after.name],
                ['Description', preview.before.description, preview.after.description],
                ['Images', preview.before.images, preview.after.images],
              ] as const)
                .filter(([, before, after]) => before !== undefined || after !== undefined)
                .map(([label, before, after]) => (
                  <div key={label} className="grid grid-cols-3 gap-2 border-t border-hairline px-4 py-2">
                    <span className="font-medium">{label}</span>
                    <span className="whitespace-pre-line break-words">
                      {Array.isArray(before) ? `${before.length} image(s): ${before.join(', ')}` : before ?? '—'}
                    </span>
                    <span className="whitespace-pre-line break-words">
                      {Array.isArray(after) ? `${after.length} image(s): ${after.join(', ')}` : after ?? '—'}
                    </span>
                  </div>
                ))}
            </dl>
            <p className="mt-3 text-xs text-ink-muted">
              Only the changed allowlisted content fields above are applied. Expires at {formatExpiry(proposal.expiresAt)} — after that this proposal cannot be applied.
            </p>
          </section>
        ) : (
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
        )}

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
              {cartKind
                ? 'Confirmed. Your cart now reflects exactly the reviewed change. These changes were reviewed on this screen before they were applied.'
                : 'Confirmed. Your listing now reflects exactly the reviewed content. These changes were reviewed on this screen before they were applied.'}
            </span>
          </div>
        ) : isPending ? (
          <section aria-labelledby="proposal-confirm" className="border border-hairline bg-paper-raised p-6">
            <h2 id="proposal-confirm" className="text-lg font-bold">Confirm this change</h2>
            <p className="mt-2 text-sm leading-6 text-ink-muted">
              {cartKind
                ? 'I have reviewed the exact before and after values and the effects listed above. Confirming applies exactly these values to my cart with my own ShopSphere session.'
                : 'I have reviewed the exact content and the effects listed above. Confirming applies exactly this stored content to my listing with my own ShopSphere session.'}
            </p>
            {blockReason && (
              <div role="alert" className="mt-3 flex items-start gap-3 border border-red-700 bg-red-50 p-4 text-sm text-red-800">
                <XCircle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
                <span>{blockedMessageFor(proposal.actionKind, blockReason)}</span>
              </div>
            )}
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <Button onClick={() => void confirm()} disabled={busy}>
                {busy ? 'Confirming…' : 'Confirm — apply exactly these changes'}
              </Button>
              <Button variant="quiet" onClick={() => navigate(backPath)}>Not now</Button>
            </div>
          </section>
        ) : (
          <div role="alert" className="border border-hairline bg-paper-raised p-4 text-sm leading-6">
            {blockedMessageFor(proposal.actionKind, proposal.status)}
            <div className="mt-3"><Button variant="quiet" onClick={() => navigate(backPath)}>Back</Button></div>
          </div>
        )}
      </div>
    </main>
  );
}
