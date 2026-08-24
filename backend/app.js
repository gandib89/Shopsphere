import express from "express";
import cors from "cors";
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import{ dbConnection } from "./database/dbConnection.js";
import { errorMiddleware } from "./middlewares/error.js";
import authRouter from "./routes/authRoute.js";
import productRouter from "./routes/productRoute.js";
import orderRouter from "./routes/orderRoute.js";
import cartRouter from "./routes/cartRoute.js";
import revenueRouter from "./routes/revenueRoute.js";
import userManagementRouter from "./routes/userManagementRoute.js";
import chatRouter from "./routes/chatRoute.js";
import notificationRouter from "./routes/notificationRoute.js";
import promoRouter from "./routes/promoCodeRoute.js";
import testEmailRouter from "./routes/testEmailRoute.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, 'config', 'config.env') });

const app = express();

app.use(
    cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (curl, etc.)
        if (!origin) return callback(null, true);
        // Allow Capacitor iOS/Android origins
        if (
            origin === 'capacitor://localhost' ||
            origin === 'http://localhost' ||
            origin === process.env.FRONTEND_URL ||
            /^http:\/\/localhost:\d+$/.test(origin) ||
            /^http:\/\/127\.0\.0\.1:\d+$/.test(origin) ||
            /^http:\/\/192\.168\./.test(origin) ||
            /^http:\/\/10\./.test(origin) ||
            /^http:\/\/172\./.test(origin)  // allow LAN + hotspot IPs
        ) {
            return callback(null, true);
        }
        return callback(new Error(`CORS blocked: ${origin}`));
    },
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
})
);

app.use(express.json());
app.use(express.urlencoded({extended: true }));
app.use('/api/v1/auth',authRouter);
app.use ('/api/v1/product',productRouter);
app.use('/api/v1/order', orderRouter);
app.use('/api/v1/cart', cartRouter);
app.use('/api/v1/revenue', revenueRouter);
app.use('/api/v1/users', userManagementRouter);
app.use('/api/v1/chat', chatRouter);
app.use('/api/v1/notifications', notificationRouter);
app.use('/api/v1/promo', promoRouter);
app.use('/api/v1/email', testEmailRouter);
app.use("/uploads", express.static(join(__dirname, "uploads")));

// eSewa payment redirect: eSewa redirects browser here, we redirect to frontend
app.get('/esewa-success/:orderId', (req, res) => {
  const { orderId } = req.params;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const userAgent = req.headers['user-agent'] || '';
  
  // Check if it's a mobile app (Capacitor) or web browser
  const isCapacitor = userAgent.includes('Capacitor') || req.headers['x-capacitor'];
  const redirectUrl = isCapacitor 
    ? `capacitor://localhost/#/success/${orderId}`
    : `${frontendUrl}/#/success/${orderId}`;
  
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Payment Successful</title></head><body><p>Payment successful! Redirecting back to app...</p><script>setTimeout(function(){ window.location.href = '${redirectUrl}'; }, 300);</script></body></html>`);
});

app.get('/esewa-failure/:orderId', (req, res) => {
  const { orderId } = req.params;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const userAgent = req.headers['user-agent'] || '';
  
  // Check if it's a mobile app (Capacitor) or web browser
  const isCapacitor = userAgent.includes('Capacitor') || req.headers['x-capacitor'];
  const redirectUrl = isCapacitor 
    ? `capacitor://localhost/#/failure/${orderId}`
    : `${frontendUrl}/#/failure/${orderId}`;
  
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Payment Failed</title></head><body><p>Payment failed. Redirecting back to app...</p><script>setTimeout(function(){ window.location.href = '${redirectUrl}'; }, 300);</script></body></html>`);
});

dbConnection();

app.use(errorMiddleware)

export default app;
