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
type PolicySource = { sourceId: string; sourceVersion: string };
type ProposalPreview = {
  actionKind: string;
  // Cart-change proposals (#22)
  currency?: string;
  productName?: string;
  availability?: string;
  before?: PreviewSide;
  after?: PreviewSide;
  // Return-request proposals (#25): exact server-computed owned-order facts
  orderId?: string;
  orderNumber?: string | null;
  currentStatus?: string;
  returnEligible?: boolean;
  orderTotal?: Money;
  policyBasis?: PolicySource[];
  disclosedConsequences?: string[];
  // Order-cancellation proposals (#24): exact server-computed owned-order state
  cancelEligible?: boolean;
  stockToRestore?: number;
  paidAmount?: Money | null;
  // Listing proposals (#26): publish previews the exact draft content a live
  // product would be created from; content changes preview exact before/after
  // of the changed allowlisted fields only. No money fields exist anywhere.
  draftId?: string;
  title?: string;
  description?: string;
  highlights?: string[];
  sourceProductId?: string | null;
  // Seller price proposals (#27): exact server-computed old/new value snapshot
  productId?: string;
  change?: 'set_price' | 'set_discount';
  oldValue?: string;
  newValue?: string;
  effectiveDisplayPriceBefore?: Money;
  effectiveDisplayPriceAfter?: Money;
  // Seller inventory proposals (#28): exact server-computed target and stock
  // snapshot. One stock-tracking option per proposal, or the product-level
  // quantity when no option tracks stock. No money fields exist anywhere.
  optionId?: string;
  optionKind?: string;
  optionValue?: string;
  currentCount?: number;
  requestedCount?: number;
  // Inventory proposals (#28) also carry the required user-authored reason in
  // the stored preview; the review endpoint surfaces it as proposal.reason.
  reason?: string;
  // Seller fulfillment proposals (#29): exact server-computed sale-line state.
  saleLineId?: string;
  nextStatus?: 'Processing' | 'Shipped' | 'Delivered';
  stageTimestamps?: {
    confirmedAt: string | null;
    processingAt: string | null;
    shippedAt: string | null;
    deliveredAt: string | null;
  };
  willSetTimestamp?: 'confirmedAt' | 'processingAt' | 'shippedAt' | 'deliveredAt';
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
  reason: string | null;
  disclosures: string[];
};
type ExecuteOutcome = { executionReference?: string; cartVersion?: number; nextSteps?: string[] };

const API = import.meta.env.VITE_BACKEND_URL || '';

// Per-actionKind descriptors (#25): every reviewed kind states its own title,
// screen description, applied-outcome wording, confirm toast, blocked-outcome
// messages, and where "Not now" leads. Cart kinds keep the exact wording the
// screen always had.
type ActionDescriptor = {
  title: string;
  description: string;
  executedMessage: string;
  confirmToast: string;
  backTarget: string;
  confirmLabel?: string;
  confirmCopy?: string;
  blocked?: Record<string, string>;
};

