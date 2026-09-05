import { deleteMyAccount } from '../controller/accountManagement.js';
import express from "express";
import rateLimit from "express-rate-limit";
import {
  register,
  login,
  refresh,
  logout,
  getAllUsers,
  authorizeAdmin,
  getUnverifiedSellers,
  verifySeller,
  rejectSeller,
  googleSignIn,
  updatePassword,
  forgotPassword,
  resetPassword,
} from "../controller/auth.js";
import { authenticate } from "../middlewares/authMiddleware.js";
import { prisma } from "../database/prismaClient.js";

const authRouter = express.Router();

// Blunts credential stuffing / brute force against register and login.
const credentialsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

// register/login/refresh/logout/resetPassword take an optional `client` param (defaults to
// prisma) so tests can inject a fake — but that default only applies when the argument is
// truly absent. Express always calls route handlers with (req, res, next), so registering
// them directly would bind `client` to `next` instead of letting the default fire. Wrapping
// each call here keeps it to the (req, res) arity the default param expects.
authRouter.post('/register', credentialsLimiter, (req, res) => register(req, res));
authRouter.post('/login', credentialsLimiter, (req, res) => login(req, res));
authRouter.post('/refresh', credentialsLimiter, (req, res) => refresh(req, res));
authRouter.post('/logout', (req, res) => logout(req, res));
authRouter.post('/google-signin', credentialsLimiter, googleSignIn);
authRouter.post('/forgot-password', credentialsLimiter, forgotPassword);
authRouter.post('/reset-password', credentialsLimiter, (req, res) => resetPassword(req, res));

authRouter.delete('/account', authenticate, credentialsLimiter, (req, res) => deleteMyAccount(req, res));

authRouter.get('/getUser', authenticate, authorizeAdmin, getAllUsers);
authRouter.get('/me', authenticate, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) {
      return res.status(404).json({ code: "not_found", message: "User not found" });
    }
    const { password, ...userWithoutPassword } = user;
    res.json({ ...userWithoutPassword, hasPassword: !!password });
  } catch (error) {
    res.status(500).json({ code: "internal_error", message: "Server error" });
  }
});

// Profile update route
authRouter.put('/profile', authenticate, async (req, res) => {
  try {
    const allowed = ['firstName', 'lastName', 'phone', 'shopName', 'shopDescription'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    const user = await prisma.user.update({ where: { id: req.user.id }, data: updates });
    const { password, ...userWithoutPassword } = user;
    res.json({ message: 'Profile updated successfully', user: userWithoutPassword });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ code: "not_found", message: 'User not found' });
    res.status(500).json({ code: "internal_error", message: 'Server error' });
  }
});

// Password update route
authRouter.put('/update-password', authenticate, credentialsLimiter, updatePassword);

// Seller verification routes (admin only)
authRouter.get('/unverified-sellers', authenticate, authorizeAdmin, getUnverifiedSellers);
authRouter.put('/verify-seller/:sellerId', authenticate, authorizeAdmin, verifySeller);
authRouter.put('/reject-seller/:sellerId', authenticate, authorizeAdmin, rejectSeller);

export default authRouter;
