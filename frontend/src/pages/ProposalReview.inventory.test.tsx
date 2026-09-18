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

const REASON = 'Supplier delivered twelve extra units of this color on Monday';

// The exact server-computed snapshot the inventory proposal service stores.
const inventoryPreview = {
  actionKind: 'inventory.adjust',
  productId: 'prod-1',
  productName: 'Headphones',
  optionId: 'opt-color-1',
  optionKind: 'color',
  optionValue: 'Black',
  currentCount: 7,
  requestedCount: 4,
  reason: REASON,
  disclosedConsequences: [
    'Sets stock for "Headphones" (color: Black) from 7 to 4 on confirm',
    'Concurrent sales between review and confirm make this proposal stale',
    'No orders or notifications are affected',
  ],
};

const proposal = {
  id: 'prop-inv-1',
  actionKind: 'inventory.adjust',
  status: 'pending',
  expectedVersion: 1789123456,
  expiresAt: '2026-09-18T10:10:00.000Z',
  createdAt: '2026-09-18T10:00:00.000Z',
  preview: inventoryPreview,
  reason: REASON,
  disclosures: inventoryPreview.disclosedConsequences,
};

const render = () =>
  renderRoute(
    <Routes>
      <Route path="/proposals/:proposalId" element={<ProposalReview />} />
    </Routes>,
    '/proposals/prop-inv-1',
  );

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(authFetch).mockImplementation(async () => json({ proposal }));
});

it('renders the exact target, current → requested stock, reason, and disclosed consequences', async () => {
  render();
  expect(await screen.findByText('Headphones')).toBeVisible();
  expect(screen.getByText('Option color: Black')).toBeVisible();
  expect(screen.getByText('Current stock')).toBeVisible();
  expect(screen.getByText('7')).toBeVisible();
  expect(screen.getByText('Requested stock')).toBeVisible();
  expect(screen.getByText('4')).toBeVisible();
  expect(screen.getByText(REASON)).toBeVisible();
  expect(screen.getByText('Sets stock for "Headphones" (color: Black) from 7 to 4 on confirm')).toBeVisible();
  expect(screen.getByText('No orders or notifications are affected')).toBeVisible();
  expect(screen.getByRole('button', { name: /Confirm — apply this stock change/ })).toBeVisible();
  // No cart before/after table and no money fields on an inventory change.
  expect(screen.queryByText('Cart subtotal')).not.toBeInTheDocument();
  expect(screen.queryByText('Effective display price')).not.toBeInTheDocument();
});

it('needs no password step-up: confirm is enabled on the browser session alone', async () => {
  render();
  const confirmButton = await screen.findByRole('button', { name: /Confirm — apply this stock change/ });
  expect(confirmButton).toBeEnabled();
  // There is no password field anywhere on an inventory change — stock is not
  // a sensitive change, unlike the price/discount kinds (#27).
  expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Current ShopSphere password')).not.toBeInTheDocument();
});

it('posts an empty body exactly once and shows the applied outcome', async () => {
  const user = userEvent.setup();
  vi.mocked(authFetch).mockImplementation(async (input, init) => {
    if (init?.method === 'POST') return json({ status: 'executed', executionReference: 'proposal-exec-prop-inv-1', productId: 'prod-1', optionId: 'opt-color-1', appliedStock: 4 });
    return json({ proposal });
  });
  render();
  const confirmButton = await screen.findByRole('button', { name: /Confirm — apply this stock change/ });
  await user.click(confirmButton);

  const posts = vi.mocked(authFetch).mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(posts).toHaveLength(1);
  expect(String(posts[0]![0])).toMatch(/\/api\/v1\/proposals\/prop-inv-1\/execute$/);
  expect(posts[0]![1]!.body).toBeUndefined(); // nothing to step up with — empty body
  expect(await screen.findByText(/Your stock now reflects exactly the reviewed count/i)).toBeVisible();
  // The confirm affordance is gone once applied.
  expect(screen.queryByRole('button', { name: /Confirm — apply this stock change/ })).not.toBeInTheDocument();
});

it('shows that nothing was changed when the stock moved on after the preview (stale)', async () => {
  vi.mocked(authFetch).mockImplementation(async (input, init) => {
    if (init?.method === 'POST') return json({ code: 'proposal_not_executable', reason: 'stale' }, 409);
    return json({ proposal });
  });
  const user = userEvent.setup();
  render();
  await user.click(await screen.findByRole('button', { name: /Confirm — apply this stock change/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Your stock changed after this proposal was created (for example by a sale), so it can no longer be applied. Nothing was changed.',
  );
});

it('renders the product-level target when the proposal has no option', async () => {
  const productLevelPreview = {
    ...inventoryPreview,
    optionId: undefined,
    optionKind: undefined,
    optionValue: undefined,
    currentCount: 5,
    requestedCount: 42,
    disclosedConsequences: [
      'Sets stock for "Headphones" from 5 to 42 on confirm',
      'Concurrent sales between review and confirm make this proposal stale',
      'No orders or notifications are affected',
    ],
  };
  vi.mocked(authFetch).mockImplementation(async () =>
    json({
      proposal: { ...proposal, preview: productLevelPreview, disclosures: productLevelPreview.disclosedConsequences },
    }),
  );
  render();
  expect(await screen.findByText('Product-level stock')).toBeVisible();
  expect(screen.getByText('5')).toBeVisible();
  expect(screen.getByText('42')).toBeVisible();
  expect(screen.getByText('Sets stock for "Headphones" from 5 to 42 on confirm')).toBeVisible();
  expect(screen.getByRole('button', { name: /Confirm — apply this stock change/ })).toBeEnabled();
});
