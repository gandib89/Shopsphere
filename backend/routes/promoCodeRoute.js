import express from "express";
import { verifyToken, authorizeAdmin } from "../middlewares/authMiddleware.js";
import {
  createPromoCode,
  validatePromoCode,
  applyPromoCode,
  getAllPromoCodes,
  togglePromoCodeStatus,
  deletePromoCode,
  notifyPromoCode,
  resetPromoForUser,
} from "../controller/promoCodeController.js";

const promoRouter = express.Router();

// Admin routes (requires authentication and admin role)
promoRouter.post("/create", verifyToken, authorizeAdmin, createPromoCode);
promoRouter.get("/all", verifyToken, authorizeAdmin, getAllPromoCodes);
promoRouter.put("/toggle/:id", verifyToken, authorizeAdmin, togglePromoCodeStatus);
promoRouter.delete("/delete/:id", verifyToken, authorizeAdmin, deletePromoCode);
promoRouter.post("/notify/:id", verifyToken, authorizeAdmin, notifyPromoCode);
promoRouter.post("/reset-user", verifyToken, authorizeAdmin, resetPromoForUser);

// Public/User routes
promoRouter.post("/validate", verifyToken, validatePromoCode);
promoRouter.post("/apply", verifyToken, applyPromoCode);

export default promoRouter;
