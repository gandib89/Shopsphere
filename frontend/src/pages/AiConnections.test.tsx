import { beforeEach, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderRoute } from '../test/render';
import { authFetch } from '../lib/session';
import AiConnections from './AiConnections';

vi.mock('../lib/session', () => ({ authFetch: vi.fn() }));

const client = {
  id: 'shopsphere-mcp-client',
  name: 'ShopSphere approved MCP client',
  role: 'user',
  availableScopes: ['profile:read', 'cart:read'],
  retentionNotice: "ShopSphere cannot control that client's retention after disclosure.",
};
const connection = { ...client, clientId: client.id, clientName: client.name, scopes: ['profile:read'] };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(authFetch).mockImplementation(async (input, init) => {
    const url = String(input);
    if (init?.method === 'DELETE') return new Response(null, { status: 204 });
    if (init?.method === 'POST') return json({ message: 'Consent service unavailable' }, 503);
    if (url.endsWith('/catalog')) return json({ clients: [client] });
    return json({ connections: [connection] });
  });
});

it('shows the named client, live role, selected scopes, and retention boundary before consent', async () => {
  const user = userEvent.setup();
  renderRoute(
    <AiConnections />,
    `/ai-connections?client_id=${client.id}&redirect_uri=${encodeURIComponent('http://localhost:6274/oauth/callback')}&code_challenge=${'a'.repeat(43)}&state=${'b'.repeat(16)}`,
  );
  expect((await screen.findAllByText(client.name)).length).toBe(2);
  expect(screen.getByText(/Role for this connection:/)).toHaveTextContent('user');
  expect(screen.getByText(/cannot control that client's retention/i)).toBeVisible();
  expect(screen.getByRole('checkbox', { name: 'Profile summary' })).toBeChecked();
  await user.click(screen.getByRole('checkbox', { name: 'Cart and checkout previews' }));
  expect(screen.getByRole('checkbox', { name: 'Cart and checkout previews' })).not.toBeChecked();
});

it('keeps the password in the first-party POST and never displays it', async () => {
  const user = userEvent.setup();
  renderRoute(
    <AiConnections />,
    `/ai-connections?client_id=${client.id}&redirect_uri=${encodeURIComponent('http://localhost:6274/oauth/callback')}&code_challenge=${'a'.repeat(43)}&state=${'b'.repeat(16)}`,
  );
  await user.type(await screen.findByLabelText('Current ShopSphere password'), 'private-password');
  await user.click(screen.getByRole('button', { name: 'Continue to secure consent' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Consent service unavailable');
  const post = vi.mocked(authFetch).mock.calls.find(([, init]) => init?.method === 'POST');
  expect(post).toBeDefined();
  expect(JSON.parse(post![1]!.body as string)).toMatchObject({ currentPassword: 'private-password', clientId: client.id });
  expect(screen.queryByText('private-password')).not.toBeInTheDocument();
});

it('revokes only the selected owned connection and updates immediately', async () => {
  const user = userEvent.setup();
  renderRoute(<AiConnections />, '/ai-connections');
  expect(await screen.findByText(client.name)).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Revoke' }));
  expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
  expect(authFetch).toHaveBeenCalledWith(expect.stringContaining(`/ai-connections/${client.id}`), { method: 'DELETE' });
});

it('keeps the connection visible when the server denies revocation ownership', async () => {
  vi.mocked(authFetch).mockImplementation(async (input, init) => {
    const url = String(input);
    if (init?.method === 'DELETE') return json({ message: 'Connection not found' }, 404);
    if (url.endsWith('/catalog')) return json({ clients: [client] });
    return json({ connections: [connection] });
  });
  const user = userEvent.setup();
  renderRoute(<AiConnections />, '/ai-connections');
  await user.click(await screen.findByRole('button', { name: 'Revoke' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not revoke this connection');
  expect(screen.getByRole('button', { name: 'Revoke' })).toBeVisible();
});
