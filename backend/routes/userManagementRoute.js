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

const userManagementRouter = express.Router();

// All routes require admin authentication
userManagementRouter.use(verifyToken, authorizeAdmin);

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
