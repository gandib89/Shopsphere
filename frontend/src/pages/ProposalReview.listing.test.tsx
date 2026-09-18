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

const publishProposal = {
  id: 'prop-listing-1',
  actionKind: 'listing.publish_draft',
  status: 'pending',
  expectedVersion: 3,
  expiresAt: '2026-09-19T10:10:00.000Z',
  createdAt: '2026-09-19T10:00:00.000Z',
  preview: {
    actionKind: 'listing.publish_draft',
    draftId: 'd4f1a2b3c4d5e6f7a8b9c0d1',
    title: 'MacBook Air M2 — renewed',
    description: 'MacBook Air M2 — renewed\n\nHighlights:\n- 18-hour battery',
    highlights: ['18-hour battery'],
    sourceProductId: null,
  },
  disclosures: [
    'Publishes a new live product with exactly the reviewed content',
    'No price or stock is set by this action — configure them in ShopSphere afterward',
    'No notifications are sent',
  ],
};

const contentProposal = {
  id: 'prop-listing-2',
  actionKind: 'listing.update_content',
  status: 'pending',
  expectedVersion: 1780000000,
  expiresAt: '2026-09-19T10:10:00.000Z',
  createdAt: '2026-09-19T10:00:00.000Z',
  preview: {
    actionKind: 'listing.update_content',
    productId: 'prod-listing-1',
    productName: 'Headphones',
    before: { name: 'Headphones', description: 'Old copy' },
    after: { name: 'Headphones (2026)', description: 'New copy' },
  },
  disclosures: [
    'Applies exactly the reviewed content changes to the live listing',
    'No price, stock, or visibility is changed',
    'No notifications are sent',
  ],
};

const renderAt = (id: string) =>
  renderRoute(
    <Routes>
      <Route path="/proposals/:proposalId" element={<ProposalReview />} />
    </Routes>,
    `/proposals/${id}`,
  );

beforeEach(() => {
  vi.resetAllMocks();
});

it('renders the exact publish preview content and the fixed disclosures', async () => {
  vi.mocked(authFetch).mockImplementation(async () => json({ proposal: publishProposal }));
  renderAt(publishProposal.id);
  expect(await screen.findByText('MacBook Air M2 — renewed')).toBeVisible();
  // The description shown is the exact description the product will carry
  // (draft copy with the highlights block appended).
  expect(screen.getByText((content) => content.includes('Highlights: - 18-hour battery'))).toBeVisible();
  expect(screen.getAllByText(/18-hour battery/).length).toBeGreaterThanOrEqual(2);
  for (const disclosure of publishProposal.disclosures) {
    expect(screen.getByText(disclosure)).toBeVisible();
  }
  expect(screen.getByRole('button', { name: /Confirm — apply exactly these changes/ })).toBeEnabled();
  // Listing proposals never show cart money rows or availability labels.
  expect(screen.queryByText(/Cart subtotal/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Availability:/i)).not.toBeInTheDocument();
});

it('renders the exact before and after values for a content-change proposal', async () => {
  vi.mocked(authFetch).mockImplementation(async () => json({ proposal: contentProposal }));
  renderAt(contentProposal.id);
  // "Headphones" is both the product name heading and the before value.
  expect((await screen.findAllByText('Headphones')).length).toBeGreaterThanOrEqual(1);
  expect(screen.getByText('Headphones (2026)')).toBeVisible();
  expect(screen.getByText('Old copy')).toBeVisible();
  expect(screen.getByText('New copy')).toBeVisible();
  for (const disclosure of contentProposal.disclosures) {
    expect(screen.getByText(disclosure)).toBeVisible();
  }
});

it('executes through the browser endpoint exactly once, only from the review confirm button', async () => {
  vi.mocked(authFetch).mockImplementation(async (input, init) => {
    if (init?.method === 'POST') return json({ status: 'executed', executionReference: 'proposal-exec-prop-listing-1' });
    return json({ proposal: publishProposal });
  });
  const user = userEvent.setup();
  renderAt(publishProposal.id);
  // No publish affordance exists before the reviewer acts: loading the screen
  // performs only the GET review call.
  expect(vi.mocked(authFetch).mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  await user.click(await screen.findByRole('button', { name: /Confirm — apply exactly these changes/ }));
  const posts = vi.mocked(authFetch).mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(posts).toHaveLength(1);
  expect(String(posts[0]![0])).toMatch(/\/api\/v1\/proposals\/prop-listing-1\/execute$/);
  expect(await screen.findByText(/listing now reflects exactly the reviewed content/i)).toBeVisible();
  // The confirm affordance is gone once applied.
  expect(screen.queryByRole('button', { name: /Confirm — apply exactly these changes/ })).not.toBeInTheDocument();
});

it('renders the listing-specific stale outcome and no further confirm affordance', async () => {
  vi.mocked(authFetch).mockImplementation(async (input, init) => {
    if (init?.method === 'POST') return json({ code: 'proposal_not_executable', reason: 'stale' }, 409);
    return json({ proposal: contentProposal });
  });
  const user = userEvent.setup();
  renderAt(contentProposal.id);
  await user.click(await screen.findByRole('button', { name: /Confirm — apply exactly these changes/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The listing changed after this proposal was created, so it can no longer be applied. Nothing was changed.',
  );
});

it('renders the expired outcome as non-applicable', async () => {
  vi.mocked(authFetch).mockImplementation(async (input, init) => {
    if (init?.method === 'POST') return json({ code: 'proposal_not_executable', reason: 'expired' }, 409);
    return json({ proposal: publishProposal });
  });
  const user = userEvent.setup();
  renderAt(publishProposal.id);
  await user.click(await screen.findByRole('button', { name: /Confirm — apply exactly these changes/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'This proposal expired before it was confirmed. Nothing was changed.',
  );
});

it('never exposes delegated-token, scope, or execution-secret affordances', async () => {
  vi.mocked(authFetch).mockImplementation(async () => json({ proposal: publishProposal }));
  renderAt(publishProposal.id);
  await screen.findByText('MacBook Air M2 — renewed');
  const text = document.body.textContent ?? '';
  expect(text).not.toMatch(/delegated/i);
  expect(text).not.toMatch(/listings:propose/);
  expect(text).not.toMatch(/Bearer /);
  expect(text).not.toMatch(/executionReference/i);
  expect(text).not.toMatch(/approv(er|al)/i);
});
