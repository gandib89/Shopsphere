import express from "express";
import { verifyToken } from "../middlewares/authMiddleware.js";
import { checkout, esewaSuccessWebhook, esewaFailureWebhook } from "../controller/payment.js";

const paymentRouter = express.Router();

paymentRouter.post("/checkout", verifyToken, checkout);

// eSewa redirects the browser here after payment — gateway-initiated, no auth header to check.
paymentRouter.get("/esewa/success/:orderId", esewaSuccessWebhook);
paymentRouter.get("/esewa/failure/:orderId", esewaFailureWebhook);

export default paymentRouter;