const actionDescriptors: Record<string, ActionDescriptor> = {
  'cart.add_item': {
    title: 'Add to cart',
    description: 'An AI assistant prepared this cart change. Nothing has changed yet — review the exact values below, then confirm.',
    executedMessage: 'Confirmed. Your cart now reflects exactly the reviewed change. These changes were reviewed on this screen before they were applied.',
    confirmToast: 'Confirmed. Your cart now matches this reviewed change.',
    backTarget: '/cart',
  },
  'cart.update_quantity': {
    title: 'Change cart quantity',
    description: 'An AI assistant prepared this cart change. Nothing has changed yet — review the exact values below, then confirm.',
    executedMessage: 'Confirmed. Your cart now reflects exactly the reviewed change. These changes were reviewed on this screen before they were applied.',
    confirmToast: 'Confirmed. Your cart now matches this reviewed change.',
    backTarget: '/cart',
  },
  'cart.remove_item': {
    title: 'Remove from cart',
    description: 'An AI assistant prepared this cart change. Nothing has changed yet — review the exact values below, then confirm.',
    executedMessage: 'Confirmed. Your cart now reflects exactly the reviewed change. These changes were reviewed on this screen before they were applied.',
    confirmToast: 'Confirmed. Your cart now matches this reviewed change.',
    backTarget: '/cart',
  },
  'order.cancel': {
    title: 'Cancel your order',
    description: 'An AI assistant prepared this cancellation. Nothing has changed yet — review the exact order state below, then confirm.',
    executedMessage: 'Your order has been cancelled. Any refund is a separate manual admin action that is never initiated here.',
    confirmToast: 'Confirmed. Your order was cancelled.',
    backTarget: '/my-orders',
    confirmLabel: 'Confirm — cancel this order',
    confirmCopy: 'I have reviewed the exact order state and the effects listed above. Confirming cancels this order with my own ShopSphere session.',
    blocked: {
      stale: 'Your order changed after this proposal was created, so it can no longer be cancelled. Nothing was changed.',
      rejected: 'This order can no longer be cancelled. Nothing was changed.',
    },
  },
  'listing.publish_draft': {
    title: 'Publish your draft as a live listing',
    description: 'An AI assistant prepared this listing publication. Nothing has changed yet — review the exact content below, then confirm.',
    executedMessage: 'Confirmed. Your listing now reflects exactly the reviewed content. These changes were reviewed on this screen before they were applied.',
    confirmToast: 'Confirmed. Your listing now matches this reviewed change.',
    backTarget: '/seller-products',
    confirmCopy: 'I have reviewed the exact content and the effects listed above. Confirming publishes this listing with my own ShopSphere session.',
    blocked: {
      stale: 'The listing changed after this proposal was created, so it can no longer be applied. Nothing was changed.',
      rejected: 'This proposal can no longer be applied to your listing. Nothing was changed.',
    },
  },
  'listing.update_content': {
    title: 'Update your listing content',
    description: 'An AI assistant prepared this listing content change. Nothing has changed yet — review the exact before and after values below, then confirm.',
    executedMessage: 'Confirmed. Your listing now reflects exactly the reviewed content. These changes were reviewed on this screen before they were applied.',
    confirmToast: 'Confirmed. Your listing now matches this reviewed change.',
    backTarget: '/seller-products',
    confirmCopy: 'I have reviewed the exact before and after values and the effects listed above. Confirming applies exactly these values to my listing with my own ShopSphere session.',
    blocked: {
      stale: 'The listing changed after this proposal was created, so it can no longer be applied. Nothing was changed.',
      rejected: 'This proposal can no longer be applied to your listing. Nothing was changed.',
    },
  },
  'order.return_request': {
    title: 'Request order return',
    description: 'An AI assistant prepared this return request. Nothing has changed yet — review the exact details below, then confirm.',
    executedMessage: 'Confirmed. Your return request was submitted for seller/admin review in ShopSphere.',
    confirmToast: 'Confirmed. Your return request was submitted.',
    backTarget: '/my-orders',
    blocked: {
      stale: 'Your order changed after this proposal was created, so it can no longer be applied. Nothing was changed.',
      rejected: 'This order can no longer be returned. Nothing was changed.',
    },
  },
  // Seller price proposals (#27): confirming requires a password
  // re-confirmation (step-up) on top of the browser session.
  'product.set_price': {
    title: 'Change listing price',
    description: 'An AI assistant prepared this price change. Nothing has changed yet — review the exact values below, then confirm with your password.',
    executedMessage: 'Confirmed. Your listing now uses exactly the reviewed value. No orders, payments, or promotions were affected.',
    confirmToast: 'Confirmed. Your listing price was updated.',
    backTarget: '/seller-products',
    confirmLabel: 'Confirm — apply this price',
    confirmCopy: 'I have reviewed the exact old and new values and the effects listed above. Confirming applies exactly this value to my live listing.',
    blocked: {
      stale: 'Your product changed after this proposal was created, so it can no longer be applied. Nothing was changed.',
      rejected: 'This price change can no longer be applied to your product. Nothing was changed.',
    },
  },
  'product.set_discount': {
    title: 'Change listing discount',
    description: 'An AI assistant prepared this discount change. Nothing has changed yet — review the exact values below, then confirm with your password.',
    executedMessage: 'Confirmed. Your listing now uses exactly the reviewed value. No orders, payments, or promotions were affected.',
    confirmToast: 'Confirmed. Your listing discount was updated.',
    backTarget: '/seller-products',
    confirmLabel: 'Confirm — apply this discount',
    confirmCopy: 'I have reviewed the exact old and new values and the effects listed above. Confirming applies exactly this value to my live listing.',
    blocked: {
      stale: 'Your product changed after this proposal was created, so it can no longer be applied. Nothing was changed.',
      rejected: 'This discount change can no longer be applied to your product. Nothing was changed.',
    },
  },
  // Seller inventory proposals (#28): confirming applies the exact stored
  // stock change with no password step-up — inventory is not a sensitive
  // change. A concurrent sale after the preview makes the proposal stale and
  // is never overwritten.
  'inventory.adjust': {
    title: 'Adjust your inventory',
    description: 'An AI assistant prepared this inventory adjustment. Nothing has changed yet — review the exact stock values below, then confirm.',
    executedMessage: 'Confirmed. Your stock now reflects exactly the reviewed count. No orders or notifications were affected.',
    confirmToast: 'Confirmed. Your inventory was adjusted.',
    backTarget: '/seller-products',
    confirmLabel: 'Confirm — apply this stock change',
    confirmCopy: 'I have reviewed the exact current and requested stock counts and the effects listed above. Confirming applies exactly this change to my inventory with my own ShopSphere session.',
    blocked: {
      stale: 'Your stock changed after this proposal was created (for example by a sale), so it can no longer be applied. Nothing was changed.',
      rejected: 'This stock change can no longer be applied to your product. Nothing was changed.',
    },
  },
  'sale.advance_fulfillment': {
    title: 'Advance fulfillment',
    description: 'An AI assistant prepared this fulfillment step. Nothing has changed yet — review the exact sale line below, then confirm.',
    executedMessage: 'Confirmed. Your sale line now reflects exactly the reviewed fulfillment step. No payment, refund, or stock change happened.',
    confirmToast: 'Confirmed. The fulfillment step was applied to your sale line.',
    backTarget: '/seller-orders',
    confirmLabel: 'Confirm — apply this fulfillment step',
    confirmCopy: 'I have reviewed the exact sale line status and the effects listed above. Confirming applies exactly this fulfillment step to my sale line with my own ShopSphere session.',
    blocked: {
      stale: 'Your product sale changed after this proposal was created, so it can no longer be applied. Nothing was changed.',
      rejected: 'This fulfillment step can no longer be applied to your product sale. Nothing was changed.',
    },
  },
};

