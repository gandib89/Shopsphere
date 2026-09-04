import assert from 'node:assert/strict';
import test from 'node:test';
import { hashPassword, verifyPassword } from './password.js';
import { repairSellerDemoAccount } from './repairSellerDemoAccount.js';

const env = { NODE_ENV: 'development', DATABASE_URL: 'postgresql://localhost/shopsphere', DEMO_PASSWORD: 'TestDemoPassword!2026' };
const id = '66a100000000000000000001';
async function fixture(overrides = {}, conflict = null) {
  const seller = { id, email: 'seller1@shopsphere', role: 'seller', shopName: 'Orbit Apple Store', isVerified: true, password: await hashPassword('OldDemoPassword!'), ...overrides };
  const writes = [];
  const client = {
    user: {
      findUnique: async ({ where }) => where.id ? seller : conflict || (seller.email === where.email ? seller : null),
      update: async ({ where, data }) => { assert.equal(where.id, id); writes.push(data); Object.assign(seller, data); return seller; },
    },
    refreshToken: { updateMany: async args => { writes.push(args); return { count: 1 }; } },
  };
  client.$transaction = async fn => fn(client);
  return { client, seller, writes };
}

test('repairs the exact legacy seller without changing ownership, role, or approval', async () => {
  const { client, seller, writes } = await fixture();
  const result = await repairSellerDemoAccount(client, env);
  assert.deepEqual(result, { email: 'seller1@shopsphere.test', changed: true, emailChanged: true, passwordReset: true });
  assert.equal(seller.id, id);
  assert.equal(seller.shopName, 'Orbit Apple Store');
  assert.equal(seller.role, 'seller');
  assert.equal(seller.isVerified, true);
  assert.equal(await verifyPassword(seller.password, env.DEMO_PASSWORD), true);
  assert.deepEqual(writes[1].where, { userId: id, revokedAt: null });
});

test('is idempotent and preserves a working password', async () => {
  const password = await hashPassword(env.DEMO_PASSWORD);
  const { client, writes, seller } = await fixture({ email: 'seller1@shopsphere.test', password });
  assert.equal((await repairSellerDemoAccount(client, env)).changed, false);
  assert.equal(seller.password, password);
  assert.equal(writes.length, 0);
});

test('rejects a non-demo identity and conflicting destination email', async () => {
  for (const [overrides, conflict] of [
    [{ email: 'real-seller@example.com' }, null],
    [{ role: 'admin' }, null],
    [{}, { id: 'another-id', email: 'seller1@shopsphere.test' }],
  ]) {
    const { client, writes } = await fixture(overrides, conflict);
    await assert.rejects(repairSellerDemoAccount(client, env), /no accounts changed/);
    assert.equal(writes.length, 0);
  }
});

test('rejects production, remote databases, and absent demo passwords before database access', async () => {
  for (const overrides of [{ NODE_ENV: 'production' }, { DATABASE_URL: 'postgresql://remote.example/shopsphere' }, { DEMO_PASSWORD: '' }]) {
    await assert.rejects(repairSellerDemoAccount({}, { ...env, ...overrides }));
  }
});
