import { prisma } from '../database/prismaClient.js';
import { parsePagination } from '../utils/pagination.js';

// Explicit projections keep credentials and reset/refresh-token data out of admin profiles.
export const SELLER_FIELDS = {
  id: true, firstName: true, lastName: true, email: true, phone: true,
  shopName: true, shopDescription: true, role: true, isVerified: true,
  createdAt: true, verificationRequestDate: true, verificationApprovedDate: true,
  verificationRejectionReason: true,
};
const adminOnly = (req, res) => {
  if (req.user?.role === 'admin') return true;
  res.status(req.user ? 403 : 401).json({ message: 'Administrator access required.' });
  return false;
};
const pagination = query => parsePagination({ ...query, page: query?.page || '1', limit: query?.limit || '20' });
const publicSeller = row => Object.fromEntries(Object.keys(SELLER_FIELDS).map(key => [key, row[key]]));

export async function listAdminSellers(req, res, client = prisma) {
  if (!adminOnly(req, res)) return;
  const { page, pageSize, prismaArgs } = pagination(req.query);
  const q = typeof req.query?.q === 'string' ? req.query.q.trim().slice(0, 150) : '';
  const status = req.query?.status;
  const where = {
    role: 'seller',
    ...(status === 'verified' ? { isVerified: true } : status === 'unverified' ? { isVerified: false } : {}),
    ...(q ? { OR: ['firstName', 'lastName', 'email', 'shopName', 'phone'].map(field => ({ [field]: { contains: q, mode: 'insensitive' } })) } : {}),
  };
  try {
    const [items, total] = await Promise.all([
      client.user.findMany({ where, select: SELLER_FIELDS, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], ...prismaArgs }),
      client.user.count({ where }),
    ]);
    res.json({ items: items.map(publicSeller), total, page, pageSize });
  } catch {
    res.status(500).json({ message: 'Could not load sellers. Please try again.' });
  }
}

// Mirrors the name/date(/order|product) filters on the main All products and All orders
// admin screens, scoped to one seller's rows.
const sellerOrderBy = (view, sortParam, dirParam) => {
  const dir = dirParam === 'desc' ? 'desc' : 'asc';
  if (view === 'products') {
    if (sortParam === 'date') return [{ createdAt: dir }, { id: 'asc' }];
    return [{ name: dir }, { id: 'asc' }];
  }
  if (sortParam === 'name') return [{ firstName: dir }, { lastName: dir }, { id: 'asc' }];
  if (sortParam === 'product') return [{ product: { name: dir } }, { id: 'asc' }];
  return [{ createdAt: dirParam === 'asc' ? 'asc' : 'desc' }, { id: 'asc' }];
};

export async function getAdminSeller(req, res, client = prisma) {
  if (!adminOnly(req, res)) return;
  const id = req.params.sellerId;
  if (!/^[a-f\d]{24}$/i.test(id || '')) return res.status(404).json({ message: 'Seller not found.' });
  const view = req.query?.view === 'orders' ? 'orders' : 'products';
  const { page, pageSize, prismaArgs } = pagination(req.query);
  try {
    const seller = await client.user.findFirst({ where: { id, role: 'seller' }, select: SELLER_FIELDS });
    if (!seller) return res.status(404).json({ message: 'Seller not found.' });
    // These are orders FOR this seller's products, never the seller's personal purchases.
    const where = view === 'orders' ? { product: { sellerId: id } } : { sellerId: id };
    const model = view === 'orders' ? client.order : client.product;
    // Same shape as the main All orders screen (adminData.ts's AdminOrder) so the seller-scoped
    // view can reuse its table/preview/action rendering as-is.
    const select = view === 'orders'
      ? { id: true, firstName: true, lastName: true, email: true, quantity: true, totalPrice: true, status: true, createdAt: true, deliveryDate: true, color: true, variantColor: true, variantStorage: true, returnReason: true, returnImage: true, refundReleasedAt: true, product: { select: { name: true } } }
      : { id: true, name: true, category: true, price: true, quantity: true, images: true };
    const orderBy = sellerOrderBy(view, req.query?.sort, req.query?.dir);
    const [rows, total] = await Promise.all([
      model.findMany({ where, select, orderBy, ...prismaArgs }),
      model.count({ where }),
    ]);
    const items = rows.map(row => view === 'orders'
      ? { _id: row.id, firstName: row.firstName, lastName: row.lastName, email: row.email, quantity: row.quantity, totalPrice: Number(row.totalPrice), status: row.status, createdAt: row.createdAt, deliveryDate: row.deliveryDate, color: row.color, variants: { color: row.variantColor, storage: row.variantStorage }, returnReason: row.returnReason, returnImage: row.returnImage, refundReleasedAt: row.refundReleasedAt, product: row.product }
      : { ...row, price: Number(row.price) });
    res.json({ seller: publicSeller(seller), items, total, page, pageSize, view });
  } catch {
    res.status(500).json({ message: 'Could not load this seller. Please try again.' });
  }
}
