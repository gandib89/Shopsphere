import { z } from 'zod';
import { OAuth2Client } from 'google-auth-library';
import { prisma } from '../database/prismaClient.js';
import { generateId } from '../utils/generateId.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { AccountDeletionError, deleteAccount } from '../utils/deleteAccount.js';
import { SELLER_FIELDS } from './adminSellers.js';

const sellerSchema = z.object({
  firstName: z.string().trim().min(1).max(100), lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(254).transform(value => value.toLowerCase()),
  password: z.string().min(8).max(128), phone: z.string().trim().max(30).optional(),
  shopName: z.string().trim().min(1).max(150), shopDescription: z.string().trim().max(2000).optional(),
  isVerified: z.boolean().default(false),
}).strict();
const adminOnly = (req, res) => {
  if (req.user?.role === 'admin') return true;
  res.status(req.user ? 403 : 401).json({ message: 'Administrator access required.' });
  return false;
};
const failure = (res, error) => {
  if (error instanceof AccountDeletionError) return res.status(error.status).json({ message: error.message });
  if (['P2034', 'P2003'].includes(error?.code)) return res.status(409).json({ message: 'Account activity changed. Refresh and try again after open orders are resolved.' });
  return res.status(500).json({ message: 'Could not delete the account. Please try again.' });
};

export async function createAdminSeller(req, res, client = prisma) {
  if (!adminOnly(req, res)) return;
  const parsed = sellerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0].message });
  try {
    const data = parsed.data;
    const seller = await client.user.create({ data: {
      ...data, id: generateId(), role: 'seller', password: await hashPassword(data.password),
      verificationRequestDate: new Date(), verificationApprovedDate: data.isVerified ? new Date() : null,
    }, select: SELLER_FIELDS });
    res.status(201).json({ seller, message: 'Seller created.' });
  } catch (error) {
    res.status(error?.code === 'P2002' ? 409 : 500).json({ message: error?.code === 'P2002' ? 'An account already uses this email.' : 'Could not create the seller. Please try again.' });
  }
}

export async function deleteAdminSeller(req, res, client = prisma) {
  if (!adminOnly(req, res)) return;
  if (req.body?.confirmation !== 'DELETE') return res.status(400).json({ message: 'Type DELETE to confirm permanent deletion.' });
  if (!/^[a-f\d]{24}$/i.test(req.params.sellerId || '')) return res.status(404).json({ message: 'Seller not found.' });
  try {
    await deleteAccount(req.params.sellerId, 'seller', client);
    res.json({ message: 'Seller account permanently deleted.' });
  } catch (error) { return failure(res, error); }
}

export async function deleteMyAccount(req, res, client = prisma, google = new OAuth2Client(process.env.GOOGLE_CLIENT_ID)) {
  if (!req.user) return res.status(401).json({ message: 'Sign in to delete your account.' });
  if (!['user', 'seller'].includes(req.user.role)) return res.status(403).json({ message: 'Administrator accounts cannot be deleted here.' });
  if (req.body?.confirmation !== 'DELETE') return res.status(400).json({ message: 'Type DELETE to confirm permanent deletion.' });
  try {
    const user = await client.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ message: 'Account not found.' });
    let verified = false;
    if (user.password && typeof req.body.password === 'string' && req.body.password.length <= 128) {
      verified = await verifyPassword(user.password, req.body.password);
    } else if (user.googleId && typeof req.body.googleToken === 'string' && process.env.GOOGLE_CLIENT_ID) {
      try {
        const ticket = await google.verifyIdToken({ idToken: req.body.googleToken, audience: process.env.GOOGLE_CLIENT_ID });
        const payload = ticket.getPayload();
        verified = payload?.sub === user.googleId && payload?.email_verified === true;
      } catch { verified = false; }
    }
    if (!verified) return res.status(403).json({ message: 'Reauthentication failed. Use your current password or the Google account linked to this profile.' });
    await deleteAccount(user.id, user.role, client);
    res.clearCookie('refresh_token', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/api/v1/auth' });
    res.json({ message: 'Your account has been permanently deleted.' });
  } catch (error) { return failure(res, error); }
}
