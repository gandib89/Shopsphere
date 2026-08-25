import mongoose from "mongoose";

const promoCodeSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
  },
  description: {
    type: String,
    required: true,
  },
  discountType: {
    type: String,
    enum: ["percentage", "fixed"],
    required: true,
  },
  discountValue: {
    type: Number,
    required: true,
    min: [0, "Discount value must be positive"],
  },
  minPurchase: {
    type: Number,
    default: 0,
    min: [0, "Minimum purchase must be positive"],
  },
  maxDiscount: {
    type: Number,
    default: null, // For percentage discounts, cap the maximum discount amount
  },
  usageLimit: {
    type: Number,
    default: null, // null means unlimited
    min: [1, "Usage limit must be at least 1"],
  },
  usedCount: {
    type: Number,
    default: 0,
  },
  usedBy: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  }],
  validFrom: {
    type: Date,
    required: true,
  },
  validUntil: {
    type: Date,
    required: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Index for faster lookups
promoCodeSchema.index({ code: 1, isActive: 1 });

export const PromoCode = mongoose.model("PromoCode", promoCodeSchema);
