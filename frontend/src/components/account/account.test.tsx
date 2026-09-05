import { beforeEach, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderRoute } from '../../test/render';
import { authFetch, clearSession } from '../../lib/session';
import AccountDeletion from './AccountDeletion';
import CreateSeller from './CreateSeller';

vi.mock('../../lib/session', () => ({ authFetch: vi.fn(), clearSession: vi.fn() }));
vi.mock('@react-oauth/google', () => ({ GoogleLogin: ({ onSuccess }: { onSuccess: (value: { credential: string }) => void }) => <button type="button" onClick={() => onSuccess({ credential: 'google-proof' })}>Verify Google account</button> }));
beforeEach(() => vi.resetAllMocks());
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

it('requires password and exact confirmation before self deletion, then clears the session', async () => {
  const user = userEvent.setup();
  vi.mocked(authFetch).mockResolvedValue(response({ message: 'Deleted' }));
  renderRoute(<Routes><Route path="/" element={<AccountDeletion name="Asha" />} /><Route path="/auth" element={<p>Account options</p>} /></Routes>);
  await user.click(screen.getByRole('button', { name: 'Delete account permanently' }));
  const submit = screen.getByRole('button', { name: 'Confirm permanent deletion' });
  expect(submit).toBeDisabled();
  await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
  expect(submit).toBeDisabled();
  await user.type(screen.getByLabelText('Current password'), 'my-password');
  await user.click(submit);
  expect(await screen.findByText('Account options')).toBeVisible();
  expect(clearSession).toHaveBeenCalledOnce();
  expect(authFetch).toHaveBeenCalledWith(expect.stringContaining('/auth/account'), expect.objectContaining({ method: 'DELETE', body: JSON.stringify({ confirmation: 'DELETE', password: 'my-password' }) }));
});

it('shows unresolved orders without clearing the session or leaving the form', async () => {
  const user = userEvent.setup();
  vi.mocked(authFetch).mockResolvedValue(response({ message: 'Resolve unfinished orders.' }, 409));
  renderRoute(<AccountDeletion sellerId="seller-id" name="Asha Shop" />);
  await user.click(screen.getByRole('button', { name: 'Delete account permanently' }));
  await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
  await user.click(screen.getByRole('button', { name: 'Confirm permanent deletion' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Resolve unfinished orders.');
  expect(clearSession).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Type DELETE to confirm')).toHaveValue('DELETE');
});

it('uses linked Google credentials for passwordless account deletion', async () => {
  const user = userEvent.setup();
  vi.mocked(authFetch).mockResolvedValue(response({ message: 'Try again' }, 500));
  renderRoute(<AccountDeletion name="Asha" hasPassword={false} googleLinked />);
  await user.click(screen.getByRole('button', { name: 'Delete account permanently' }));
  expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Verify Google account' }));
  await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
  await user.click(screen.getByRole('button', { name: 'Confirm permanent deletion' }));
  expect(authFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ body: JSON.stringify({ confirmation: 'DELETE', googleToken: 'google-proof' }) }));
});

it('seller creation preserves entered details when the email is already taken', async () => {
  const user = userEvent.setup();
  vi.mocked(authFetch).mockResolvedValue(response({ message: 'An account already uses this email.' }, 409));
  renderRoute(<CreateSeller onCancel={vi.fn()} />);
  await user.type(screen.getByLabelText('First name'), 'Asha');
  await user.type(screen.getByLabelText('Last name'), 'Rai');
  await user.type(screen.getByLabelText('Email'), 'asha@example.test');
  await user.type(screen.getByLabelText('Shop name'), 'Asha Shop');
  await user.type(screen.getByLabelText(/Initial password/), 'Password!2026');
  await user.click(screen.getByRole('button', { name: 'Create seller' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('already uses this email');
  expect(screen.getByLabelText('Shop name')).toHaveValue('Asha Shop');
  const body = JSON.parse(vi.mocked(authFetch).mock.calls[0][1]!.body as string);
  expect(body.isVerified).toBe(false);
  expect(body.role).toBeUndefined();
  expect(clearSession).not.toHaveBeenCalled();
});
