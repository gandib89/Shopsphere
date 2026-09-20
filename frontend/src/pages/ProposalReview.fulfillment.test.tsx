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

// The exact server-computed snapshot the fulfillment proposal service stores:
// the sale line's exact stored status, the exact one-step-forward transition,
// the stage timestamps already present, and the fixed disclosures (the honest
// notification line: this execution sends no buyer notification/email).
const fulfillmentPreview = {
  actionKind: 'sale.advance_fulfillment',
  saleLineId: 'a1b2c3d4e5f6a7b8c9d0e1f2',
  orderNumber: 'ORD-2026-0100',
  productName: 'Headphones',
  currentStatus: 'Confirmed',
  nextStatus: 'Processing',
  stageTimestamps: {
    confirmedAt: '2026-09-18T09:00:00.000Z',
    processingAt: null,
    shippedAt: null,
    deliveredAt: null,
  },
  willSetTimestamp: 'processingAt',
  disclosedConsequences: [
    'Sets processingAt on the sale line',
    'No buyer notification or email is sent by this execution (the storefront fulfillment flow normally sends one)',
    'No payment, refund, or stock change happens',
  ],
};

const proposal = {
  id: 'prop-fulfill-1',
  actionKind: 'sale.advance_fulfillment',
  status: 'pending',
  expectedVersion: 1789123456,
  expiresAt: '2026-09-18T10:10:00.000Z',
  createdAt: '2026-09-18T10:00:00.000Z',
  preview: fulfillmentPreview,
  disclosures: fulfillmentPreview.disclosedConsequences,
};

const render = () =>
  renderRoute(
    <Routes>
      <Route path="/proposals/:proposalId" element={<ProposalReview />} />
    </Routes>,
    '/proposals/prop-fulfill-1',
  );

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(authFetch).mockImplementation(async () => json({ proposal }));
});

it('renders the exact sale-line transition, stage timestamps, and the disclosed consequences', async () => {
  render();
  expect(await screen.findByText('Advance fulfillment')).toBeVisible();
  expect(screen.getByText('Headphones · ORD-2026-0100')).toBeVisible();
  expect(screen.getByText('Confirmed → Processing')).toBeVisible();
  expect(screen.getByText('Sets processingAt on the sale line')).toBeVisible();
  expect(
    screen.getByText(
      'No buyer notification or email is sent by this execution (the storefront fulfillment flow normally sends one)',
    ),
  ).toBeVisible();
  expect(screen.getByText('No payment, refund, or stock change happens')).toBeVisible();
  // Stage timestamps already present: Confirmed is set, the rest are not yet.
  const notSet = screen.getAllByText('Not set');
  expect(notSet).toHaveLength(3); // processingAt, shippedAt, deliveredAt still unset
  expect(
    screen.getByRole('button', { name: /Confirm — apply this fulfillment step/ }),
  ).toBeVisible();
  // No cart before/after table and no money fields on a fulfillment step.
  expect(screen.queryByText('Cart subtotal')).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
});

it('posts an empty body exactly once and renders the applied outcome', async () => {
  const user = userEvent.setup();
  render();
  const confirmButton = await screen.findByRole('button', { name: /Confirm — apply this fulfillment step/ });
  await user.click(confirmButton);

  const posts = vi.mocked(authFetch).mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(posts).toHaveLength(1);
  expect(String(posts[0]![0])).toMatch(/\/api\/v1\/proposals\/prop-fulfill-1\/execute$/);
  expect(posts[0]![1]!.body).toBeUndefined();
  expect(await screen.findByText(/Your sale line now reflects exactly the reviewed fulfillment step/i)).toBeVisible();
  expect(screen.queryByRole('button', { name: /Confirm — apply this fulfillment step/ })).not.toBeInTheDocument();
});

it('renders the distinct stale outcome when the sale line moved on after the preview', async () => {
  vi.mocked(authFetch).mockImplementation(async (input, init) => {
    if (init?.method === 'POST') return json({ code: 'proposal_not_executable', reason: 'stale' }, 409);
    return json({ proposal });
  });
  const user = userEvent.setup();
  render();
  await user.click(await screen.findByRole('button', { name: /Confirm — apply this fulfillment step/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Your product sale changed after this proposal was created, so it can no longer be applied. Nothing was changed.',
  );
});

it('renders the rejected outcome with product-wording when the transition is no longer applicable', async () => {
  vi.mocked(authFetch).mockImplementation(async (input, init) => {
    if (init?.method === 'POST') return json({ code: 'proposal_not_executable', reason: 'rejected' }, 409);
    return json({ proposal });
  });
  const user = userEvent.setup();
  render();
  await user.click(await screen.findByRole('button', { name: /Confirm — apply this fulfillment step/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'This fulfillment step can no longer be applied to your product sale. Nothing was changed.',
  );
});

it('renders the blocked banner with the same wording when the proposal is already stale on load', async () => {
  vi.mocked(authFetch).mockImplementation(async () =>
    json({ proposal: { ...proposal, status: 'stale' } }),
  );
  render();
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Your product sale changed after this proposal was created, so it can no longer be applied. Nothing was changed.',
  );
  expect(screen.queryByRole('button', { name: /Confirm — apply this fulfillment step/ })).not.toBeInTheDocument();
});
