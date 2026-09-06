import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { SessionRecovery } from './SessionRecovery';
import { refreshSession } from '../../lib/session';

vi.mock('../../lib/session', () => ({ refreshSession: vi.fn() }));
beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); });

it('does not delay guests', () => {
  render(<SessionRecovery><p>Account page</p></SessionRecovery>);
  expect(screen.getByText('Account page')).toBeVisible();
  expect(refreshSession).not.toHaveBeenCalled();
});

it('waits for session restoration before mounting account pages', async () => {
  localStorage.setItem('token', 'session');
  let finish!: (token: string) => void;
  vi.mocked(refreshSession).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  render(<SessionRecovery><p>Account page</p></SessionRecovery>);
  expect(screen.queryByText('Account page')).not.toBeInTheDocument();
  expect(screen.getByText('Restoring your session…')).toBeVisible();
  await act(async () => finish('fresh-access'));
  expect(screen.getByText('Account page')).toBeVisible();
});

it('offers retry after an outage without exposing account pages', async () => {
  localStorage.setItem('token', 'session');
  vi.mocked(refreshSession).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('fresh-access');
  render(<SessionRecovery><p>Account page</p></SessionRecovery>);
  await screen.findByText('Unable to reconnect');
  expect(screen.queryByText('Account page')).not.toBeInTheDocument();
  expect(localStorage.getItem('token')).toBe('session');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByText('Account page');
});

it('retries when connectivity returns and handles expired sessions', async () => {
  localStorage.setItem('token', 'session');
  vi.mocked(refreshSession).mockRejectedValueOnce(new Error('offline')).mockImplementationOnce(async () => {
    localStorage.removeItem('token');
    return null;
  });
  render(<SessionRecovery><p>Routes ready</p></SessionRecovery>);
  await screen.findByText('Unable to reconnect');
  fireEvent(window, new Event('online'));
  await waitFor(() => expect(screen.getByText('Routes ready')).toBeVisible());
  expect(localStorage.getItem('token')).toBeNull();
});
