import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { startESewaCheckout } from '../lib/esewa';
import { authFetch } from '../lib/session';
import Success from './Success';
import Failure from './Failure';

vi.mock('../components/NavBar', () => ({ default: () => <nav aria-label="Main navigation" /> }));
vi.mock('../lib/session', () => ({ authFetch: vi.fn() }));
vi.mock('../lib/esewa', () => ({ startESewaCheckout: vi.fn() }));

const renderPaymentRoute = (element: ReactElement, path: string, pattern: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes><Route path={pattern} element={element} /></Routes>
  </MemoryRouter>,
);

const orderResponse = (paymentStatus: 'Initiated' | 'Succeeded' | 'Failed', orderStatus = 'Pending') =>
  new Response(JSON.stringify({
    _id: 'order-1',
    status: orderStatus,
    firstName: 'Asha',
    lastName: 'Sharma',
    email: 'asha@example.test',
    totalPrice: 125000,
    quantity: 1,
    deliveryDate: '2026-09-12T00:00:00.000Z',
    product: { _id: 'product-1', name: 'iPhone 15', price: 125000 },
    payments: [{ id: 'payment-1', status: paymentStatus }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });

describe('payment result pages', () => {
  beforeEach(() => vi.resetAllMocks());

  it('does not claim success while payment verification is still pending', async () => {
    vi.mocked(authFetch).mockResolvedValue(orderResponse('Initiated'));
    renderPaymentRoute(<Success />, '/success/order-1', '/success/:orderId');

    expect(await screen.findByRole('heading', { name: /payment verification is pending/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /order successful/i })).not.toBeInTheDocument();
    expect(authFetch).toHaveBeenCalledTimes(1);
    expect(authFetch).toHaveBeenCalledWith(expect.stringContaining('/api/v1/order/details/order-1'));
  });

  it('keeps a failed payment order available until the customer explicitly acts', async () => {
    vi.mocked(authFetch).mockResolvedValue(orderResponse('Failed'));
    renderPaymentRoute(<Failure />, '/failure/order-1', '/failure/:orderId');

    expect(await screen.findByRole('heading', { name: /payment was not completed/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry with esewa/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel order/i })).toBeInTheDocument();
    await waitFor(() => expect(authFetch).toHaveBeenCalledTimes(1));
    expect(vi.mocked(authFetch).mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(false);
  });


  it('only cancels after the customer confirms the action', async () => {
    const user = userEvent.setup();
    vi.mocked(authFetch)
      .mockResolvedValueOnce(orderResponse('Failed'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Unpaid order cancelled' }), { status: 200 }));
    renderPaymentRoute(<Failure />, '/failure/order-1', '/failure/:orderId');

    await user.click(await screen.findByRole('button', { name: /^cancel order$/i }));
    expect(authFetch).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: /yes, cancel order/i }));

    await waitFor(() => expect(authFetch).toHaveBeenCalledTimes(2));
    expect(authFetch).toHaveBeenLastCalledWith(
      expect.stringContaining('/api/v1/order/cancel/order-1'),
      { method: 'PUT' },
    );
    expect(await screen.findByRole('heading', { name: /order cancelled/i })).toBeInTheDocument();
  });

  it('reopens server-signed eSewa checkout only after the customer selects retry', async () => {
    const user = userEvent.setup();
    vi.mocked(authFetch).mockResolvedValue(orderResponse('Failed'));
    vi.mocked(startESewaCheckout).mockResolvedValue(undefined);
    renderPaymentRoute(<Failure />, '/failure/order-1', '/failure/:orderId');

    expect(startESewaCheckout).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('button', { name: /retry with esewa/i }));
    expect(startESewaCheckout).toHaveBeenCalledWith('order-1');
  });

  it('shows success only for a server-verified payment and confirmed order', async () => {
    vi.mocked(authFetch).mockResolvedValue(orderResponse('Succeeded', 'Confirmed'));
    renderPaymentRoute(<Success />, '/success/order-1', '/success/:orderId');

    expect(await screen.findByRole('heading', { name: /order successful/i })).toBeInTheDocument();
  });
});
