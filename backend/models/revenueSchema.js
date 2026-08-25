import mongoose from "mongoose";

const revenueSchema = new mongoose.Schema({
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Order",
    required: true,
  },
  sellerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Product",
    required: true,
  },
  totalSalePrice: {
    type: Number,
    required: true,
  },
  adminCommission: {
    type: Number,
    required: true,
    default: 0, // 5% of total price
  },
  sellerRevenue: {
    type: Number,
    required: true,
    default: 0, // Total price - admin commission
  },
  quantity: Number,
  transactionDate: { type: Date, default: Date.now },
  month: { type: Number }, // 0-11 (Jan = 0, Dec = 11)
  year: { type: Number },
  status: {
    type: String,
    enum: ["Pending", "Completed", "Refunded"],
    default: "Completed",
  },
});

// Index for quick queries by seller and month/year
revenueSchema.index({ sellerId: 1, year: 1, month: 1 });
// Index for quick queries by admin and month/year
revenueSchema.index({ adminId: 1, year: 1, month: 1 });

export const Revenue = mongoose.model("Revenue", revenueSchema);
