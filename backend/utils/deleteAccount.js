import { prisma } from '../database/prismaClient.js';

export class AccountDeletionError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Keep commerce records usable for counterparties; remove the login and personal data.
// Serializable isolation prevents an order created concurrently from bypassing the guard.
export async function deleteAccount(id, role, client = prisma) {
  return client.$transaction(async tx => {
    const user = await tx.user.findUnique({ where: { id } });
    if (!user || (role && user.role !== role)) throw new AccountDeletionError(404, 'Account not found.');
    if (!['user', 'seller'].includes(user.role)) throw new AccountDeletionError(403, 'Administrator accounts cannot be deleted here.');
    const ownedOrders = { OR: [{ userId: id }, { email: user.email }] };
    const relatedOrders = { OR: [...ownedOrders.OR, { product: { sellerId: id } }] };
    const open = await tx.order.count({ where: { ...relatedOrders, status: { notIn: ['Delivered', 'Cancelled', 'Return Rejected', 'Refund Released'] } } });
    if (open) throw new AccountDeletionError(409, 'Resolve unfinished orders and returns before deleting this account.');

    const affectedCarts = await tx.cart.findMany({ where: { items: { some: { product: { sellerId: id } } } }, select: { id: true } });
    await tx.cartItem.deleteMany({ where: { product: { sellerId: id } } });
    for (const cart of affectedCarts) {
      const items = await tx.cartItem.findMany({ where: { cartId: cart.id }, select: { price: true, quantity: true } });
      await tx.cart.update({ where: { id: cart.id }, data: { totalPrice: items.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0) } });
    }
    await tx.product.updateMany({ where: { sellerId: id }, data: { isArchived: true, quantity: 0, sellerId: null } });
    await tx.cart.deleteMany({ where: { userId: id } });
    await tx.notification.deleteMany({ where: { userId: id } });
    await tx.refreshToken.deleteMany({ where: { userId: id } });
    await tx.productReview.deleteMany({ where: { userId: id } });
    await tx.promoCodeUsage.deleteMany({ where: { userId: id } });
    await tx.order.updateMany({ where: ownedOrders, data: {
      userId: null, firstName: 'Deleted', lastName: 'account', email: `deleted-${id}@account.invalid`,
      deliveryStreet: null, deliveryCity: null, deliveryState: null, deliveryZipCode: null,
      deliveryCountry: null, returnReason: null, returnImage: null,
    } });
    await tx.bill.updateMany({ where: { OR: [{ userId: id }, { email: user.email }] }, data: {
      userId: null, firstName: null, lastName: null, email: null, phone: null,
      deliveryStreet: null, deliveryCity: null, deliveryState: null, deliveryZipCode: null, deliveryCountry: null,
    } });
    await tx.revenue.updateMany({ where: { sellerId: id }, data: { sellerId: null } });
    await tx.user.delete({ where: { id } });
  }, { isolationLevel: 'Serializable' });
}
