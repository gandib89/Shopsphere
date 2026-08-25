import express from "express";
import multer from "multer";
import {
  createProduct,
  getProducts,
  getProductById,
  updateProduct,
  deleteProduct,
  searchProducts,
  uploadImage,
  getSellerProducts,
  updateSellerProduct,
  deleteSellerProduct,
  addProductReview,
  getProductReviews,
  getProductRecommendations,
  retrainProductRecommendations,
  setProductDiscount,
} from "../controller/productController.js";
import { verifyToken, authorizeSeller, checkSellerVerification, authorizeAdmin } from "../middlewares/authMiddleware.js";

const upload = multer({ dest: "uploads/" });
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
productRouter.put("/update/:id", verifyToken, authorizeSeller, checkSellerVerification, updateProduct);
productRouter.delete("/delete/:id", verifyToken, authorizeSeller, checkSellerVerification, deleteProduct);
productRouter.post("/uploadImage", verifyToken, authorizeSeller, checkSellerVerification, upload.array("images", 3), uploadImage);
productRouter.post("/:productId/reviews", verifyToken, addProductReview);

// Seller-specific routes
productRouter.get("/seller/my-products", verifyToken, authorizeSeller, getSellerProducts);
productRouter.put("/seller/update/:id", verifyToken, authorizeSeller, checkSellerVerification, updateSellerProduct);
productRouter.delete("/seller/delete/:id", verifyToken, authorizeSeller, checkSellerVerification, deleteSellerProduct);
productRouter.put("/seller/discount/:productId", verifyToken, authorizeSeller, checkSellerVerification, setProductDiscount);

export default productRouter;
