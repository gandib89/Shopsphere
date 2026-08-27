import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { errorMiddleware } from "./middlewares/error.js";
import authRouter from "./routes/authRoute.js";
import productRouter from "./routes/productRoute.js";
import orderRouter from "./routes/orderRoute.js";
import paymentRouter from "./routes/paymentRoute.js";
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

// ponytail: hand-rolled instead of pulling in helmet for a handful of static headers.
app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (process.env.NODE_ENV === "production") {
        res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
    }
    next();
});

app.use(express.json());
app.use(express.urlencoded({extended: true }));
app.use(cookieParser());
app.use('/api/v1/auth',authRouter);
app.use ('/api/v1/product',productRouter);
app.use('/api/v1/order', orderRouter);
app.use('/api/v1/payment', paymentRouter);
app.use('/api/v1/cart', cartRouter);
app.use('/api/v1/revenue', revenueRouter);
app.use('/api/v1/users', userManagementRouter);
app.use('/api/v1/chat', chatRouter);
app.use('/api/v1/notifications', notificationRouter);
app.use('/api/v1/promo', promoRouter);
app.use('/api/v1/email', testEmailRouter);
app.use("/uploads", express.static(join(__dirname, "uploads")));

// eSewa redirects the browser here after payment. These used to redirect straight to the
// frontend with zero server-side verification (the frontend then trusted the redirect alone
// and deducted stock). Real verification now lives in paymentRouter's /esewa/success|failure
// routes; kept here only as aliases in case an old client build still points at these paths.
app.get('/esewa-success/:orderId', (req, res) => res.redirect(`/api/v1/payment/esewa/success/${req.params.orderId}?${new URLSearchParams(req.query).toString()}`));
app.get('/esewa-failure/:orderId', (req, res) => res.redirect(`/api/v1/payment/esewa/failure/${req.params.orderId}?${new URLSearchParams(req.query).toString()}`));

app.use(errorMiddleware)

export default app;
