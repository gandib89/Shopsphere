import mongoose from "mongoose";

const billSchema = new mongoose.Schema({
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Order",
    required: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Product",
    required: true,
  },
  billNumber: {
    type: String,
    unique: true,
    required: true,
  },
  firstName: String,
  lastName: String,
  email: String,
  phone: String,
  productName: String,
  quantity: Number,
  unitPrice: Number,
  totalPrice: Number,
  adminCommission: Number,
  sellerRevenue: Number,
  deliveryAddress: {
    street: String,
    city: String,
    state: String,
    zipCode: String,
    country: String,
  },
  deliveryDate: Date,
  orderDate: { type: Date, default: Date.now },
  status: {
    type: String,
    enum: ["Generated", "Sent", "Viewed", "Printed"],
    default: "Generated",
  },
});

export const Bill = mongoose.model("Bill", billSchema);
