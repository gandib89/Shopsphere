import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { authFetch } from '../lib/session';
import { renderRoute } from '../test/render';
import Profile from './Profile';

vi.mock('../components/NavBar', () => ({ default: () => <nav aria-label="Main navigation" /> }));
vi.mock('../lib/session', () => ({ authFetch: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const jsonResponse = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
}));

const profile = {
  id: 'customer-1',
  firstName: 'Asha',
  lastName: 'Sharma',
  email: 'asha@example.test',
  phone: '9812345678',
  role: 'user',
  shopName: '',
  shopDescription: '',
  homeStreet: 'Ward 4, Lazimpat',
  homeCity: 'Kathmandu',
  homeState: 'Bagmati',
  homeZipCode: '44600',
  createdAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  localStorage.setItem('token', 'session');
  localStorage.setItem('isSeller', 'false');
});

it('loads and saves the customer home address from their profile', async () => {
  vi.mocked(authFetch)
    .mockImplementationOnce(() => jsonResponse(profile))
    .mockImplementationOnce(async (_url, options) => jsonResponse({
      message: 'Profile updated successfully',
      user: { ...profile, ...JSON.parse(String(options?.body)) },
    }));

  const user = userEvent.setup();
  renderRoute(<Profile />);

  await user.click(await screen.findByRole('button', { name: /edit profile/i }));
  expect(screen.getByLabelText('Street, ward, or local address')).toHaveValue('Ward 4, Lazimpat');
  expect(screen.getByLabelText('Municipality or city')).toHaveValue('Kathmandu');
  expect(screen.getByLabelText('Province')).toHaveValue('Bagmati');
  expect(screen.getByLabelText('Postal code')).toHaveValue('44600');

  await user.clear(screen.getByLabelText('Street, ward, or local address'));
  await user.type(screen.getByLabelText('Street, ward, or local address'), 'Ward 5, Lazimpat');
  await user.click(screen.getByRole('button', { name: /save changes/i }));

  await waitFor(() => expect(authFetch).toHaveBeenCalledTimes(2));
  const saved = JSON.parse(String(vi.mocked(authFetch).mock.calls[1][1]?.body));
  expect(saved).toMatchObject({
    homeStreet: 'Ward 5, Lazimpat',
    homeCity: 'Kathmandu',
    homeState: 'Bagmati',
    homeZipCode: '44600',
  });
});
