import express from "express";
import multer from "multer";
import path from "path";
import crypto from "crypto";
import { isAuthenticated, verifyToken, authorizeSeller, authorizeAdmin, authorizeSellerOrAdmin } from "../middlewares/authMiddleware.js";
import {
  getAllOrder, 
  createOrder, 
  createBulkOrderFromCart,
  updateOrder, 
  deleteOrder,
  getOrder, 
  getOrderDetails,
  userUpdateOrder,
  userDeleteOrder,
  getSellerOrders,
  updateSellerOrderStatus,
  generateBill,
  getUserBills,
  sendOrderConfirmationEmail,
  confirmOrderAndDeductStock,
  cancelOrder,
  requestReturn,
  processReturn,
  releaseRefund,
  trackOrder
} from "../controller/order.js";

// Multer setup for return defect images
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/"); // Save images in the "uploads" folder
  },
  filename: (req, file, cb) => {
    const extensionByMime = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
    cb(null, `return-${crypto.randomUUID()}${extensionByMime[file.mimetype] || path.extname(file.originalname).toLowerCase()}`);
  },
});

const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      cb(null, true);
    } else {
      const error = new Error("Only image files (jpg, jpeg, png, webp) are allowed");
      error.statusCode = 400;
      cb(error);
    }
  }
});

const orderRouter = express.Router();

orderRouter.get("/getOrder", verifyToken, authorizeAdmin, getAllOrder);
orderRouter.get("/user/get", verifyToken, getOrder);
orderRouter.get("/details/:orderId", verifyToken, getOrderDetails);
orderRouter.post("/createOrder", verifyToken, createOrder);
orderRouter.post("/createBulkOrder", verifyToken, createBulkOrderFromCart);
orderRouter.put("/updateOrder/:id", verifyToken, authorizeAdmin, updateOrder);
orderRouter.delete("/deleteOrder/:id", verifyToken, authorizeAdmin, deleteOrder);
orderRouter.put("/user/update/:id", isAuthenticated, userUpdateOrder);
orderRouter.delete("/user/delete/:id", isAuthenticated, userDeleteOrder);

// Seller-specific routes
orderRouter.get("/seller/my-orders", verifyToken, authorizeSeller, getSellerOrders);
orderRouter.put("/seller/update-status/:orderId", verifyToken, authorizeSellerOrAdmin, updateSellerOrderStatus);

// Bill routes
orderRouter.get("/bill/:orderId", verifyToken, generateBill);
orderRouter.get("/user/bills", verifyToken, getUserBills);
orderRouter.post("/send-confirmation/:orderId", verifyToken, sendOrderConfirmationEmail);

// Confirm order and deduct stock after payment success
orderRouter.put("/confirm/:orderId", verifyToken, confirmOrderAndDeductStock);

// Cancel order (user) — restores stock, sets status Cancelled
orderRouter.put("/cancel/:orderId", verifyToken, cancelOrder);

// Request return (user) — only within 7 days of delivery
orderRouter.put("/return/:orderId", verifyToken, upload.single("returnImage"), requestReturn);

// Process return (admin/seller) — approve or reject
orderRouter.put("/admin/return/:orderId", verifyToken, authorizeAdmin, processReturn);
// allow sellers to approve/reject return requests for their own products
orderRouter.put("/seller/return/:orderId", verifyToken, authorizeSeller, processReturn);

// Release refund (admin) — after return is approved
orderRouter.put("/admin/refund/:orderId", verifyToken, authorizeAdmin, releaseRefund);

// Track order (user) — full timeline
orderRouter.get("/track/:orderId", verifyToken, trackOrder);

export default orderRouter;
