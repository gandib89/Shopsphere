import { createAdminCustomer, createAdminSeller, deleteAdminSeller } from '../controller/accountManagement.js';
import express from "express";
import {
  getAllUsersAndSellers,
  getUsersByRole,
  updateUserDetails,
  deleteUser,
  sendMessageToUser,
  getUserStatistics,
} from "../controller/userManagement.js";
import { verifyToken } from "../middlewares/authMiddleware.js";
import { authorizeAdmin } from "../controller/auth.js";
import { listAdminSellers, getAdminSeller } from '../controller/adminSellers.js';

const userManagementRouter = express.Router();

// All routes require admin authentication
userManagementRouter.use(verifyToken, authorizeAdmin);

userManagementRouter.post('/sellers', (req, res) => createAdminSeller(req, res));
userManagementRouter.post('/customers', (req, res) => createAdminCustomer(req, res));
userManagementRouter.delete('/sellers/:sellerId', (req, res) => deleteAdminSeller(req, res));

// Seller directory and profiles, behind the same admin authorization.
userManagementRouter.get('/sellers', (req, res) => listAdminSellers(req, res));
userManagementRouter.get('/sellers/:sellerId', (req, res) => getAdminSeller(req, res));

// Get all users and sellers
userManagementRouter.get("/all", getAllUsersAndSellers);

// Get users by role
userManagementRouter.get("/role/:role", getUsersByRole);

// Get user statistics
userManagementRouter.get("/stats", getUserStatistics);

// Update user details
userManagementRouter.put("/:userId", updateUserDetails);

// Delete user
userManagementRouter.delete("/:userId", deleteUser);

// Send message to user
userManagementRouter.post("/:userId/send-message", sendMessageToUser);

export default userManagementRouter;
