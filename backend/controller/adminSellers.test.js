import assert from 'node:assert/strict';
import test from 'node:test';
import { getAdminSeller, listAdminSellers, SELLER_FIELDS } from './adminSellers.js';

const id = '66a100000000000000000001';
const seller = { id, firstName: 'Aarav', lastName: 'Shrestha', role: 'seller', email: 'test@example.test', isVerified: true };
const result = () => ({ statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const request = (query = {}) => ({ user: { role: 'admin' }, params: { sellerId: id }, query });

test('seller endpoints reject anonymous, customer, and seller access before querying', async () => {
  for (const handler of [listAdminSellers, getAdminSeller]) {
    for (const role of [undefined, 'user', 'seller']) {
      const res = result();
      await handler({ ...request(), user: role ? { role } : undefined }, res, {});
      assert.equal(res.statusCode, role ? 403 : 401);
    }
  }
});

test('directory scopes search to sellers, filters verification, and paginates', async () => {
  let args;
  const res = result();
  await listAdminSellers(request({ q: ' Tech ', status: 'verified', page: '2', limit: '20' }), res, {
    user: { findMany: async value => { args = value; return [seller]; }, count: async ({ where }) => { assert.equal(where.role, 'seller'); return 24; } },
  });
  assert.equal(args.where.role, 'seller');
  assert.equal(args.where.isVerified, true);
  assert.equal(args.where.OR[0].firstName.contains, 'Tech');
  assert.equal(args.skip, 20);
  assert.equal(args.take, 20);
  assert.equal(res.body.total, 24);
  assert.equal(res.body.page, 2);
});

test('profile rejects invalid IDs and non-seller accounts', async () => {
  const invalid = result();
  await getAdminSeller({ ...request(), params: { sellerId: '../users' } }, invalid, {});
  assert.equal(invalid.statusCode, 404);
  const missing = result();
  await getAdminSeller(request(), missing, { user: { findFirst: async ({ where }) => { assert.deepEqual(where, { id, role: 'seller' }); return null; } } });
  assert.equal(missing.statusCode, 404);
});

test('profile exposes only approved seller fields and scopes products by sellerId', async () => {
  let args;
  const res = result();
  await getAdminSeller(request(), res, {
    user: { findFirst: async ({ select }) => { assert.deepEqual(select, SELLER_FIELDS); return { ...seller, password: 'hidden', resetTokenHash: 'hidden', googleId: 'hidden' }; } },
    product: { findMany: async value => { args = value; return [{ id: 'product', price: '125.50' }]; }, count: async ({ where }) => { assert.deepEqual(where, { sellerId: id }); return 1; } },
  });
  assert.deepEqual(args.where, { sellerId: id });
  assert.equal(res.body.items[0].price, 125.5);
  assert.equal(res.body.seller.password, undefined);
  assert.equal(res.body.seller.resetTokenHash, undefined);
  assert.equal(res.body.seller.googleId, undefined);
});

test('orders belong to the seller products, not the seller customer account', async () => {
  let args;
  const res = result();
  await getAdminSeller(request({ view: 'orders', page: '2', limit: '2000' }), res, {
    user: { findFirst: async () => seller },
    order: { findMany: async value => { args = value; return [{ id: 'order', totalPrice: '500' }]; }, count: async ({ where }) => { assert.deepEqual(where, { product: { sellerId: id } }); return 300; } },
  });
  assert.deepEqual(args.where, { product: { sellerId: id } });
  assert.equal(args.where.userId, undefined);
  assert.equal(args.take, 200);
  assert.equal(args.skip, 200);
  assert.equal(res.body.items[0].totalPrice, 500);
  assert.equal(res.body.view, 'orders');
});

test('server errors do not leak database details', async () => {
  const res = result();
  await getAdminSeller(request(), res, { user: { findFirst: async () => { throw new Error('private connection string'); } } });
  assert.equal(res.statusCode, 500);
  assert.equal(JSON.stringify(res.body).includes('private'), false);
});
