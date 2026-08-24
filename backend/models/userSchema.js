import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    set: (value) => (value || "").trim().toLowerCase(),
  },
  phone: { type: String },
  password: { type: String },
  googleId: { type: String }, // For Google Sign-In
  role: { type: String, enum: ["user", "admin", "seller"], default: "user" },
  shopName: { type: String },
  shopDescription: { type: String },
  // Seller verification fields
  isVerified: { type: Boolean, default: false }, // Only for sellers
  verificationRequestDate: { type: Date },
  verificationApprovedDate: { type: Date },
  verificationRejectionReason: { type: String },
  createdAt: { type: Date, default: Date.now },
});

export const User = mongoose.model("User", userSchema);