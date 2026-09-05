import assert from 'node:assert/strict';
import test from 'node:test';
import { prisma } from '../database/prismaClient.js';
import { generateId } from './generateId.js';
import { deleteAccount } from './deleteAccount.js';
import { deleteMyAccount } from '../controller/accountManagement.js';
import { hashPassword } from './password.js';

test.after(() => prisma.$disconnect());

// Opt in against the migrated local database. Every test record is rolled back.
test('account deletion preserves counterparties and cleans every foreign key atomically', { skip: process.env.RUN_ACCOUNT_DB_TEST !== 'true' }, async () => {
  const rollback = new Error('rollback test fixtures');
  const password = 'DeleteAccountTest!2026';
  const hash = await hashPassword(password);
  await assert.rejects(prisma.$transaction(async tx => {
    const sellerId = generateId(), customerId = generateId(), productId = generateId(), orderId = generateId(), billId = generateId(), cartId = generateId();
    const customerEmail = `${customerId}@account-test.invalid`;
    await tx.user.create({ data: { id: sellerId, firstName: 'Test', lastName: 'Seller', email: `${sellerId}@account-test.invalid`, role: 'seller' } });
    await tx.user.create({ data: { id: customerId, firstName: 'Test', lastName: 'Customer', email: customerEmail, role: 'user', password: hash } });
    await tx.product.create({ data: { id: productId, name: 'Deletion test', price: 100, quantity: 2, category: 'Test', images: [], sellerId } });
    await tx.order.create({ data: { id: orderId, productId, userId: customerId, email: customerEmail, firstName: 'Test', lastName: 'Customer', quantity: 1, totalPrice: 100, deliveryDate: new Date(), status: 'Processing' } });
    const client = { user: tx.user, $transaction: fn => fn(tx) };
    await assert.rejects(deleteAccount(sellerId, 'seller', client), error => error.status === 409);
    assert.equal((await tx.product.findUnique({ where: { id: productId } })).isArchived, false);
    await tx.order.update({ where: { id: orderId }, data: { status: 'Delivered' } });
    await tx.bill.create({ data: { id: billId, orderId, userId: customerId, productId, billNumber: billId, email: customerEmail, firstName: 'Test' } });
    await tx.order.update({ where: { id: orderId }, data: { billId } });
    await tx.revenue.create({ data: { id: generateId(), orderId, sellerId, productId, totalSalePrice: 100 } });
    await tx.cart.create({ data: { id: cartId, userId: customerId, email: customerEmail, totalPrice: 100, items: { create: { productId, quantity: 1, price: 100 } } } });
    await tx.notification.create({ data: { id: generateId(), userId: customerId, title: 'Test', message: 'Test', type: 'Test' } });
    await tx.productReview.create({ data: { productId, userId: customerId, orderId, userName: 'Test', rating: 5, comment: 'Test' } });
    await tx.refreshToken.create({ data: { id: generateId(), userId: customerId, familyId: generateId(), tokenHash: generateId(), expiresAt: new Date(Date.now() + 60000) } });
    await deleteAccount(sellerId, 'seller', client);
    assert.equal(await tx.user.findUnique({ where: { id: sellerId } }), null);
    assert.equal((await tx.product.findUnique({ where: { id: productId } })).isArchived, true);
    assert.equal((await tx.revenue.findFirst({ where: { orderId } })).sellerId, null);
    assert.equal(Number((await tx.cart.findUnique({ where: { id: cartId } })).totalPrice), 0);
    assert.equal((await tx.order.findUnique({ where: { id: orderId } })).userId, customerId);
    const res = { statusCode: 200, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; }, clearCookie() { this.cleared = true; } };
    await deleteMyAccount({ user: { id: customerId, role: 'user' }, body: { password, confirmation: 'DELETE' } }, res, client);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.cleared, true);
    assert.equal(await tx.user.findUnique({ where: { id: customerId } }), null);
    assert.equal(await tx.refreshToken.count({ where: { userId: customerId } }), 0);
    assert.equal(await tx.productReview.count({ where: { userId: customerId } }), 0);
    const order = await tx.order.findUnique({ where: { id: orderId } });
    assert.equal(order.userId, null);
    assert.notEqual(order.email, customerEmail);
    assert.equal((await tx.bill.findUnique({ where: { id: billId } })).email, null);
    throw rollback;
  }, { timeout: 20000, isolationLevel: 'Serializable' }), error => error === rollback);
});