const actionLabels: Record<string, string> = {
  'cart.add_item': 'Add to cart',
  'cart.update_quantity': 'Change cart quantity',
  'cart.remove_item': 'Remove from cart',
  'order.cancel': 'Cancel your order',
  'order.return_request': 'Request order return',
  'listing.publish_draft': 'Publish draft as live listing',
  'listing.update_content': 'Update listing content',
  'product.set_price': 'Change listing price',
  'product.set_discount': 'Change listing discount',
  'inventory.adjust': 'Adjust inventory',
  'sale.advance_fulfillment': 'Advance fulfillment',
};

const statusLabels: Record<ProposalStatus, string> = {
  pending: 'Waiting for your confirmation',
  executed: 'Applied',
  expired: 'Expired',
  stale: 'Outdated',
  rejected: 'Not applicable',
};

// Distinct, deterministic outcomes for every non-executable state. The backend
// answers 409 proposal_not_executable with a machine reason; the message here
// always states clearly that nothing was changed. Per-kind overrides win, then
// the shared defaults.
const blockedMessages: Record<string, string> = {
  expired: 'This proposal expired before it was confirmed. Nothing was changed.',
  stale: 'Your cart changed after this proposal was created, so it can no longer be applied. Nothing was changed.',
  rejected: 'This proposal can no longer be applied to your cart. Nothing was changed.',
};

const blockedMessageFor = (actionKind: string, reason: string) =>
  actionDescriptors[actionKind]?.blocked?.[reason] ?? blockedMessages[reason] ?? blockedMessages.rejected;

const formatMoney = (money: Money | null) => (money ? `${money.amount} ${money.currency}` : '—');

const formatStageTimestamp = (iso: string | null | undefined) => {
  if (!iso) return 'Not set';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
};

const formatExpiry = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
};

