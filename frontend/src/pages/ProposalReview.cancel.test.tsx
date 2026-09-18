import { beforeEach, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

import { renderRoute } from '../test/render';
import { authFetch } from '../lib/session';
import ProposalReview from './ProposalReview';

vi.mock('../lib/session', () => ({ authFetch: vi.fn() }));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// The exact server-computed snapshot the cancellation proposal service stores.
const preview = {
  actionKind: 'order.cancel',
  currency: 'NPR',
  orderId: 'order-1',
  orderNumber: 'ORD-2026-0001',
  currentStatus: 'Confirmed',
  cancelEligible: true,
  stockToRestore: 2,
  paidAmount: { amount: '1890.50', currency: 'NPR' },
  disclosedConsequences: [
    'Cancels the order',
    'Restores 2 item(s) to stock',
    'Any refund is a separate manual admin action and is NOT initiated here',
  ],
};

const proposal = {
  id: 'prop-cancel-1',
  actionKind: 'order.cancel',
  status: 'pending',
  expectedVersion: 1789123456,
  expiresAt: '2026-09-18T10:10:00.000Z',
  createdAt: '2026-09-18T10:00:00.000Z',
  preview,
  disclosures: preview.disclosedConsequences,
};

const render = () =>
  renderRoute(
    <Routes>
      <Route path="/proposals/:proposalId" element={<ProposalReview />} />
    </Routes>,
    '/proposals/prop-cancel-1',
  );

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(authFetch).mockImplementation(async () => json({ proposal }));
});

it('renders the exact server-computed order state and the disclosed consequences', async () => {
  render();
  expect(await screen.findByText('Order ORD-2026-0001')).toBeVisible();
  expect(screen.getByText('Confirmed')).toBeVisible();
  expect(screen.getByText('2')).toBeVisible();
  expect(screen.getByText('1890.50 NPR')).toBeVisible();
  expect(screen.getByText('Cancels the order')).toBeVisible();
  expect(screen.getByText('Restores 2 item(s) to stock')).toBeVisible();
  expect(
    screen.getByText('Any refund is a separate manual admin action and is NOT initiated here'),
  ).toBeVisible();
  expect(screen.getByRole('button', { name: /Confirm — cancel this order/ })).toBeEnabled();
  // No cart before/after table for an order cancellation.
  expect(screen.queryByText('Cart subtotal')).not.toBeInTheDocument();
});

it('shows a pending order with no succeeded payment honestly and still no refund affordance', async () => {
  const pendingPreview = {
    ...preview,
    currentStatus: 'Pending',
    stockToRestore: 0,
    paidAmount: null,
    disclosedConsequences: [
      'Cancels the order',
      'Restores 0 item(s) to stock',
      'Any refund is a separate manual admin action and is NOT initiated here',
    ],
  };
  vi.mocked(authFetch).mockImplementation(async () =>
    json({
      proposal: {
        ...proposal,
        preview: pendingPreview,
        disclosures: pendingPreview.disclosedConsequences,
      },
    }),
  );
  render();
  expect(await screen.findByText('Restores 0 item(s) to stock')).toBeVisible();
  const text = document.body.textContent ?? '';
  // Disclosure stays; no release/start refund button, link, or delegated-token
  // affordance exists anywhere on the screen.
  expect(text).toContain('Any refund is a separate manual admin action and is NOT initiated here');
  expect(screen.queryByRole('button', { name: /refund/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /refund/i })).not.toBeInTheDocument();
  expect(text).not.toMatch(/release refund/i);
  expect(text).not.toMatch(/start refund/i);
  expect(text).not.toMatch(/delegated/i);
  expect(text).not.toMatch(/Bearer /);
});

it('confirms through the browser execute endpoint exactly once and renders the cancellation outcome', async () => {
  const user = userEvent.setup();
  render();
  await user.click(await screen.findByRole('button', { name: /Confirm — cancel this order/ }));
  const posts = vi.mocked(authFetch).mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(posts).toHaveLength(1);
  expect(String(posts[0]![0])).toMatch(/\/api\/v1\/proposals\/prop-cancel-1\/execute$/);
  expect(await screen.findByText(/Your order has been cancelled/i)).toBeVisible();
  expect(
    screen.getByText(/any refund is a separate manual admin action that is never initiated here/i),
  ).toBeVisible();
  // The confirm affordance is gone once applied.
  expect(screen.queryByRole('button', { name: /Confirm — cancel this order/ })).not.toBeInTheDocument();
});

it('renders the distinct stale outcome when the order moved on after the preview', async () => {
  vi.mocked(authFetch).mockImplementation(async (input, init) => {
    if (init?.method === 'POST') return json({ code: 'proposal_not_executable', reason: 'stale' }, 409);
    return json({ proposal });
  });
  const user = userEvent.setup();
  render();
  await user.click(await screen.findByRole('button', { name: /Confirm — cancel this order/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Your order changed after this proposal was created, so it can no longer be cancelled. Nothing was changed.',
  );
});

it('renders the distinct expired outcome', async () => {
  vi.mocked(authFetch).mockImplementation(async (input, init) => {
    if (init?.method === 'POST') return json({ code: 'proposal_not_executable', reason: 'expired' }, 409);
    return json({ proposal });
  });
  const user = userEvent.setup();
  render();
  await user.click(await screen.findByRole('button', { name: /Confirm — cancel this order/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'This proposal expired before it was confirmed. Nothing was changed.',
  );
});

it('renders the distinct rejected outcome for an order that is no longer cancellable', async () => {
  vi.mocked(authFetch).mockImplementation(async (input, init) => {
    if (init?.method === 'POST') return json({ code: 'proposal_not_executable', reason: 'rejected' }, 409);
    return json({ proposal });
  });
  const user = userEvent.setup();
  render();
  await user.click(await screen.findByRole('button', { name: /Confirm — cancel this order/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'This order can no longer be cancelled. Nothing was changed.',
  );
});
