import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { authFetch } from '../lib/session';
import NotificationBell from './NotificationBell';

vi.mock('../lib/session', () => ({ authFetch: vi.fn() }));

const response = (body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  localStorage.setItem('token', 'session');
});

it('persists the read state using the notification id returned by the API', async () => {
  vi.mocked(authFetch)
    .mockImplementationOnce(() => response({
      notifications: [{
        id: 'notification-1',
        type: 'discount',
        title: 'New Promo Code: SHOPSPHERE',
        message: 'Get 10% off your first three purchases.',
        read: false,
        createdAt: '2026-09-12T00:00:00.000Z',
      }],
      unreadCount: 1,
    }))
    .mockImplementationOnce(() => response({ message: 'Marked as read' }));

  const user = userEvent.setup();
  render(<MemoryRouter><NotificationBell /></MemoryRouter>);

  await user.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }));
  const notificationButton = screen.getByText('New Promo Code: SHOPSPHERE').closest('button');
  expect(notificationButton).not.toBeNull();
  await user.click(notificationButton!);

  await waitFor(() => expect(authFetch).toHaveBeenLastCalledWith(
    expect.stringContaining('/api/v1/notifications/read/notification-1'),
    { method: 'PUT' },
  ));
  expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
  expect(screen.queryByText(/unread/i)).not.toBeInTheDocument();
});
