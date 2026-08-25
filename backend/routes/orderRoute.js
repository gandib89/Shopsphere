import express from "express";
import multer from "multer";
import path from "path";
import { isAuthenticated, verifyToken, authorizeSeller } from "../middlewares/authMiddleware.js";
import { prisma } from "../database/prismaClient.js";
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
    cb(null, `return-${Date.now()}-${file.originalname}`);
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
      cb(new Error("Only image files (jpg, jpeg, png, webp) are allowed"));
    }
  }
});

const orderRouter = express.Router();

orderRouter.get("/getOrder", verifyToken, getAllOrder);
orderRouter.get("/user/get", verifyToken, getOrder);
// Diagnostic endpoint to debug order fetching
orderRouter.get("/user/debug/info", verifyToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const userEmail = user?.email;

    const allOrders = await prisma.order.findMany({
      where: { email: userEmail },
      select: { id: true, email: true, productId: true, firstName: true, lastName: true, totalPrice: true, createdAt: true, status: true },
    });

    res.status(200).json({
      userInfo: { id: req.user.id, email: userEmail },
      orderCount: allOrders.length,
      orders: allOrders,
      message: allOrders.length === 0 ? `No orders found for ${userEmail}` : `Found ${allOrders.length} orders`
    });
  } catch (error) {
    console.error("Debug error:", error);
    res.status(500).json({ error: error.message });
  }
});
orderRouter.get("/details/:orderId", verifyToken, getOrderDetails);
orderRouter.post("/createOrder", verifyToken, createOrder);
orderRouter.post("/createBulkOrder", verifyToken, createBulkOrderFromCart);
orderRouter.put("/updateOrder/:id", verifyToken, updateOrder);
orderRouter.delete("/deleteOrder/:id", verifyToken, deleteOrder);
orderRouter.put("/user/update/:id", isAuthenticated, userUpdateOrder);
orderRouter.delete("/user/delete/:id", isAuthenticated, userDeleteOrder);

// Seller-specific routes
orderRouter.get("/seller/my-orders", verifyToken, authorizeSeller, getSellerOrders);
orderRouter.put("/seller/update-status/:orderId", verifyToken, authorizeSeller, updateSellerOrderStatus);

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
orderRouter.put("/admin/return/:orderId", verifyToken, processReturn);
// allow sellers to approve/reject return requests for their own products
orderRouter.put("/seller/return/:orderId", verifyToken, authorizeSeller, processReturn);

// Release refund (admin) — after return is approved
orderRouter.put("/admin/refund/:orderId", verifyToken, releaseRefund);

// Track order (user) — full timeline
orderRouter.get("/track/:orderId", verifyToken, trackOrder);

export default orderRouter;
