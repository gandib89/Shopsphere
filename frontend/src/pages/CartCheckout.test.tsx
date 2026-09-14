import { screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import axios from 'axios';
import { authFetch } from '../lib/session';
import { renderRoute } from '../test/render';
import CartCheckout from './CartCheckout';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    isAxiosError: (error: { isAxiosError?: boolean }) => error?.isAxiosError === true,
  },
}));
vi.mock('../components/NavBar', () => ({ default: () => <nav aria-label="Main navigation" /> }));
vi.mock('../lib/session', () => ({ authFetch: vi.fn() }));
vi.mock('../lib/esewa', () => ({ startESewaCheckout: vi.fn() }));

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  localStorage.setItem('token', 'session');
});

it('prefills editable checkout details from the saved profile address', async () => {
  vi.mocked(axios.get).mockResolvedValue({ data: { data: {
    _id: 'cart-1',
    email: 'cart@example.test',
    totalPrice: 150000,
    items: [{ _id: 'item-1', product: { id: 'product-1', name: 'iPhone', price: 150000, images: [] }, quantity: 1, price: 150000 }],
  } } });
  vi.mocked(authFetch).mockResolvedValue(new Response(JSON.stringify({
    firstName: 'Asha',
    lastName: 'Sharma',
    email: 'asha@example.test',
    phone: '9812345678',
    homeStreet: 'Ward 4, Lazimpat',
    homeCity: 'Kathmandu',
    homeState: 'Bagmati',
    homeZipCode: '44600',
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

  renderRoute(<CartCheckout />);

  expect(await screen.findByLabelText('First name')).toHaveValue('Asha');
  expect(screen.getByLabelText('Last name')).toHaveValue('Sharma');
  expect(screen.getByLabelText('Email')).toHaveValue('asha@example.test');
  expect(screen.getByLabelText('Mobile number')).toHaveValue('9812345678');
  expect(screen.getByLabelText('Street, ward, or local address')).toHaveValue('Ward 4, Lazimpat');
  expect(screen.getByLabelText('Municipality or city')).toHaveValue('Kathmandu');
  expect(screen.getByLabelText('Province')).toHaveValue('Bagmati');
  expect(screen.getByLabelText('Postal code')).toHaveValue('44600');
  expect(screen.getByLabelText('Street, ward, or local address')).not.toHaveAttribute('readonly');
});
