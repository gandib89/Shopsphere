import express from "express";
import {signup, signin, getAllUsers, authorizeAdmin, getUnverifiedSellers, verifySeller, rejectSeller, googleSignIn, updatePassword} from "../controller/auth.js"
import { verifyToken } from "../middlewares/authMiddleware.js";
import { prisma } from "../database/prismaClient.js";


const authRouter = express.Router();

authRouter.post('/signup',signup);
authRouter.post('/signin',signin);
authRouter.post('/google-signin', googleSignIn);
authRouter.get('/getUser', verifyToken, authorizeAdmin, getAllUsers);
authRouter.get('/me', verifyToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    const { password, ...userWithoutPassword } = user;
    res.json(userWithoutPassword);
  } catch (error) {
    console.error("Error fetching user data:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Profile update route
authRouter.put('/profile', verifyToken, async (req, res) => {
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
    if (error.code === 'P2025') return res.status(404).json({ message: 'User not found' });
    console.error('Error updating profile:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Password update route
authRouter.put('/update-password', verifyToken, updatePassword);

// Seller verification routes (admin only)
authRouter.get('/unverified-sellers', verifyToken, authorizeAdmin, getUnverifiedSellers);
authRouter.put('/verify-seller/:sellerId', verifyToken, authorizeAdmin, verifySeller);
authRouter.put('/reject-seller/:sellerId', verifyToken, authorizeAdmin, rejectSeller);

export default authRouter;
















