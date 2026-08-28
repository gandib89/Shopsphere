import express from "express";
import rateLimit from "express-rate-limit";
import { verifyToken } from "../middlewares/authMiddleware.js";
import { checkout, esewaSuccessWebhook, esewaFailureWebhook } from "../controller/payment.js";

const paymentRouter = express.Router();

// Blunts checkout abuse/spam against the payment gateway.
const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

paymentRouter.post("/checkout", verifyToken, checkoutLimiter, checkout);

// eSewa redirects the browser here after payment — gateway-initiated, no auth header to check.
paymentRouter.get("/esewa/success/:orderId", esewaSuccessWebhook);
paymentRouter.get("/esewa/failure/:orderId", esewaFailureWebhook);

export default paymentRouter;
