import express from "express";
import { verifyToken, authorizeSeller, authorizeAdmin } from "../middlewares/authMiddleware.js";
import {
  createRevenueRecord,
  getAdminMonthlyRevenue,
  getAdminTotalRevenue,
  getSellerMonthlyRevenue,
  getSellerTotalRevenue
} from "../controller/revenueController.js";

const revenueRouter = express.Router();

// Admin routes
revenueRouter.post("/create", verifyToken, authorizeAdmin, createRevenueRecord);
revenueRouter.get("/admin/monthly", verifyToken, authorizeAdmin, getAdminMonthlyRevenue);
revenueRouter.get("/admin/total", verifyToken, authorizeAdmin, getAdminTotalRevenue);

// Seller routes
revenueRouter.get("/seller/monthly", verifyToken, authorizeSeller, getSellerMonthlyRevenue);
revenueRouter.get("/seller/total", verifyToken, authorizeSeller, getSellerTotalRevenue);

export default revenueRouter;
