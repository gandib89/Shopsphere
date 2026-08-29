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

authRouter.post('/register', credentialsLimiter, register);
authRouter.post('/login', credentialsLimiter, login);
authRouter.post('/refresh', credentialsLimiter, refresh);
authRouter.post('/logout', logout);
authRouter.post('/google-signin', credentialsLimiter, googleSignIn);
authRouter.post('/forgot-password', credentialsLimiter, forgotPassword);
authRouter.post('/reset-password', credentialsLimiter, resetPassword);

authRouter.get('/getUser', authenticate, authorizeAdmin, getAllUsers);
authRouter.get('/me', authenticate, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) {
      return res.status(404).json({ code: "not_found", message: "User not found" });
    }
    const { password, ...userWithoutPassword } = user;
    res.json(userWithoutPassword);
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
