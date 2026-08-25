import mongoose from "mongoose";

const reviewSchema = new mongoose.Schema({
  userName: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  quantity: { type: Number, required: true },
  description: { type: String },
  images: { type: [String], required: true },
  category: { type: String, required: true },
  variants: {
    storage: { type: [String], default: [] },
    color: { type: [String], default: [] },
    ram: { type: [String], default: [] },
    screenSize: { type: [String], default: [] },
    processor: { type: [String], default: [] },
  },
  // Enhanced variant tracking
  colorVariants: [{
    color: { type: String },
    images: { type: [String], default: [] },
    stock: { type: Number, default: 0 },
  }],
  storageVariants: [{
    storage: { type: String },
    stock: { type: Number, default: 0 },
  }],
  reviews: [reviewSchema],
  sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  discount: { type: Number, default: 0, min: 0, max: 100 }, // Percentage discount
  discountUpdatedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
});

export const Product = mongoose.model("Product", productSchema);
