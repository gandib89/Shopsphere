import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdminSeller, deleteAdminSeller, deleteMyAccount } from './accountManagement.js';
import { deleteAccount } from '../utils/deleteAccount.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { authenticate } from '../middlewares/authMiddleware.js';
import { signAccessToken } from '../utils/tokens.js';

const id = '66a100000000000000009999';
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, clearCookie() { this.cleared = true; } });
const input = { firstName: 'Test', lastName: 'Owner', email: 'Owner@Example.test', password: 'AccountTest!2026', shopName: 'Test shop' };

test('seller creation rejects non-admins and privilege injection', async () => {
  for (const role of [undefined, 'user', 'seller']) {
    const res = response();
    await createAdminSeller({ user: role ? { role } : undefined, body: input }, res, {});
    assert.equal(res.statusCode, role ? 403 : 401);
  }
  const res = response();
  await createAdminSeller({ user: { role: 'admin' }, body: { ...input, role: 'admin' } }, res, {});
  assert.equal(res.statusCode, 400);
});

test('seller creation normalizes email, hashes password, and never creates an admin session', async () => {
  const res = response();
  await createAdminSeller({ user: { role: 'admin' }, body: { ...input, isVerified: true } }, res, { user: { create: async ({ data, select }) => {
    assert.equal(data.email, 'owner@example.test');
    assert.equal(data.role, 'seller');
    assert.equal(data.isVerified, true);
    assert.ok(data.verificationApprovedDate);
    assert.equal(await verifyPassword(data.password, input.password), true);
    assert.equal(select.password, undefined);
    return { id: data.id, shopName: data.shopName };
  } } });
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.accessToken, undefined);
});

test('duplicate seller email is a recoverable conflict', async () => {
  const res = response();
  await createAdminSeller({ user: { role: 'admin' }, body: input }, res, { user: { create: async () => { throw { code: 'P2002' }; } } });
  assert.equal(res.statusCode, 409);
});

test('deletion requires confirmation and rejects deleting a different role', async () => {
  const res = response();
  await deleteAdminSeller({ user: { role: 'admin' }, params: { sellerId: id }, body: {} }, res, {});
  assert.equal(res.statusCode, 400);
  await assert.rejects(deleteAccount(id, 'seller', { $transaction: async fn => fn({ user: { findUnique: async () => ({ id, role: 'admin' }) } }) }), error => error.status === 404);
});

test('open orders prevent any deletion or archival writes', async () => {
  await assert.rejects(deleteAccount(id, 'seller', { $transaction: async fn => fn({
    user: { findUnique: async () => ({ id, role: 'seller', email: input.email }) },
    order: { count: async ({ where }) => { assert.ok(where.OR.some(item => item.product?.sellerId === id)); return 1; } },
  }) }), error => error.status === 409);
});

test('self deletion rejects incorrect password before cleanup', async () => {
  const password = await hashPassword(input.password);
  const res = response();
  await deleteMyAccount({ user: { id, role: 'user' }, body: { confirmation: 'DELETE', password: 'incorrect' } }, res, { user: { findUnique: async () => ({ id, role: 'user', password }) } });
  assert.equal(res.statusCode, 403);
  assert.equal(res.cleared, undefined);
});

test('Google deletion rejects a different Google identity', async () => {
  const before = process.env.GOOGLE_CLIENT_ID;
  process.env.GOOGLE_CLIENT_ID = 'test-client';
  try {
    const res = response();
    await deleteMyAccount({ user: { id, role: 'user' }, body: { confirmation: 'DELETE', googleToken: 'test-token' } }, res,
      { user: { findUnique: async () => ({ id, role: 'user', googleId: 'expected' }) } },
      { verifyIdToken: async () => ({ getPayload: () => ({ sub: 'someone-else', email_verified: true }) }) });
    assert.equal(res.statusCode, 403);
  } finally { if (before === undefined) delete process.env.GOOGLE_CLIENT_ID; else process.env.GOOGLE_CLIENT_ID = before; }
});

test('valid old JWT cannot authenticate a deleted account', async () => {
  const res = response(); let continued = false;
  await authenticate({ headers: { authorization: `Bearer ${signAccessToken({ id, role: 'seller' })}` } }, res, () => { continued = true; }, { user: { findUnique: async () => null } });
  assert.equal(res.statusCode, 401);
  assert.equal(continued, false);
});