export default function ProposalReview() {
  const { proposalId } = useParams<{ proposalId: string }>();
  const navigate = useNavigate();
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [outcome, setOutcome] = useState<ExecuteOutcome | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [blockReason, setBlockReason] = useState<string | null>(null);
  const [stepUpError, setStepUpError] = useState<string | null>(null);
  // Seller price proposals (#27) collect a password re-confirmation here. The
  // field is a masked password input (never displayed or logged) and is sent
  // only to ShopSphere's own execute endpoint, never to any AI client.
  const [confirmPassword, setConfirmPassword] = useState('');

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

  const isPriceChange =
    proposal?.actionKind === 'product.set_price' || proposal?.actionKind === 'product.set_discount';

  const confirm = async () => {
    if (!proposalId || busy) return;
    if (isPriceChange && confirmPassword.length === 0) {
      setStepUpError('Enter your ShopSphere password to confirm this change. Nothing was changed.');
      return;
    }
    setBusy(true);
    setBlockReason(null);
    setStepUpError(null);
    try {
      // Seller price proposals carry the password re-confirmation in the JSON
      // body; every other kind POSTs an empty body, exactly as before.
      const response = await authFetch(`${API}/api/v1/proposals/${encodeURIComponent(proposalId)}/execute`, {
        method: 'POST',
        headers: isPriceChange ? { 'content-type': 'application/json' } : undefined,
        body: isPriceChange ? JSON.stringify({ confirmPassword }) : undefined,
      });
      if (response.ok) {
        const body: ExecuteOutcome = await response.json().catch(() => ({}));
        setOutcome(body);
        setProposal((current) => (current ? { ...current, status: 'executed' } : current));
        setConfirmPassword('');
        toast.success(actionDescriptors[proposal?.actionKind ?? '']?.confirmToast ?? 'Confirmed.');
      } else if (response.status === 404) {
        setNotFound(true);
        setProposal(null);
      } else if (response.status === 403) {
        // Stepped-up authentication failed (#27): wrong/missing password or a
        // revoked seller verification. Nothing was changed server-side.
        setStepUpError('Password confirmation failed. Nothing was changed.');
        setConfirmPassword('');
      } else if (response.status === 409) {
        const body = await response.json().catch(() => ({}));
        const reason = typeof body.reason === 'string' ? body.reason : 'rejected';
        setBlockReason(reason);
        setProposal((current) => (current ? { ...current, status: (reason as ProposalStatus) in statusLabels ? (reason as ProposalStatus) : current.status } : current));
        toast.error(blockedMessageFor(proposal?.actionKind ?? '', reason));
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

  const descriptor = actionDescriptors[proposal.actionKind]
    ?? {
      title: 'Review proposed cart change',
      description: 'An AI assistant prepared this cart change. Nothing has changed yet — review the exact values below, then confirm.',
      executedMessage: 'Confirmed. Your cart now reflects exactly the reviewed change. These changes were reviewed on this screen before they were applied.',
      confirmToast: 'Confirmed. Your cart now matches this reviewed change.',
      backTarget: '/cart',
    };
  const { preview } = proposal;
  const isPending = proposal.status === 'pending';
  const isReturn = proposal.actionKind === 'order.return_request';
  const isCancel = proposal.actionKind === 'order.cancel';
  const isListing = proposal.actionKind.startsWith('listing.');
  const isInventory = proposal.actionKind === 'inventory.adjust';
  const isFulfillment = proposal.actionKind === 'sale.advance_fulfillment';
  const backTarget = descriptor.backTarget;

  return (
    <main className="min-h-screen bg-paper text-ink">
      <PageHeader
        eyebrow="AI proposal"
        title={descriptor.title}
        description={descriptor.description}
      />
      <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
        {isListing && proposal.actionKind === 'listing.publish_draft' ? (
          <section aria-labelledby="proposal-target" className="border border-hairline bg-paper-raised p-6">
            <h2 id="proposal-target" className="text-xl font-bold">{preview.title}</h2>
            <p className="mt-1 text-sm text-ink-muted">Proposal status: {statusLabels[proposal.status]}</p>
            <pre className="mt-4 whitespace-pre-wrap border-t border-hairline pt-4 text-sm leading-6">{preview.description}</pre>
            {(preview.highlights?.length ?? 0) > 0 && (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6">
                {preview.highlights!.map((highlight) => (
                  <li key={highlight}>{highlight}</li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-ink-muted">
              Expires at {formatExpiry(proposal.expiresAt)} — after that this proposal cannot be applied.
            </p>
          </section>
        ) : isListing ? (
          <section aria-labelledby="proposal-target" className="border border-hairline bg-paper-raised p-6">
            <h2 id="proposal-target" className="text-xl font-bold">{preview.productName}</h2>
            <p className="mt-1 text-sm text-ink-muted">Proposal status: {statusLabels[proposal.status]}</p>
            <dl className="mt-5 overflow-hidden border border-hairline text-sm">
              <div className="grid grid-cols-3 gap-2 bg-paper px-4 py-2 font-semibold">
                <span>Field</span>
                <span>Before</span>
                <span>After</span>
              </div>
              {([
                ['Name', (preview.before as { name?: string } | undefined)?.name ?? '—', (preview.after as { name?: string } | undefined)?.name ?? '—'],
                ['Description', (preview.before as { description?: string } | undefined)?.description ?? '—', (preview.after as { description?: string } | undefined)?.description ?? '—'],
              ] as const).map(([label, before, after]) => (
                <div key={label} className="grid grid-cols-3 gap-2 border-t border-hairline px-4 py-2">
                  <span className="font-medium">{label}</span>
                  <span className="whitespace-pre-wrap">{before}</span>
                  <span className="whitespace-pre-wrap">{after}</span>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-ink-muted">
              Expires at {formatExpiry(proposal.expiresAt)} — after that this proposal cannot be applied.
            </p>
          </section>
        ) : isCancel ? (
          <section aria-labelledby="proposal-target" className="border border-hairline bg-paper-raised p-6">
            <h2 id="proposal-target" className="text-xl font-bold">
              Order {preview.orderNumber ?? preview.orderId ?? '—'}
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              Status: {preview.currentStatus} · Proposal status: {statusLabels[proposal.status]}
            </p>
            <dl className="mt-5 overflow-hidden border border-hairline text-sm">
              <div className="grid grid-cols-3 gap-2 bg-paper px-4 py-2 font-semibold">
                <span className="col-span-1">Field</span>
                <span className="col-span-2">Exact value to apply</span>
              </div>
              {([
                ['Order number', preview.orderNumber ?? preview.orderId ?? '—'],
                ['Current status', preview.currentStatus ?? '—'],
                ['Items to restore to stock', String(preview.stockToRestore ?? 0)],
                ['Paid amount', formatMoney(preview.paidAmount ?? null)],
              ] as const).map(([label, value]) => (
                <div key={label} className="grid grid-cols-3 gap-2 border-t border-hairline px-4 py-2 tabular-nums">
                  <span className="font-medium">{label}</span>
                  <span className="col-span-2">{value}</span>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-ink-muted">
              Expires at {formatExpiry(proposal.expiresAt)} — after that this proposal cannot be applied.
            </p>
          </section>
        ) : isReturn ? (
          <section aria-labelledby="proposal-target" className="border border-hairline bg-paper-raised p-6">
            <h2 id="proposal-target" className="text-xl font-bold">
              Return request for order {preview.orderNumber ?? preview.orderId ?? '—'}
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              Status: {preview.currentStatus} · Proposal status: {statusLabels[proposal.status]}
            </p>
            <dl className="mt-5 overflow-hidden border border-hairline text-sm">
              <div className="grid grid-cols-3 gap-2 bg-paper px-4 py-2 font-semibold">
                <span className="col-span-1">Field</span>
                <span className="col-span-2">Exact value to apply</span>
              </div>
              {([
                ['Order number', preview.orderNumber ?? preview.orderId ?? '—'],
                ['Current status', preview.currentStatus ?? '—'],
                ['Order total', formatMoney(preview.orderTotal ?? null)],
                ['Requested reason', proposal.reason ?? '—'],
                ['Return window eligible', preview.returnEligible ? 'Yes' : 'No'],
              ] as const).map(([label, value]) => (
                <div key={label} className="grid grid-cols-3 gap-2 border-t border-hairline px-4 py-2 tabular-nums">
                  <span className="font-medium">{label}</span>
                  <span className="col-span-2">{value}</span>
                </div>
              ))}
            </dl>
            {(preview.policyBasis?.length ?? 0) > 0 && (
              <p className="mt-3 text-xs text-ink-muted">
                Grounded in approved ShopSphere policy: {preview.policyBasis!.map((source) => `${source.sourceId} (v${source.sourceVersion})`).join(', ')}.
              </p>
            )}
            <p className="mt-3 text-xs text-ink-muted">
              Expires at {formatExpiry(proposal.expiresAt)} — after that this proposal cannot be applied.
            </p>
          </section>
        ) : isFulfillment ? (
          <section aria-labelledby="proposal-target" className="border border-hairline bg-paper-raised p-6">
            <h2 id="proposal-target" className="text-xl font-bold">
              {preview.productName ?? 'Sale line'} {preview.orderNumber ? `· ${preview.orderNumber}` : ''}
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              Status: {preview.currentStatus} · Proposal status: {statusLabels[proposal.status]}
            </p>
            <dl className="mt-5 overflow-hidden border border-hairline text-sm">
              <div className="grid grid-cols-3 gap-2 bg-paper px-4 py-2 font-semibold">
                <span className="col-span-1">Field</span>
                <span className="col-span-2">Exact value to apply</span>
              </div>
              {([
                ['Sale line', preview.saleLineId ?? preview.orderNumber ?? '—'],
                ['Product', preview.productName ?? '—'],
                ['Fulfillment transition', `${preview.currentStatus ?? '—'} → ${preview.nextStatus ?? '—'}`],
                ['Confirmed', formatStageTimestamp(preview.stageTimestamps?.confirmedAt)],
                ['Processing', formatStageTimestamp(preview.stageTimestamps?.processingAt)],
                ['Shipped', formatStageTimestamp(preview.stageTimestamps?.shippedAt)],
                ['Delivered', formatStageTimestamp(preview.stageTimestamps?.deliveredAt)],
                ['Stage timestamp to set', preview.willSetTimestamp ?? '—'],
              ] as const).map(([label, value]) => (
                <div key={label} className="grid grid-cols-3 gap-2 border-t border-hairline px-4 py-2 tabular-nums">
                  <span className="font-medium">{label}</span>
                  <span className="col-span-2">{value}</span>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-ink-muted">
              Expires at {formatExpiry(proposal.expiresAt)} — after that this proposal cannot be applied.
            </p>
          </section>
        ) : isPriceChange ? (
          <section aria-labelledby="proposal-target" className="border border-hairline bg-paper-raised p-6">
            <h2 id="proposal-target" className="text-xl font-bold">{preview.productName}</h2>
            <p className="mt-1 text-sm text-ink-muted">
              Proposal status: {statusLabels[proposal.status]}
            </p>
            <dl className="mt-5 overflow-hidden border border-hairline text-sm">
              <div className="grid grid-cols-3 gap-2 bg-paper px-4 py-2 font-semibold">
                <span className="col-span-1">Value</span>
                <span className="col-span-2">Exact old → new</span>
              </div>
              {([
                [
                  preview.change === 'set_price' ? 'Listing price (NPR)' : 'Discount percentage',
                  preview.oldValue ?? '—',
                  preview.newValue ?? '—',
                ],
                [
                  'Effective display price',
                  formatMoney(preview.effectiveDisplayPriceBefore ?? null),
                  formatMoney(preview.effectiveDisplayPriceAfter ?? null),
                ],
              ] as const).map(([label, before, after]) => (
                <div key={label} className="grid grid-cols-3 gap-2 border-t border-hairline px-4 py-2 tabular-nums">
                  <span className="font-medium">{label}</span>
                  <span className="col-span-2">{before} → {after}</span>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-ink-muted">
              All amounts in {preview.currency ?? 'NPR'}. Expires at {formatExpiry(proposal.expiresAt)} — after that this proposal cannot be applied.
            </p>
          </section>
        ) : isInventory ? (
          <section aria-labelledby="proposal-target" className="border border-hairline bg-paper-raised p-6">
            <h2 id="proposal-target" className="text-xl font-bold">{preview.productName}</h2>
            <p className="mt-1 text-sm text-ink-muted">Proposal status: {statusLabels[proposal.status]}</p>
            <dl className="mt-5 overflow-hidden border border-hairline text-sm">
              <div className="grid grid-cols-3 gap-2 bg-paper px-4 py-2 font-semibold">
                <span className="col-span-1">Field</span>
                <span className="col-span-2">Exact value to apply</span>
              </div>
              {([
                ['Target', preview.optionId ? `Option ${preview.optionKind ?? ''}: ${preview.optionValue ?? ''}` : 'Product-level stock'],
                ['Current stock', String(preview.currentCount ?? '—')],
                ['Requested stock', String(preview.requestedCount ?? '—')],
                ['Reason', proposal.reason ?? preview.reason ?? '—'],
              ] as const).map(([label, value]) => (
                <div key={label} className="grid grid-cols-3 gap-2 border-t border-hairline px-4 py-2 tabular-nums">
                  <span className="font-medium">{label}</span>
                  <span className="col-span-2">{value}</span>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-ink-muted">
              Expires at {formatExpiry(proposal.expiresAt)} — after that this proposal cannot be applied.
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
                ['Quantity', preview.before?.quantity ?? '—', preview.after?.quantity ?? '—'],
                ['Unit price', formatMoney(preview.before?.unitPrice ?? null), formatMoney(preview.after?.unitPrice ?? null)],
                ['Line total', formatMoney(preview.before?.lineTotal ?? null), formatMoney(preview.after?.lineTotal ?? null)],
                ['Cart subtotal', formatMoney(preview.before?.cartSubtotal ?? null), formatMoney(preview.after?.cartSubtotal ?? null)],
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
              {descriptor.executedMessage}
              {(outcome?.nextSteps?.length ?? 0) > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {outcome!.nextSteps!.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
              )}
            </span>
          </div>
        ) : isPending ? (
          <section aria-labelledby="proposal-confirm" className="border border-hairline bg-paper-raised p-6">
            <h2 id="proposal-confirm" className="text-lg font-bold">Confirm this change</h2>
            <p className="mt-2 text-sm leading-6 text-ink-muted">
              {descriptor.confirmCopy
                ? descriptor.confirmCopy
                : isReturn
                ? 'I have reviewed the exact details and the effects listed above. Confirming creates this return request with my own ShopSphere session.'
                : 'I have reviewed the exact before and after values and the effects listed above. Confirming applies exactly these values to my cart with my own ShopSphere session.'}
            </p>
            {blockReason && (
              <div role="alert" className="mt-3 flex items-start gap-3 border border-red-700 bg-red-50 p-4 text-sm text-red-800">
                <XCircle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
                <span>{blockedMessageFor(proposal.actionKind, blockReason)}</span>
              </div>
            )}
            {isPriceChange && (
              <div className="mt-5">
                <label htmlFor="proposal-password" className="mb-2 block text-sm font-semibold">
                  Current ShopSphere password
                </label>
                <input
                  id="proposal-password"
                  type="password"
                  autoComplete="current-password"
                  value={confirmPassword}
                  onChange={(event) => {
                    setConfirmPassword(event.target.value);
                    setStepUpError(null);
                  }}
                  disabled={busy}
                  required
                  className="min-h-11 w-full border border-hairline bg-paper px-3 focus:border-ink focus:outline-none"
                />
                <p className="mt-2 text-xs text-ink-muted">
                  Required to confirm this listing change. It is used only by ShopSphere to verify it is you and is never displayed or shared.
                </p>
                {stepUpError && (
                  <p role="alert" className="mt-2 text-sm text-red-700">{stepUpError}</p>
                )}
              </div>
            )}
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <Button onClick={() => void confirm()} disabled={busy || (isPriceChange && confirmPassword.length === 0)}>
                {busy ? 'Confirming…' : descriptor.confirmLabel ?? 'Confirm — apply exactly these changes'}
              </Button>
              <Button variant="quiet" onClick={() => navigate(backTarget)}>Not now</Button>
            </div>
          </section>
        ) : (
          <div role="alert" className="border border-hairline bg-paper-raised p-4 text-sm leading-6">
            {blockedMessageFor(proposal.actionKind, proposal.status)}
            <div className="mt-3"><Button variant="quiet" onClick={() => navigate(backTarget)}>Back to my orders</Button></div>
          </div>
        )}
      </div>
    </main>
  );
}
