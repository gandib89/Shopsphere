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

const returnProposal = {
  id: 'prop-ret-1',
  actionKind: 'order.return_request',
  status: 'pending',
  expectedVersion: 1789996800,
  expiresAt: '2026-09-18T10:10:00.000Z',
  createdAt: '2026-09-18T10:00:00.000Z',
  preview: {
    actionKind: 'order.return_request',
    orderId: 'order-1',
    orderNumber: 'ORD-2026-0042',
    currentStatus: 'Delivered',
    returnEligible: true,
    orderTotal: { amount: '1299', currency: 'NPR' },
    policyBasis: [{ sourceId: 'faqs.json#1', sourceVersion: '1.0.0' }],
    disclosedConsequences: [
      'Creates a return request for seller/admin review',
      'Evidence photos are uploaded in ShopSphere, not here',
      'No refund is released by this action',
    ],
  },
  reason: 'The left earcup arrived with a cracked hinge.',
  disclosures: [
    'Creates a return request for seller/admin review',
    'Evidence photos are uploaded in ShopSphere, not here',
    'No refund is released by this action',
  ],
};

const render = () =>
  renderRoute(
    <Routes>
      <Route path="/proposals/:proposalId" element={<ProposalReview />} />
    </Routes>,
    '/proposals/prop-ret-1',
  );

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(authFetch).mockImplementation(async () => json({ proposal: returnProposal }));
});

it('renders the return descriptor with the stored reason and exact preview values', async () => {
  render();
  expect(await screen.findByText('Request order return')).toBeVisible();
  expect(screen.getAllByText(/ORD-2026-0042/).length).toBeGreaterThanOrEqual(1);
  expect(screen.getByText('Delivered')).toBeVisible();
  expect(screen.getByText('1299 NPR')).toBeVisible();
  expect(screen.getByText('The left earcup arrived with a cracked hinge.')).toBeVisible();
  expect(screen.getByText(/faqs\.json#1 \(v1\.0\.0\)/)).toBeVisible();
  // The disclosed consequences come from the server and are shown verbatim.
  expect(screen.getByText('Creates a return request for seller/admin review')).toBeVisible();
  expect(screen.getByText('Evidence photos are uploaded in ShopSphere, not here')).toBeVisible();
  expect(screen.getByText('No refund is released by this action')).toBeVisible();
  expect(screen.getByRole('button', { name: /Confirm — apply exactly these changes/ })).toBeEnabled();
});

it('shows no evidence upload, delegated-token, or secret affordances on the review screen', async () => {
  render();
  await screen.findByText('Request order return');
  const text = document.body.textContent ?? '';
  expect(text).not.toMatch(/delegated/i);
  expect(text).not.toMatch(/returns:propose/);
  expect(text).not.toMatch(/Bearer /);
  expect(text).not.toMatch(/executionReference/i);
  expect(text).not.toMatch(/approv(er|al secret)/i);
  // No file input or URL field exists on the review screen: evidence upload
  // stays in ShopSphere's trusted order flow, not here.
  expect(document.querySelector('input[type="file"]')).toBeNull();
  expect(screen.queryByRole('textbox')).toBeNull();
});

it('confirms through the browser execute endpoint once and renders the next steps', async () => {
  vi.mocked(authFetch).mockImplementation(async (input, init) => {
    if (init?.method === 'POST') {
      return json({
        status: 'executed',
        executionReference: 'proposal-exec-prop-ret-1',
        nextSteps: [
          'Upload return evidence photos in ShopSphere on your order page using the existing image upload control',
          'Seller or admin staff will review your return request in ShopSphere',
          'Any refund is a separate admin decision and is never released by this action',
        ],
      });
    }
    return json({ proposal: returnProposal });
  });
  const user = userEvent.setup();
  render();
  await user.click(await screen.findByRole('button', { name: /Confirm — apply exactly these changes/ }));
  const posts = vi.mocked(authFetch).mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(posts).toHaveLength(1);
  expect(String(posts[0]![0])).toMatch(/\/api\/v1\/proposals\/prop-ret-1\/execute$/);
  expect(await screen.findByText(/return request was submitted for seller\/admin review/i)).toBeVisible();
  expect(screen.getByText(/Upload return evidence photos in ShopSphere/)).toBeVisible();
  // The confirm affordance is gone once applied.
  expect(screen.queryByRole('button', { name: /Confirm — apply exactly these changes/ })).not.toBeInTheDocument();
});

it('renders the return-specific stale outcome when the order moved on after the preview', async () => {
  vi.mocked(authFetch).mockImplementation(async (input, init) => {
    if (init?.method === 'POST') return json({ code: 'proposal_not_executable', reason: 'stale' }, 409);
    return json({ proposal: returnProposal });
  });
  const user = userEvent.setup();
  render();
  await user.click(await screen.findByRole('button', { name: /Confirm — apply exactly these changes/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Your order changed after this proposal was created, so it can no longer be applied. Nothing was changed.',
  );
});

it('renders the return-specific rejected outcome when the order is no longer returnable', async () => {
  vi.mocked(authFetch).mockImplementation(async (input, init) => {
    if (init?.method === 'POST') return json({ code: 'proposal_not_executable', reason: 'rejected' }, 409);
    return json({ proposal: returnProposal });
  });
  const user = userEvent.setup();
  render();
  await user.click(await screen.findByRole('button', { name: /Confirm — apply exactly these changes/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'This order can no longer be returned. Nothing was changed.',
  );
});

it('renders a generic not-found screen for foreign or missing return proposals', async () => {
  vi.mocked(authFetch).mockImplementation(async () => json({ code: 'not_found' }, 404));
  render();
  expect(await screen.findByText('Proposal not found')).toBeVisible();
  expect(screen.getByText(/does not exist or does not belong to this account/i)).toBeVisible();
  expect(screen.queryByRole('button', { name: /Confirm/ })).not.toBeInTheDocument();
});
