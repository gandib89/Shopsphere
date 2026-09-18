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

// The exact server-computed snapshot the price proposal service stores.
const pricePreview = {
  actionKind: 'product.set_price',
  currency: 'NPR',
  productId: 'prod-1',
  productName: 'Headphones',
  change: 'set_price',
  oldValue: '900',
  newValue: '850',
  effectiveDisplayPriceBefore: { amount: '810', currency: 'NPR' },
  effectiveDisplayPriceAfter: { amount: '765', currency: 'NPR' },
  disclosedConsequences: [
    'Changes the live listing price from 900 to 850 NPR',
    'No orders, payments, or promotions are affected',
  ],
};

const proposal = {
  id: 'prop-price-1',
  actionKind: 'product.set_price',
  status: 'pending',
  expectedVersion: 1789123456,
  expiresAt: '2026-09-18T10:10:00.000Z',
  createdAt: '2026-09-18T10:00:00.000Z',
  preview: pricePreview,
  disclosures: pricePreview.disclosedConsequences,
};

const render = () =>
  renderRoute(
    <Routes>
      <Route path="/proposals/:proposalId" element={<ProposalReview />} />
    </Routes>,
    '/proposals/prop-price-1',
  );

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(authFetch).mockImplementation(async () => json({ proposal }));
});

it('renders the exact server-computed old/new values and the disclosed consequences', async () => {
  render();
  expect(await screen.findByText('Headphones')).toBeVisible();
  expect(screen.getByText('900 → 850')).toBeVisible();
  expect(screen.getByText('810 NPR → 765 NPR')).toBeVisible();
  expect(screen.getByText('Changes the live listing price from 900 to 850 NPR')).toBeVisible();
  expect(screen.getByText('No orders, payments, or promotions are affected')).toBeVisible();
  expect(screen.getByRole('button', { name: /Confirm — apply this price/ })).toBeVisible();
  // No cart before/after table and no buyer refund affordance on a price change.
  expect(screen.queryByText('Cart subtotal')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /refund/i })).not.toBeInTheDocument();
});

it('requires the password step-up field, keeps it masked, and never displays it', async () => {
  render();
  const field = await screen.findByLabelText('Current ShopSphere password');
  expect(field).toBeVisible();
  expect(field).toHaveAttribute('type', 'password');
  expect(field).toHaveAttribute('autocomplete', 'current-password');
  expect(field).not.toBeDisabled();
  // The field starts empty — no value is ever displayed or prefilled.
  expect(field).toHaveValue('');
  // Confirm is disabled until the password is entered.
  expect(screen.getByRole('button', { name: /Confirm — apply this price/ })).toBeDisabled();
});

it('does not post until the password is entered, then sends it exactly once in the JSON body', async () => {
  const user = userEvent.setup();
  render();
  const confirmButton = await screen.findByRole('button', { name: /Confirm — apply this price/ });
  expect(confirmButton).toBeDisabled();
  await user.type(screen.getByLabelText('Current ShopSphere password'), 'S3ller-Passphrase!');
  expect(confirmButton).toBeEnabled();
  await user.click(confirmButton);

  const posts = vi.mocked(authFetch).mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(posts).toHaveLength(1);
  expect(String(posts[0]![0])).toMatch(/\/api\/v1\/proposals\/prop-price-1\/execute$/);
  expect(JSON.parse(String(posts[0]![1]!.body))).toEqual({ confirmPassword: 'S3ller-Passphrase!' });
  expect(await screen.findByText(/Your listing now uses exactly the reviewed value/i)).toBeVisible();
  // The confirm affordance and the password field are gone once applied.
  expect(screen.queryByRole('button', { name: /Confirm — apply this price/ })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Current ShopSphere password')).not.toBeInTheDocument();
});

it('shows that nothing was changed when the password confirmation fails (403)', async () => {
  vi.mocked(authFetch).mockImplementation(async (input, init) => {
    if (init?.method === 'POST') return json({ code: 'reauthorization_required' }, 403);
    return json({ proposal });
  });
  const user = userEvent.setup();
  render();
  await user.type(await screen.findByLabelText('Current ShopSphere password'), 'Wrong-Password!');
  await user.click(screen.getByRole('button', { name: /Confirm — apply this price/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Password confirmation failed. Nothing was changed.',
  );
  // Still pending: the screen keeps the review state, never an applied state,
  // and the wrong password is cleared so it must be retyped.
  expect(screen.getByText(/Confirming applies exactly this value/)).toBeInTheDocument();
  const field = screen.getByLabelText('Current ShopSphere password');
  expect(field).toHaveValue('');
  expect(screen.getByRole('button', { name: /Confirm — apply this price/ })).toBeDisabled();
});

it('renders the distinct stale outcome when the product moved on after the preview', async () => {
  vi.mocked(authFetch).mockImplementation(async (input, init) => {
    if (init?.method === 'POST') return json({ code: 'proposal_not_executable', reason: 'stale' }, 409);
    return json({ proposal });
  });
  const user = userEvent.setup();
  render();
  await user.type(await screen.findByLabelText('Current ShopSphere password'), 'S3ller-Passphrase!');
  await user.click(screen.getByRole('button', { name: /Confirm — apply this price/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Your product changed after this proposal was created, so it can no longer be applied. Nothing was changed.',
  );
});

it('renders the discount proposal descriptor for product.set_discount', async () => {
  const discountPreview = {
    ...pricePreview,
    actionKind: 'product.set_discount',
    change: 'set_discount',
    oldValue: '10',
    newValue: '25',
    effectiveDisplayPriceBefore: { amount: '810', currency: 'NPR' },
    effectiveDisplayPriceAfter: { amount: '675', currency: 'NPR' },
    disclosedConsequences: [
      'Changes the discount percentage from 10% to 25%',
      'No orders, payments, or promotions are affected',
    ],
  };
  vi.mocked(authFetch).mockImplementation(async () =>
    json({
      proposal: { ...proposal, actionKind: 'product.set_discount', preview: discountPreview, disclosures: discountPreview.disclosedConsequences },
    }),
  );
  render();
  expect(await screen.findByText('10 → 25')).toBeVisible();
  expect(screen.getByText('Changes the discount percentage from 10% to 25%')).toBeVisible();
  expect(screen.getByRole('button', { name: /Confirm — apply this discount/ })).toBeInTheDocument();
});
