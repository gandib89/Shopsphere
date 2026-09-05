import express from "express";
import multer from "multer";
import crypto from "crypto";
import path from "path";
import {
  createProduct,
  getProducts,
  getProductById,
  updateProduct,
  deleteProduct,
  searchProducts,
  uploadImage,
  getSellerProducts,
  getSellerProductById,
  updateSellerProduct,
  deleteSellerProduct,
  addProductReview,
  getProductReviews,
  getProductRecommendations,
  retrainProductRecommendations,
  setProductDiscount,
} from "../controller/productController.js";
import { verifyToken, authorizeSeller, checkSellerVerification, authorizeAdmin } from "../middlewares/authMiddleware.js";

const IMAGE_MIME_TO_EXTENSION = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, "uploads/"),
    filename: (_req, file, cb) => cb(null, `product-${crypto.randomUUID()}${IMAGE_MIME_TO_EXTENSION[file.mimetype] || path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 2 * 1024 * 1024, files: 3 },
  fileFilter: (_req, file, cb) => {
    if (IMAGE_MIME_TO_EXTENSION[file.mimetype]) return cb(null, true);
    const error = new Error("Only JPEG, PNG, and WebP images are allowed");
    error.statusCode = 400;
    return cb(error);
  },
});
const productRouter = express.Router();

// Public routes (no authentication required)
productRouter.get("/get", getProducts);
productRouter.get("/get/:id", getProductById);
productRouter.get("/search", searchProducts);
productRouter.post("/recommendations/retrain", verifyToken, authorizeAdmin, retrainProductRecommendations);
productRouter.get("/:productId/reviews", getProductReviews);
productRouter.get("/:productId/recommendations", getProductRecommendations);

// Protected routes (authentication required)
productRouter.post("/create", verifyToken, authorizeSeller, checkSellerVerification, createProduct);
// Admin-only catalog override (ProductDetailsAdmin.tsx) — not seller-scoped, so this must
// never be reachable with just authorizeSeller: any seller could edit/delete any other
// seller's product. Sellers manage their own catalog through the /seller/* routes below.
productRouter.put("/update/:id", verifyToken, authorizeAdmin, updateProduct);
productRouter.delete("/delete/:id", verifyToken, authorizeAdmin, deleteProduct);
productRouter.post("/uploadImage", verifyToken, authorizeSeller, checkSellerVerification, upload.array("images", 3), uploadImage);
productRouter.post("/:productId/reviews", verifyToken, addProductReview);

// Seller-specific routes
productRouter.get("/seller/my-products", verifyToken, authorizeSeller, getSellerProducts);
productRouter.get("/seller/product/:id", verifyToken, authorizeSeller, (req, res) => getSellerProductById(req, res));
productRouter.put("/seller/update/:id", verifyToken, authorizeSeller, checkSellerVerification, updateSellerProduct);
productRouter.delete("/seller/delete/:id", verifyToken, authorizeSeller, checkSellerVerification, deleteSellerProduct);
productRouter.put("/seller/discount/:productId", verifyToken, authorizeSeller, checkSellerVerification, setProductDiscount);

export default productRouter;
