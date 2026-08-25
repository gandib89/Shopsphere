import mongoose from "mongoose";
import validator from "validator";

const orderSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: true,
    minLength: [2, "First name must be at least 2 characters long"],
    maxLength: [30, "First name cannot exceed 30 characters"],
  },
  lastName: {
    type: String,
    required: true,
    minLength: [2, "Last name must be at least 2 characters long"],
    maxLength: [30, "Last name cannot exceed 30 characters"],
  },
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Product",
    required: true,
  },
  quantity: {
    type: Number,
    required: true,
    min: [1, "At least 1 item is required"],
    max: [100, "Maximum 100 items per order"],
  },
  deliveryDate: {
    type: Date,
    required: true,
  },
  email: {
      type: String,
      required: true,
      validate: [validator.isEmail, "Provide a valid email"],
    },
  // New delivery fields
  deliveryAddress: {
    street: String,
    city: String,
    state: String,
    zipCode: String,
    country: { type: String, default: "Nepal" },
  },
  totalPrice: {
    type: Number,
    required: true,
    min: [0, "Total price must be a positive number"],
  },
  adminCommission: {
    type: Number,
    default: 0, // 5% of total price
  },
  status: {
    type: String,
    enum: ["Pending", "Confirmed", "Processing", "Shipped", "Delivered", "Cancelled", "Return Requested", "Return Approved", "Return Rejected", "Refund Released"],
    default: "Pending",
  },
  deliveredAt: { type: Date },
  cancelledAt: { type: Date },
  returnRequestedAt: { type: Date },
  returnReason: { type: String },
  returnImage: { type: String }, // Path to defect image
  refundReleasedAt: { type: Date },
  variants: {
    storage: String,
    color: String,
    ram: String,
    screenSize: String,
    processor: String,
  },
  size: String,
  color: String,
  // Bill reference
  billId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Bill",
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  confirmationEmailSent: {
    type: Boolean,
    default: false,
  },
  // Human-readable order number
  orderNumber: {
    type: String,
    unique: true,
    sparse: true,
  },
  // Group ID to identify orders placed together in same checkout
  orderGroupId: {
    type: String,
    index: true,
  },
  // Promo code applied
  promoCode: {
    code: String,
    discountAmount: Number,
  },
  // Status timestamps for timeline tracking
  confirmedAt:  { type: Date },
  processingAt: { type: Date },
  shippedAt:    { type: Date },
  createdAt: { type: Date, default: Date.now },
});

// Indexes for faster queries
orderSchema.index({ email: 1 });  // Fast lookup by user email
orderSchema.index({ createdAt: -1 });  // For sorting by date
orderSchema.index({ email: 1, createdAt: -1 });  // Combined index for typical queries

export const Order = mongoose.model("Order", orderSchema);