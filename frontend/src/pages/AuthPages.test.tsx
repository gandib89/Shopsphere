import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocation } from 'react-router-dom';
import { renderRoute } from '../test/render';
import { login, register, googleLogin, type SessionUser } from '../lib/session';
import AuthLanding from './AuthLanding';
import UserAuth from './UserAuth';
import AdminAuth from './AdminAuth';

vi.mock('../lib/session', () => ({ login: vi.fn(), register: vi.fn(), googleLogin: vi.fn() }));
vi.mock('@react-oauth/google', () => ({ GoogleLogin: ({ onSuccess, onError }: { onSuccess: (r: { credential: string }) => void; onError: () => void }) => <><button onClick={() => onSuccess({ credential: 'mock-google-credential' })}>Continue with Google</button><button onClick={onError}>Google failure</button></> }));

const customer: SessionUser = { id: 'test-customer', email: 'test@example.test', role: 'user', admin: false, seller: false, sellerVerified: false };
function Location() { return <div data-testid="location">{useLocation().pathname}</div>; }
function show(page: React.ReactElement, path: string) { return renderRoute(<>{page}<Location /></>, path); }
async function fillSignIn(user: ReturnType<typeof userEvent.setup>, admin = false) {
  await user.type(screen.getByLabelText(admin ? 'Admin email' : 'Email address'), customer.email);
  await user.type(screen.getByLabelText('Password', { exact: true }), 'TestPassword!123');
}
async function fillSignUp(user: ReturnType<typeof userEvent.setup>, seller = false) {
  await user.click(screen.getByRole('button', { name: 'Create an account' }));
  await user.type(screen.getByLabelText('First name'), 'Asha');
  await user.type(screen.getByLabelText('Last name'), 'Gurung');
  await fillSignIn(user);
  await user.type(screen.getByLabelText('Confirm password', { exact: true }), 'TestPassword!123');
  if (seller) await user.type(screen.getByLabelText('Shop name'), 'Asha Technology');
}

beforeEach(() => { vi.resetAllMocks(); });

describe('auth account selection', () => {
  it.each([
    ['Customer', 'customer', '/user-auth'],
    ['Seller', 'seller', '/seller-auth'],
    ['Administrator', 'admin', '/admin-auth'],
  ])('routes %s to the existing sign-in page', async (name, action, destination) => {
    const user = userEvent.setup();
    show(<AuthLanding />, '/auth');
    await user.click(screen.getByRole('radio', { name: new RegExp(`^${name}`) }));
    await user.click(screen.getByRole('button', { name: `Continue as ${action}` }));
    expect(screen.getByTestId('location')).toHaveTextContent(destination);
  });

  it('supports keyboard role selection and keeps demo information collapsed', async () => {
    const user = userEvent.setup();
    show(<AuthLanding />, '/auth');
    screen.getByRole('radio', { name: /^Customer/ }).focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: /^Seller/ })).toBeChecked();
    const summary = screen.getByText('Trying the demo?');
    expect(summary.closest('details')).not.toHaveAttribute('open');
    await user.click(summary);
    expect(summary.closest('details')).toHaveAttribute('open');
    expect(screen.getByText('seller1@shopsphere.test')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Back to store' })).toHaveAttribute('href', '/');
  });
});

describe('customer and seller forms', () => {
  it('provides associated labels, autocomplete, and a non-submitting password toggle', async () => {
    const user = userEvent.setup();
    show(<UserAuth />, '/user-auth');
    expect(screen.getByLabelText('Email address')).toHaveAttribute('autocomplete', 'email');
    const password = screen.getByLabelText('Password', { exact: true });
    expect(password).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(password).toHaveAttribute('type', 'password');
    expect(login).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/forgot-password');
  });

  it.each([false, true])('preserves sign-in routing (seller=%s)', async seller => {
    const user = userEvent.setup();
    vi.mocked(login).mockResolvedValue({ ...customer, seller });
    show(<UserAuth />, seller ? '/seller-auth' : '/user-auth');
    await fillSignIn(user);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(login).toHaveBeenCalledWith(customer.email, 'TestPassword!123');
    expect(screen.getByTestId('location').textContent).toBe(seller ? '/seller-panel' : '/');
  });

  it('prevents duplicate submissions and reports a server error inline', async () => {
    const user = userEvent.setup();
    let reject!: (reason: unknown) => void;
    vi.mocked(login).mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
    show(<UserAuth />, '/user-auth');
    await fillSignIn(user);
    await user.dblClick(screen.getByRole('button', { name: 'Sign in' }));
    expect(login).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled();
    expect(screen.getByLabelText('Email address')).toBeDisabled();
    await act(async () => reject({ isAxiosError: true, response: { data: { message: 'Email or password is incorrect.' } } }));
    expect(screen.getByRole('alert')).toHaveTextContent('Email or password is incorrect.');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('does not submit incomplete fields', async () => {
    const user = userEvent.setup();
    show(<UserAuth />, '/user-auth');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(login).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Email address')).toBeInvalid();
  });

  it('validates password confirmation without a registration request', async () => {
    const user = userEvent.setup();
    show(<UserAuth />, '/user-auth');
    await fillSignUp(user);
    await user.type(screen.getByLabelText('Confirm password', { exact: true }), 'mismatch');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Passwords do not match');
    expect(register).not.toHaveBeenCalled();
  });

  it.each([false, true])('preserves registration payload and shows inline success (seller=%s)', async seller => {
    const user = userEvent.setup();
    vi.mocked(register).mockResolvedValue({ ...customer, seller });
    show(<UserAuth />, seller ? '/seller-auth' : '/user-auth');
    await fillSignUp(user, seller);
    expect(screen.getByLabelText('Password', { exact: true })).toHaveAttribute('autocomplete', 'new-password');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(register).toHaveBeenCalledWith({ email: customer.email, password: 'TestPassword!123', firstName: 'Asha', lastName: 'Gurung', phone: '', role: seller ? 'seller' : 'user', ...(seller ? { shopName: 'Asha Technology', shopDescription: '' } : {}) });
    expect(screen.getByRole('status')).toHaveTextContent(seller ? 'awaiting approval' : 'Your account is ready');
    expect(screen.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  });

  it('retains customer Google sign-in and keeps it off seller forms', async () => {
    const user = userEvent.setup();
    vi.mocked(googleLogin).mockResolvedValue(customer);
    const view = show(<UserAuth />, '/user-auth');
    await user.click(screen.getByRole('button', { name: 'Continue with Google' }));
    expect(googleLogin).toHaveBeenCalledWith('mock-google-credential');
    expect(screen.getByTestId('location').textContent).toBe('/');
    view.unmount();
    show(<UserAuth />, '/seller-auth');
    expect(screen.queryByRole('button', { name: 'Continue with Google' })).not.toBeInTheDocument();
  });
});

describe('administrator form', () => {
  it.each([false, true])('preserves the admin access check (admin=%s)', async admin => {
    const user = userEvent.setup();
    vi.mocked(login).mockResolvedValue({ ...customer, admin });
    show(<AdminAuth />, '/admin-auth');
    await fillSignIn(user, true);
    await user.click(screen.getByRole('button', { name: 'Sign in as admin' }));
    if (admin) expect(screen.getByTestId('location').textContent).toBe('/admin');
    else {
      expect(screen.getByRole('alert')).toHaveTextContent('This account does not have admin access.');
      expect(screen.getByTestId('location').textContent).toBe('/admin-auth');
    }
    expect(screen.queryByRole('button', { name: 'Create an account' })).not.toBeInTheDocument();
  });
});
