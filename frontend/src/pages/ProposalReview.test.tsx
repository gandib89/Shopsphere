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

const preview = {
  actionKind: 'cart.update_quantity',
  currency: 'NPR',
  productName: 'Headphones',
  availability: 'In stock',
  before: {
    quantity: 2,
    unitPrice: { amount: '90', currency: 'NPR' },
    lineTotal: { amount: '180', currency: 'NPR' },
    cartSubtotal: { amount: '180', currency: 'NPR' },
  },
  after: {
    quantity: 5,
    unitPrice: { amount: '90', currency: 'NPR' },
    lineTotal: { amount: '450', currency: 'NPR' },
    cartSubtotal: { amount: '450', currency: 'NPR' },
  },
};

const proposal = {
  id: 'prop-1',
  actionKind: 'cart.update_quantity',
  status: 'pending',
  expectedVersion: 3,
  expiresAt: '2026-09-18T10:10:00.000Z',
  createdAt: '2026-09-18T10:00:00.000Z',
  preview,
  disclosures: ['Changes your cart quantities', 'No payment is taken'],
};

const render = () =>
  renderRoute(
    <Routes>
      <Route path="/proposals/:proposalId" element={<ProposalReview />} />
    </Routes>,
    '/proposals/prop-1',
  );

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(authFetch).mockImplementation(async () => json({ proposal }));
});

it('renders the exact before and after values from the backend preview', async () => {
  render();
  expect(await screen.findByText('Headphones')).toBeVisible();
  // "180 NPR" (before line total and before cart subtotal) and "450 NPR"
  // (after line total and after cart subtotal) each appear more than once.
  expect(screen.getAllByText('180 NPR').length).toBeGreaterThanOrEqual(1);
  expect(screen.getAllByText('450 NPR').length).toBeGreaterThanOrEqual(1);
  expect(screen.getAllByText('90 NPR').length).toBeGreaterThanOrEqual(1);
  expect(screen.getByText('Changes your cart quantities')).toBeVisible();
  expect(screen.getByText('No payment is taken')).toBeVisible();
  expect(screen.getByRole('button', { name: /Confirm — apply exactly these changes/ })).toBeEnabled();
});

it('shows no delegated-token, MCP, or secret affordances anywhere on the screen', async () => {
  render();
  await screen.findByText('Headphones');
  const text = document.body.textContent ?? '';
  expect(text).not.toMatch(/delegated/i);
  expect(text).not.toMatch(/cart:propose/);
  expect(text).not.toMatch(/proposals:read/);
  expect(text).not.toMatch(/Bearer /);
  expect(text).not.toMatch(/executionReference/);
  expect(text).not.toMatch(/approv(er|al)/i);
});

it('confirms through the browser execute endpoint exactly once and renders the outcome', async () => {
  const user = userEvent.setup();
  render();
  await user.click(await screen.findByRole('button', { name: /Confirm — apply exactly these changes/ }));
  const posts = vi.mocked(authFetch).mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(posts).toHaveLength(1);
  expect(String(posts[0]![0])).toMatch(/\/api\/v1\/proposals\/prop-1\/execute$/);
  expect(await screen.findByText(/cart now reflects exactly the reviewed change/i)).toBeVisible();
  expect(screen.getByText(/changes were reviewed on this screen before they were applied/i)).toBeVisible();
  // The confirm affordance is gone once applied.
  expect(screen.queryByRole('button', { name: /Confirm — apply exactly these changes/ })).not.toBeInTheDocument();
});

it('renders the distinct stale outcome when the cart moved on after the preview', async () => {
  vi.mocked(authFetch).mockImplementation(async (input, init) => {
    if (init?.method === 'POST') return json({ code: 'proposal_not_executable', reason: 'stale' }, 409);
    return json({ proposal });
  });
  const user = userEvent.setup();
  render();
  await user.click(await screen.findByRole('button', { name: /Confirm — apply exactly these changes/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Your cart changed after this proposal was created, so it can no longer be applied. Nothing was changed.',
  );
});

it('renders the distinct expired outcome', async () => {
  vi.mocked(authFetch).mockImplementation(async (input, init) => {
    if (init?.method === 'POST') return json({ code: 'proposal_not_executable', reason: 'expired' }, 409);
    return json({ proposal });
  });
  const user = userEvent.setup();
  render();
  await user.click(await screen.findByRole('button', { name: /Confirm — apply exactly these changes/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'This proposal expired before it was confirmed. Nothing was changed.',
  );
});

it('renders a generic not-found screen for foreign or missing proposals', async () => {
  vi.mocked(authFetch).mockImplementation(async () => json({ code: 'not_found' }, 404));
  render();
  expect(await screen.findByText('Proposal not found')).toBeVisible();
  expect(screen.getByText(/does not exist or does not belong to this account/i)).toBeVisible();
  expect(screen.queryByRole('button', { name: /Confirm/ })).not.toBeInTheDocument();
});
