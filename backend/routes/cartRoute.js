import express from "express";
import { isAuthenticated, verifyToken } from "../middlewares/authMiddleware.js";
import {
  addToCart,
  getCart,
  updateCartItem,
  removeFromCart,
  clearCart,
} from "../controller/cartController.js";

const cartRouter = express.Router();

cartRouter.post("/add", verifyToken, addToCart);
cartRouter.get("/get", verifyToken, getCart);
cartRouter.put("/update", verifyToken, updateCartItem);
cartRouter.delete("/remove/:productId", verifyToken, removeFromCart);
cartRouter.delete("/clear", verifyToken, clearCart);

export default cartRouter;
