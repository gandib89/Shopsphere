import { z } from "zod";
import { prisma } from "../database/prismaClient.js";
import { generateId } from "../utils/generateId.js";
import { sendEmail } from "../utils/emailService.js";
import crypto from "crypto";

const deliveryAddressSchema = z.object({
  street: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zipCode: z.string().optional(),
  country: z.string().optional(),
}).optional();

const variantsSchema = z.object({
  storage: z.string().optional(),
  color: z.string().optional(),
  ram: z.string().optional(),
  screenSize: z.string().optional(),
  processor: z.string().optional(),
}).optional();

const promoCodeSchema = z.object({
  code: z.string(),
  discountAmount: z.number().nonnegative(),
}).optional();

const createOrderSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  product: z.string().min(1),
  quantity: z.coerce.number().int().positive(),
  deliveryDate: z.string().min(1),
  deliveryAddress: deliveryAddressSchema,
  size: z.string().optional(),
  color: z.string().optional(),
  variants: variantsSchema,
  promoCode: promoCodeSchema,
});

const createBulkOrderSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  deliveryDate: z.string().min(1),
  deliveryAddress: deliveryAddressSchema,
  cartItems: z.array(z.object({
    productId: z.string().min(1),
    quantity: z.coerce.number().int().positive(),
    variants: variantsSchema,
    color: z.string().optional(),
    size: z.string().optional(),
  })).min(1),
  promoCode: promoCodeSchema,
});

// ─── Branded email wrapper matching ShopSphere purple theme ───────────────────
const shopSphereEmail = (title, body, { accentColor = '#7c3aed', icon = '' } = {}) => `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(124,58,237,0.10);">
  <div style="background:linear-gradient(135deg,${accentColor},${accentColor}dd);padding:28px 32px;text-align:center;">
    <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">${icon ? icon + ' ' : ''}${title}</h1>
  </div>
  <div style="padding:28px 32px;color:#374151;line-height:1.7;font-size:15px;">
    ${body}
  </div>
  <div style="background:#f9fafb;padding:20px 32px;text-align:center;border-top:1px solid #e5e7eb;">
    <p style="margin:0;color:#9ca3af;font-size:12px;">Thank you for shopping with <strong style="color:${accentColor};">ShopSphere</strong></p>
    <p style="margin:6px 0 0;color:#d1d5db;font-size:11px;">This is an automated email. Please do not reply.</p>
  </div>
</div>
`;

// Detail row helper
const emailRow = (label, value, highlight = false) => `
<tr>
  <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;color:#6b7280;font-weight:600;width:40%;">${label}</td>
  <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;${highlight ? 'color:#7c3aed;font-weight:700;font-size:17px;' : 'color:#1f2937;'}">${value}</td>
</tr>`;

const emailTable = (rows) => `<table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f9fafb;border-radius:8px;overflow:hidden;">${rows}</table>`;

// The old Mongo Order doc nested deliveryAddress/variants/promoCode as embedded objects;
// the new schema flattens them into scalar columns. Reconstruct the old nested shape here
// so every response keeps the exact JSON shape the frontend already expects.
const withNestedOrderShape = (order) => {
  if (!order) return order;
  const {
    deliveryStreet, deliveryCity, deliveryState, deliveryZipCode, deliveryCountry,
    variantStorage, variantColor, variantRam, variantScreenSize, variantProcessor,
    promoCode, promoDiscountAmount,
    ...rest
  } = order;
  return {
    ...rest,
    deliveryAddress: {
      street: deliveryStreet,
      city: deliveryCity,
      state: deliveryState,
      zipCode: deliveryZipCode,
      country: deliveryCountry,
    },
    variants: {
      storage: variantStorage,
      color: variantColor,
      ram: variantRam,
      screenSize: variantScreenSize,
      processor: variantProcessor,
    },
    promoCode: promoCode ? { code: promoCode, discountAmount: promoDiscountAmount } : undefined,
  };
};

// Restores (sign=1) or deducts (sign=-1) stock across the product's base quantity plus its
// selected color/storage variant rows. `client` defaults to the plain prisma client but callers
// that need this atomic with an order-status change (confirm/cancel/delete) pass a `tx` from
// prisma.$transaction so a mid-sequence failure can't leave stock adjusted but the order stale.
const adjustStock = async (productId, quantity, selectedColor, selectedStorage, sign, client = prisma) => {
  const productDetails = await client.product.findUnique({
    where: { id: productId },
    include: { colorVariants: true, storageVariants: true },
  });
  if (!productDetails) return null;

  const delta = sign * quantity;
  await client.product.update({ where: { id: productId }, data: { quantity: { increment: delta } } });

  if (selectedColor && productDetails.colorVariants.length > 0) {
    await client.productColorVariant.updateMany({
      where: { productId, color: selectedColor },
      data: { stock: { increment: delta } },
    });
  }
  if (selectedStorage && productDetails.storageVariants.length > 0) {
    await client.productStorageVariant.updateMany({
      where: { productId, storage: selectedStorage },
      data: { stock: { increment: delta } },
    });
  }

  return client.product.findUnique({ where: { id: productId } });
};

// Mirrors Mongoose's Revenue.findOneAndUpdate({ orderId }, data) — updates only the first
// matching revenue row (there's no unique constraint on orderId in the new schema either).
const updateFirstRevenueByOrder = async (orderId, data, client = prisma) => {
  const revenue = await client.revenue.findFirst({ where: { orderId } });
  if (!revenue) return null;
  return client.revenue.update({ where: { id: revenue.id }, data });
};

export const getAllOrder = async (req, res) => {
  try {
    const orders = await prisma.order.findMany({
      include: {
        product: {
          select: {
            name: true,
            price: true,
            sellerId: true,
            seller: { select: { firstName: true, lastName: true, shopName: true, email: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      // ponytail: hard cap instead of real pagination — the frontend consumes this as a bare
      // array, so paginating for real means changing the response shape and every caller.
      // Upgrade path: add page/limit query params once the admin orders UI can page through them.
      take: 1000,
    });
    res.status(200).json(orders.map(withNestedOrderShape));
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({ message: "Server error while fetching orders" });
  }
};

export const getOrder = async (req, res) => {
  try {
    const id = req.user.id;
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    console.log("👤 User found:", { userId: user.id, email: user.email });

    // Include product with nested seller info
    const orders = await prisma.order.findMany({
      where: { email: user.email },
      include: {
        product: {
          include: {
            seller: { select: { firstName: true, lastName: true, shopName: true, email: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    console.log(`✅ Successfully fetched ${orders.length} orders with full seller details`);
    res.status(200).json(orders.map(withNestedOrderShape));
  } catch (error) {
    console.error("❌ Error fetching orders:", error);
    res.status(500).json({ message: "Server error while fetching order", error: error.message });
  }
};

// Get detailed order information including seller details for receipt
export const getOrderDetails = async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        product: {
          select: {
            name: true,
            price: true,
            images: true,
            category: true,
            colorVariants: true,
            sellerId: true,
            seller: {
              select: { firstName: true, lastName: true, email: true, shopName: true, shopDescription: true, phone: true },
            },
          },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    res.status(200).json(withNestedOrderShape(order));
  } catch (error) {
    console.error("Error fetching order details:", error);
    res.status(500).json({ message: "Server error while fetching order details" });
  }
};

export const createOrder = async (req, res) => {
  const parsed = createOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues[0].message });
  }
  const {
    firstName,
    lastName,
    email,
    phone,
    product,
    quantity,
    deliveryDate,
    deliveryAddress,
    size,
    color,
    variants,
    promoCode,
  } = parsed.data;

  try {
    // Fetch product details
    const productDetails = await prisma.product.findUnique({
      where: { id: product },
      include: { colorVariants: true, storageVariants: true },
    });
    if (!productDetails) {
      return res.status(404).json({ message: "Product not found" });
    }

    // Resolve selected variants from payload
    const selectedColor = color || (variants && variants.color) || null;
    const selectedStorage = (variants && variants.storage) || null;

    // Validate stock based on selected color and storage variants
    let availableStock = productDetails.quantity;

    // If color is selected, check color variant stock
    if (selectedColor && productDetails.colorVariants && productDetails.colorVariants.length > 0) {
      const colorVariant = productDetails.colorVariants.find(cv => cv.color === selectedColor);
      if (!colorVariant) {
        return res.status(400).json({ message: "Selected color not found" });
      }
      availableStock = Math.min(availableStock, colorVariant.stock);
      console.log(`Color "${selectedColor}" stock: ${colorVariant.stock}`);
    }

    // If storage is selected, check storage variant stock
    if (selectedStorage && productDetails.storageVariants && productDetails.storageVariants.length > 0) {
      const storageVariant = productDetails.storageVariants.find(sv => sv.storage === selectedStorage);
      if (!storageVariant) {
        return res.status(400).json({ message: "Selected storage not found" });
      }
      availableStock = Math.min(availableStock, storageVariant.stock);
      console.log(`Storage "${selectedStorage}" stock: ${storageVariant.stock}`);
    }

    // Check if product is in stock
    if (availableStock <= 0) {
      return res
        .status(400)
        .json({ message: "Product out of stock" });
    }

    // Check if requested quantity is available
    if (quantity > availableStock) {
      return res
        .status(400)
        .json({ message: `Only ${availableStock} units available` });
    }

    // Calculate total price
    let totalPrice = quantity * productDetails.price;

    // Apply promo code discount if provided
    let promoCodeStr = null;
    let promoDiscountAmount = null;
    if (promoCode && promoCode.code && promoCode.discountAmount) {
      totalPrice = Math.max(0, totalPrice - promoCode.discountAmount);
      promoCodeStr = promoCode.code;
      promoDiscountAmount = promoCode.discountAmount;
    }

    // Calculate 5% admin commission on final price
    const adminCommission = totalPrice * 0.05;

    // Get user ID from token
    const userId = req.user?.id;

    // Create order with delivery address
    // Note: `phone` is intentionally NOT persisted — Order has no phone column (matches the
    // old Mongoose schema, which never declared it either and silently dropped it on save).
    const order = await prisma.order.create({
      data: {
        id: generateId(),
        firstName,
        lastName,
        email,
        productId: product,
        quantity,
        deliveryDate: new Date(deliveryDate),
        deliveryStreet: deliveryAddress?.street,
        deliveryCity: deliveryAddress?.city,
        deliveryState: deliveryAddress?.state,
        deliveryZipCode: deliveryAddress?.zipCode,
        deliveryCountry: deliveryAddress?.country,
        totalPrice,
        adminCommission,
        userId,
        size,
        color,
        variantStorage: variants?.storage,
        variantColor: variants?.color,
        variantRam: variants?.ram,
        variantScreenSize: variants?.screenSize,
        variantProcessor: variants?.processor,
        promoCode: promoCodeStr,
        promoDiscountAmount,
        createdAt: new Date(),
      },
    });

    // Stock will be deducted AFTER payment confirmation, not immediately
    // This prevents stock reduction if payment is cancelled

    // Email will be sent after payment success from the Success page
    // This ensures email is sent only after payment confirmation

    // Create revenue record automatically
    try {
      const now = new Date();
      const month = now.getMonth() + 1;
      const year = now.getFullYear();

      await prisma.revenue.create({
        data: {
          id: generateId(),
          orderId: order.id,
          sellerId: productDetails.sellerId,
          adminId: null,
          productId: product,
          totalSalePrice: totalPrice,
          adminCommission: adminCommission,
          sellerRevenue: totalPrice * 0.95,
          transactionDate: new Date(),
          month,
          year,
          status: "Pending",
        },
      });

      console.log("Revenue record created for order:", order.id);
    } catch (revenueError) {
      console.error("Error creating revenue record:", revenueError);
      // Don't fail the order if revenue record fails
    }

    // Assign human-readable order number
    try {
      const orderNumber = generateOrderNumber(order.id, order.createdAt);
      await prisma.order.update({ where: { id: order.id }, data: { orderNumber } });
      order.orderNumber = orderNumber;
    } catch (numErr) {
      console.error("Order number generation error (non-fatal):", numErr);
    }

    res.status(201).json({ success: true, order: withNestedOrderShape(order) });
  } catch (error) {
    console.error("Error creating order:", error);
    res.status(500).json({ message: "Server error while creating order" });
  }
};

// Create multiple orders from cart items (all items purchased together)
export const createBulkOrderFromCart = async (req, res) => {
  const parsed = createBulkOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues[0].message });
  }
  const {
    firstName,
    lastName,
    email,
    phone,
    deliveryDate,
    deliveryAddress,
    cartItems, // Array of items: [{ productId, quantity, variants, color, size }]
    promoCode,
  } = parsed.data;

  try {
    const userId = req.user?.id;
    const orderGroupId = crypto.randomUUID(); // Unique ID for this checkout session
    const createdOrders = [];
    let totalAmount = 0;
    let totalBeforeDiscount = 0;

    // Create order for each cart item
    for (const item of cartItems) {
      const productDetails = await prisma.product.findUnique({
        where: { id: item.productId },
        include: { colorVariants: true, storageVariants: true },
      });
      if (!productDetails) {
        console.error(`Product not found: ${item.productId}`);
        continue; // Skip invalid products
      }

      // Validate stock
      const selectedColor = item.color || (item.variants && item.variants.color) || null;
      const selectedStorage = (item.variants && item.variants.storage) || null;
      let availableStock = productDetails.quantity;

      if (selectedColor && productDetails.colorVariants && productDetails.colorVariants.length > 0) {
        const colorVariant = productDetails.colorVariants.find(cv => cv.color === selectedColor);
        if (colorVariant) {
          availableStock = Math.min(availableStock, colorVariant.stock);
        }
      }

      if (selectedStorage && productDetails.storageVariants && productDetails.storageVariants.length > 0) {
        const storageVariant = productDetails.storageVariants.find(sv => sv.storage === selectedStorage);
        if (storageVariant) {
          availableStock = Math.min(availableStock, storageVariant.stock);
        }
      }

      if (availableStock < item.quantity) {
        return res.status(400).json({
          message: `Insufficient stock for ${productDetails.name}. Only ${availableStock} available.`
        });
      }

      // Calculate price
      const itemTotal = item.quantity * productDetails.price;
      totalBeforeDiscount += itemTotal;
      totalAmount += itemTotal;

      // Create order (promo discount will be applied to totalAmount after loop)
      const order = await prisma.order.create({
        data: {
          id: generateId(),
          firstName,
          lastName,
          email,
          productId: item.productId,
          quantity: item.quantity,
          deliveryDate: new Date(deliveryDate),
          deliveryStreet: deliveryAddress?.street,
          deliveryCity: deliveryAddress?.city,
          deliveryState: deliveryAddress?.state,
          deliveryZipCode: deliveryAddress?.zipCode,
          deliveryCountry: deliveryAddress?.country,
          totalPrice: itemTotal,
          adminCommission: itemTotal * 0.05,
          userId,
          size: item.size,
          color: item.color,
          variantStorage: item.variants?.storage,
          variantColor: item.variants?.color,
          variantRam: item.variants?.ram,
          variantScreenSize: item.variants?.screenSize,
          variantProcessor: item.variants?.processor,
          orderGroupId, // Same for all orders in this checkout
          createdAt: new Date(),
        },
      });

      // Assign order number
      try {
        const orderNumber = generateOrderNumber(order.id, order.createdAt);
        await prisma.order.update({ where: { id: order.id }, data: { orderNumber } });
        order.orderNumber = orderNumber;
      } catch (numErr) {
        console.error("Order number generation error:", numErr);
      }

      // Create revenue record
      try {
        const now = new Date();
        await prisma.revenue.create({
          data: {
            id: generateId(),
            orderId: order.id,
            sellerId: productDetails.sellerId,
            adminId: null,
            productId: item.productId,
            totalSalePrice: itemTotal,
            adminCommission: itemTotal * 0.05,
            sellerRevenue: itemTotal * 0.95,
            transactionDate: now,
            month: now.getMonth() + 1,
            year: now.getFullYear(),
            status: "Pending",
          },
        });
      } catch (revenueError) {
        console.error("Error creating revenue record:", revenueError);
      }

      createdOrders.push(order);
    }

    if (createdOrders.length === 0) {
      return res.status(400).json({ message: "No valid products in cart" });
    }

    // Apply promo code discount to total if provided
    let finalAmount = totalAmount;
    if (promoCode && promoCode.code && promoCode.discountAmount) {
      finalAmount = Math.max(0, totalAmount - promoCode.discountAmount);
      // Save promo code to the first order (primary order for payment)
      const updatedFirst = await prisma.order.update({
        where: { id: createdOrders[0].id },
        data: { promoCode: promoCode.code, promoDiscountAmount: promoCode.discountAmount },
      });
      createdOrders[0] = updatedFirst;
    }

    // Return first order for payment (all orders share same group)
    res.status(201).json({
      success: true,
      order: withNestedOrderShape(createdOrders[0]), // Primary order for payment
      orderGroupId,
      orderCount: createdOrders.length,
      totalAmount: finalAmount,
      originalAmount: totalBeforeDiscount,
      discountApplied: promoCode ? promoCode.discountAmount : 0
    });
  } catch (error) {
    console.error("Error creating bulk orders:", error);
    res.status(500).json({ message: "Server error while creating orders" });
  }
};

// Helper: generate readable order number like ORD-202602-A3F9B2
const generateOrderNumber = (id, date) => {
  const d = date || new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const suffix = id.slice(-6).toUpperCase();
  return `ORD-${year}${month}-${suffix}`;
};

export const updateOrder = async (req, res) => {
  const { id } = req.params;
  const {
    firstName,
    lastName,
    email,
    quantity,
    deliveryDate,
    status,
  } = req.body;

  try {
    // Find the order by ID
    let order = await prisma.order.findUnique({
      where: { id },
      include: { product: { select: { name: true, price: true } } },
    });
    console.log("Updating order:", order);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const productDetails = await prisma.product.findUnique({ where: { id: order.productId } });
    if (!productDetails) {
      return res.status(404).json({ message: "Product not found" });
    }

    const newQuantity = quantity || order.quantity;

    // Update the order fields, recalculating total price
    order = await prisma.order.update({
      where: { id },
      data: {
        firstName: firstName || order.firstName,
        lastName: lastName || order.lastName,
        email: email || order.email,
        quantity: newQuantity,
        deliveryDate: deliveryDate ? new Date(deliveryDate) : order.deliveryDate,
        status: status || order.status,
        totalPrice: newQuantity * productDetails.price,
      },
      include: { product: { select: { name: true, price: true } } },
    });

    const updatedOrder = order;

    console.log("Updated order:", updatedOrder);

    // Send update confirmation email
    const subject = `Order ${status} – ShopSphere`;
    const text = `Dear ${updatedOrder.firstName} ${updatedOrder.lastName},\n\nYour order has been ${status}.\n\nQuantity: ${updatedOrder.quantity}\nDelivery Date: ${new Date(updatedOrder.deliveryDate).toLocaleDateString()}\nTotal Price: Rs. ${updatedOrder.totalPrice}\n\nThank you for shopping with ShopSphere!`;
    const html = shopSphereEmail(`Order ${status}`, `
      <p>Dear <strong>${updatedOrder.firstName} ${updatedOrder.lastName}</strong>,</p>
      <p>Your order has been <strong>${status.toLowerCase()}</strong>. Here are the updated details:</p>
      ${emailTable(
        emailRow('Product', updatedOrder.product?.name || 'Product') +
        emailRow('Quantity', updatedOrder.quantity) +
        emailRow('Delivery Date', new Date(updatedOrder.deliveryDate).toLocaleDateString()) +
        emailRow('Total Price', 'Rs. ' + updatedOrder.totalPrice, true)
      )}
      <p style="margin-top:20px;color:#6b7280;">If you have any questions, please contact our support team.</p>
    `);

    sendEmail(updatedOrder.email, subject, text, html);

    res.status(200).json({ success: true, order: withNestedOrderShape(updatedOrder) });
  } catch (error) {
    console.error("Error updating order:", error);
    res.status(500).json({ message: "Server error while updating order" });
  }
};

export const deleteOrder = async (req, res) => {
  console.log("Deleting order with ID:", req.params.id);

  try {
    // Find the order to get the associated product ID
    const order = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!order) {
      console.error("Order not found");
      return res.status(404).json({ message: "Order not found" });
    }

    const productId = order.productId;

    // Delete the order
    await prisma.order.delete({ where: { id: req.params.id } });
    console.log("Order deleted successfully:", order);

    res.status(200).json({ message: "Order deleted successfully" });
  } catch (error) {
    console.error("Error deleting order:", error);
    res.status(500).json({ message: "Server error while deleting order" });
  }
};

export const userUpdateOrder = async (req, res) => {
  const { id } = req.params; // Order ID
  const { quantity, deliveryDate } = req.body; // Fields users can update

  try {
    // Fetch the logged-in user's details using req.user.id
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Use the user's email to find the order
    let order = await prisma.order.findFirst({
      where: { id, email: user.email },
      include: { product: { select: { name: true, price: true } } },
    });
    if (!order) {
      return res
        .status(404)
        .json({
          message:
            "Order not found or you are not authorized to update this order",
        });
    }

    // Update the order fields, recalculating the total price
    const newQuantity = quantity || order.quantity;
    order = await prisma.order.update({
      where: { id: order.id },
      data: {
        quantity: newQuantity,
        deliveryDate: deliveryDate ? new Date(deliveryDate) : order.deliveryDate,
        totalPrice: newQuantity * order.product.price,
      },
      include: { product: { select: { name: true, price: true } } },
    });

    // Send update confirmation email
    const subject = "Order Updated – ShopSphere";
    const text = `Dear ${order.firstName} ${order.lastName},\n\nYour order has been updated successfully.\n\nQuantity: ${order.quantity}\nDelivery Date: ${new Date(order.deliveryDate).toLocaleDateString()}\nTotal Price: Rs. ${order.totalPrice}\n\nThank you for shopping with ShopSphere!`;
    const html = shopSphereEmail('Order Updated ✏️', `
      <p>Dear <strong>${order.firstName} ${order.lastName}</strong>,</p>
      <p>Your order has been updated successfully. Here are the new details:</p>
      ${emailTable(
        emailRow('Product', order.product?.name || 'Product') +
        emailRow('Quantity', order.quantity) +
        emailRow('Delivery Date', new Date(order.deliveryDate).toLocaleDateString()) +
        emailRow('Total Price', 'Rs. ' + order.totalPrice, true)
      )}
      <p style="margin-top:20px;color:#6b7280;">If you didn't make this change, please contact our support team immediately.</p>
    `);

    console.log("Sending update confirmation email to:", order.email);
    sendEmail(order.email, subject, text, html);

    res.status(200).json({ success: true, order: withNestedOrderShape(order) });
  } catch (error) {
    console.error("Error updating order:", error);
    res.status(500).json({ message: "Server error while updating order" });
  }
};

export const userDeleteOrder = async (req, res) => {
  const { id } = req.params; // Order ID

  try {
    // Fetch the logged-in user's details using req.user.id
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Find the order by ID and ensure it belongs to the logged-in user
    const order = await prisma.order.findFirst({
      where: { id, email: user.email },
      include: { product: true },
    });
    if (!order) {
      return res
        .status(404)
        .json({
          message:
            "Order not found or you are not authorized to delete this order",
        });
    }

    // Restore stock (if applicable) and delete the order atomically — a failure partway
    // through must not leave stock restored with the order still present, or vice versa.
    const restoresStock = ['Confirmed', 'Processing', 'Shipped'].includes(order.status);
    await prisma.$transaction(async (tx) => {
      if (restoresStock) {
        await adjustStock(order.product.id, order.quantity, order.variantColor, order.variantStorage, 1, tx);
      }
      await tx.order.delete({ where: { id } });
    });
    if (restoresStock) {
      console.log(`✅ Stock restored on cancellation: ${order.quantity} units for order ${id}`);
    }

    // Send delete confirmation email
    const subject = "Order Cancelled – ShopSphere";
    const text = `Dear ${order.firstName} ${order.lastName},\n\nYour order has been successfully cancelled.\n\nQuantity: ${order.quantity}\nDelivery Date: ${new Date(order.deliveryDate).toLocaleDateString()}\n\nWe hope to serve you again soon!`;
    const html = shopSphereEmail('Order Cancelled', `
      <p>Dear <strong>${order.firstName} ${order.lastName}</strong>,</p>
      <p>Your order has been successfully cancelled.</p>
      ${emailTable(
        emailRow('Quantity', order.quantity) +
        emailRow('Delivery Date', new Date(order.deliveryDate).toLocaleDateString())
      )}
      <p style="margin-top:20px;">We hope to serve you again in the future! 💜</p>
    `, { accentColor: '#ef4444', icon: '❌' });

    console.log("Sending cancellation confirmation email to:", order.email);
    sendEmail(order.email, subject, text, html);

    res.status(200).json({ message: "Order deleted successfully" });
  } catch (error) {
    console.error("Error deleting order:", error);
    res.status(500).json({ message: "Server error while deleting order" });
  }
};

// Get all orders for a seller's products
export const getSellerOrders = async (req, res) => {
  try {
    const sellerId = req.user.id;

    // Find all products belonging to this seller
    const sellerProducts = await prisma.product.findMany({ where: { sellerId }, select: { id: true } });
    const productIds = sellerProducts.map(p => p.id);

    // Find all orders for these products
    const orders = await prisma.order.findMany({
      where: { productId: { in: productIds } },
      include: { product: { select: { name: true, price: true, category: true } } },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({
      message: "Seller orders retrieved successfully",
      orders: orders.map(withNestedOrderShape),
      count: orders.length
    });
  } catch (error) {
    console.error("Error fetching seller orders:", error);
    res.status(500).json({ message: "Server error while fetching seller orders" });
  }
};

// Update order status (seller can update status of orders for their products)
export const updateSellerOrderStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;
    const sellerId = req.user.id;

    // Find the order
    let order = await prisma.order.findUnique({ where: { id: orderId }, include: { product: true } });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Check if the seller owns the product in this order
    if (order.product.sellerId !== sellerId) {
      return res.status(403).json({ message: "You can only update orders for your own products" });
    }

    // Update status
    const validStatuses = ["Pending", "Processing", "Shipped", "Delivered", "Cancelled"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const data = { status };
    if (status === "Confirmed")   data.confirmedAt  = order.confirmedAt  || new Date();
    if (status === "Processing")  data.processingAt = order.processingAt || new Date();
    if (status === "Shipped")     data.shippedAt    = order.shippedAt    || new Date();
    if (status === "Delivered")   data.deliveredAt  = order.deliveredAt  || new Date();

    order = await prisma.order.update({ where: { id: orderId }, data, include: { product: true } });

    // Send email notification to customer
    const statusColorMap = { Pending: '#f59e0b', Confirmed: '#3b82f6', Processing: '#8b5cf6', Shipped: '#6366f1', Delivered: '#22c55e' };
    const statusAccent = statusColorMap[status] || '#7c3aed';
    const statusIconMap = { Pending: '⏳', Confirmed: '✅', Processing: '⚙️', Shipped: '🚚', Delivered: '📦' };
    const statusIcon = statusIconMap[status] || '📋';
    const subject = `Order ${status} – ShopSphere`;
    const html = shopSphereEmail(`Order ${status}`, `
      <p>Hi <strong>${order.firstName}</strong>,</p>
      <p>Your order status has been updated:</p>
      <div style="text-align:center;margin:24px 0;">
        <span style="display:inline-block;background:${statusAccent}15;color:${statusAccent};border:2px solid ${statusAccent};padding:10px 28px;border-radius:50px;font-weight:700;font-size:16px;">${statusIcon} ${status}</span>
      </div>
      ${emailTable(
        emailRow('Order ID', order.id.slice(-8).toUpperCase()) +
        emailRow('Product', order.product?.name || 'Product') +
        emailRow('Quantity', order.quantity)
      )}
      <p style="margin-top:20px;color:#6b7280;">You can track your order anytime from your <strong>My Orders</strong> page.</p>
    `, { accentColor: statusAccent, icon: statusIcon });

    sendEmail(order.email, subject, `Order status updated to ${status}`, html);

    res.status(200).json({
      message: "Order status updated successfully",
      order: withNestedOrderShape(order)
    });
  } catch (error) {
    console.error("Error updating seller order status:", error);
    res.status(500).json({ message: "Server error while updating order" });
  }
};

// Generate bill for an order
// NOTE: Bill is built and returned in-memory only — the old code never called Bill.create()
// (the Mongo Bill collection was effectively unused), so this doesn't touch prisma.bill either.
export const generateBill = async (req, res) => {
  try {
    const { orderId } = req.params;

    // Find the order
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        product: { select: { id: true, name: true, price: true } },
        user: { select: { id: true, email: true, phone: true } },
      },
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Deterministic (not Date.now()-based) so re-requesting the same order's bill is
    // idempotent — upsert below returns the same persisted row instead of erroring on
    // the unique billNumber constraint or silently minting an unpersisted duplicate.
    const billNumber = `BILL-${orderId}`;

    const persisted = await prisma.bill.upsert({
      where: { billNumber },
      update: {},
      create: {
        id: generateId(),
        billNumber,
        orderId: order.id,
        userId: order.user?.id,
        productId: order.product.id,
        firstName: order.firstName,
        lastName: order.lastName,
        email: order.email,
        phone: order.phone, // Order has no phone column (preexisting; see createOrder note)
        productName: order.product.name,
        quantity: order.quantity,
        unitPrice: order.product.price,
        totalPrice: order.totalPrice,
        adminCommission: order.adminCommission || (order.totalPrice * 0.05),
        sellerRevenue: order.totalPrice * 0.95,
        deliveryStreet: order.deliveryStreet,
        deliveryCity: order.deliveryCity,
        deliveryState: order.deliveryState,
        deliveryZipCode: order.deliveryZipCode,
        deliveryCountry: order.deliveryCountry,
        deliveryDate: order.deliveryDate,
        orderDate: order.createdAt,
        status: "Generated",
      },
    });

    if (!order.billId) {
      await prisma.order.update({ where: { id: order.id }, data: { billId: persisted.id } });
    }

    // Keep the response shape the frontend already expects (nested deliveryAddress/variants)
    // rather than the flat persisted row shape.
    const billData = {
      billNumber: persisted.billNumber,
      orderId: order.id,
      userId: order.user?.id,
      productId: order.product.id,
      customerName: `${order.firstName} ${order.lastName}`,
      customerEmail: order.email,
      customerPhone: order.phone,
      productName: order.product.name,
      quantity: order.quantity,
      unitPrice: order.product.price,
      totalPrice: order.totalPrice,
      adminCommission: persisted.adminCommission,
      sellerRevenue: persisted.sellerRevenue,
      deliveryAddress: {
        street: order.deliveryStreet,
        city: order.deliveryCity,
        state: order.deliveryState,
        zipCode: order.deliveryZipCode,
        country: order.deliveryCountry,
      },
      deliveryDate: order.deliveryDate,
      orderDate: order.createdAt,
      status: persisted.status,
      variants: {
        storage: order.variantStorage,
        color: order.variantColor,
        ram: order.variantRam,
        screenSize: order.variantScreenSize,
        processor: order.variantProcessor,
      }
    };

    res.status(200).json({
      message: "Bill generated successfully",
      bill: billData
    });
  } catch (error) {
    console.error("Error generating bill:", error);
    res.status(500).json({ message: "Server error while generating bill" });
  }
};

// Get all bills for a user
// NOTE: same as generateBill — built in-memory from Order data, never persisted to prisma.bill.
export const getUserBills = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get all orders for this user
    const orders = await prisma.order.findMany({
      where: { userId },
      include: { product: { select: { name: true, price: true } } },
      orderBy: { createdAt: "desc" },
    });

    // Convert orders to bills
    const bills = orders.map(order => ({
      billNumber: `BILL-${order.id}`,
      orderId: order.id,
      customerName: `${order.firstName} ${order.lastName}`,
      customerEmail: order.email,
      productName: order.product?.name,
      quantity: order.quantity,
      unitPrice: order.product?.price,
      totalPrice: order.totalPrice,
      adminCommission: order.adminCommission || (order.totalPrice * 0.05),
      deliveryAddress: {
        street: order.deliveryStreet,
        city: order.deliveryCity,
        state: order.deliveryState,
        zipCode: order.deliveryZipCode,
        country: order.deliveryCountry,
      },
      deliveryDate: order.deliveryDate,
      orderDate: order.createdAt,
      status: order.status || "Delivered"
    }));

    res.status(200).json({
      message: "User bills retrieved successfully",
      bills,
      count: bills.length
    });
  } catch (error) {
    console.error("Error fetching user bills:", error);
    res.status(500).json({ message: "Server error while fetching bills" });
  }
};

// Send order confirmation email with product details
export const sendOrderConfirmationEmail = async (req, res) => {
  try {
    const { orderId } = req.params;

    // Find the order with product details
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        product: { select: { name: true, price: true, description: true, images: true } },
        user: { select: { email: true, shopName: true } },
      },
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Check if confirmation email has already been sent
    if (order.confirmationEmailSent) {
      return res.status(200).json({
        message: "Confirmation email already sent",
        orderId: orderId,
        email: order.email
      });
    }

    // Format delivery address
    const hasDeliveryAddress = order.deliveryStreet || order.deliveryCity || order.deliveryState || order.deliveryZipCode || order.deliveryCountry;
    const deliveryAddressText = hasDeliveryAddress
      ? `${order.deliveryStreet || ''}, ${order.deliveryCity || ''}, ${order.deliveryState || ''} ${order.deliveryZipCode || ''}, ${order.deliveryCountry || ''}`
      : 'Not provided';

    // Prepare email content with product details
    const subject = "Order Confirmation - ShopSphere";
    const productName = order.product?.name || 'Product';
    const productPrice = order.product?.price || 0;
    const totalPrice = order.totalPrice || (productPrice * order.quantity);
    const adminCommission = order.adminCommission || (totalPrice * 0.05);

    const text = `Dear ${order.firstName} ${order.lastName},\n\nThank you for your purchase!\n\nOrder Details:\n\nProduct: ${productName}\nQuantity: ${order.quantity}\nPrice per unit: Rs. ${productPrice.toLocaleString()}\nTotal Amount: Rs. ${totalPrice.toLocaleString()}\n\nDelivery Information:\nAddress: ${deliveryAddressText}\nExpected Delivery Date: ${order.deliveryDate ? new Date(order.deliveryDate).toLocaleDateString() : 'To be confirmed'}\n\nYour order has been successfully placed and will be delivered soon.\n\nThank you for shopping with ShopSphere!`;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #7c3aed; text-align: center;">Order Confirmation</h1>
        <p>Dear ${order.firstName} ${order.lastName},</p>
        <p>Thank you for your purchase! Your order has been successfully placed.</p>

        <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h2 style="color: #1f2937; margin-top: 0;">Order Details</h2>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;"><strong>Product:</strong></td>
              <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${productName}</td>
            </tr>
            <tr>
              <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;"><strong>Quantity:</strong></td>
              <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${order.quantity}</td>
            </tr>
            <tr>
              <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;"><strong>Price per unit:</strong></td>
              <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">Rs. ${productPrice.toLocaleString()}</td>
            </tr>
            <tr>
              <td style="padding: 10px; border-bottom: 2px solid #7c3aed;"><strong>Total Amount:</strong></td>
              <td style="padding: 10px; border-bottom: 2px solid #7c3aed; font-size: 18px; color: #7c3aed;"><strong>Rs. ${totalPrice.toLocaleString()}</strong></td>
            </tr>
          </table>
        </div>

        <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h2 style="color: #1f2937; margin-top: 0;">Delivery Information</h2>
          <p><strong>Delivery Address:</strong><br>${deliveryAddressText}</p>
          <p><strong>Expected Delivery Date:</strong> ${order.deliveryDate ? new Date(order.deliveryDate).toLocaleDateString() : 'To be confirmed'}</p>
        </div>

        <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 0;"><strong>Order ID:</strong> ${orderId}</p>
          <p style="margin: 10px 0 0 0;"><strong>Order Date:</strong> ${new Date(order.createdAt).toLocaleDateString()}</p>
        </div>

        <p style="color: #666; text-align: center;">Your order will be shipped soon. You can track your order using your Order ID.</p>
        <p style="color: #666; text-align: center;">For any queries, please contact our customer support team.</p>

        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
        <p style="color: #666; text-align: center; font-size: 12px;">Thank you for shopping with ShopSphere!</p>
      </div>
    `;

    // Send email
    sendEmail(order.email, subject, text, html);

    // Mark confirmation email as sent
    await prisma.order.update({
      where: { id: orderId },
      data: { confirmationEmailSent: true },
    });

    res.status(200).json({
      message: "Order confirmation email sent successfully",
      orderId: orderId,
      email: order.email
    });
  } catch (error) {
    console.error("Error sending order confirmation email:", error);
    res.status(500).json({ message: "Server error while sending email" });
  }
};

// Core confirm-and-deduct-stock logic, independent of req/res so it can run both from the
// user-facing route below (after an auth + payment check) and from the eSewa webhook once a
// PaymentEvent has verified the charge actually succeeded.
// If order has orderGroupId, confirms all orders in the group. Returns alreadyConfirmed:true
// as a no-op if the order isn't Pending anymore (safe to call more than once).
export const confirmOrderCore = async (orderId) => {
  const primaryOrder = await prisma.order.findUnique({ where: { id: orderId }, include: { product: true } });
  if (!primaryOrder) {
    const err = new Error("Order not found");
    err.statusCode = 404;
    throw err;
  }

  if (primaryOrder.status !== 'Pending') {
    return { primaryOrder, confirmedOrders: [], errors: [], alreadyConfirmed: true };
  }

  // Get all orders in the group (or just this one if no group)
  const ordersToConfirm = primaryOrder.orderGroupId
      ? await prisma.order.findMany({ where: { orderGroupId: primaryOrder.orderGroupId }, include: { product: true } })
      : [primaryOrder];

    console.log(`Confirming ${ordersToConfirm.length} order(s) in group ${primaryOrder.orderGroupId || 'N/A'}`);

    const confirmedOrders = [];
    const errors = [];

    // Process each order
    for (const order of ordersToConfirm) {
      try {
        const { quantity } = order;
        const productId = order.product.id;
        const orderId = order.id;

        // Extract selected variants
        const selectedColor = order.variantColor;
        const selectedStorage = order.variantStorage;
        const confirmedAt = order.confirmedAt || new Date();

        // Stock deduction, order status flip, and revenue update happen atomically —
        // a failure partway through must not leave stock deducted but the order still Pending.
        const { updatedProduct, updatedOrder } = await prisma.$transaction(async (tx) => {
          const product = await adjustStock(productId, quantity, selectedColor, selectedStorage, -1, tx);
          if (!product) return { updatedProduct: null, updatedOrder: null };

          const orderRow = await tx.order.update({
            where: { id: orderId },
            data: { status: 'Confirmed', confirmedAt },
            include: { product: true },
          });

          await updateFirstRevenueByOrder(orderId, { status: "Completed" }, tx);

          return { updatedProduct: product, updatedOrder: orderRow };
        });

        if (!updatedProduct) {
          errors.push(`Product not found for order ${order.id}`);
          continue;
        }

        console.log(`✅ Stock deducted: ${quantity} units for order ${order.id}`);
        confirmedOrders.push(updatedOrder);

        // Check for low stock and send alert to seller
        if (updatedProduct.quantity < 5) {
          try {
            const seller = updatedProduct.sellerId
              ? await prisma.user.findUnique({ where: { id: updatedProduct.sellerId } })
              : null;
            if (seller) {
              const subject = `⚠️ Low Stock Alert - ${updatedProduct.name}`;
              const text = `Dear ${seller.shopName},\n\nYour product "${updatedProduct.name}" is running low on stock.\n\nCurrent Stock: ${updatedProduct.quantity} units\n\nPlease restock soon to avoid losing sales.`;
              const html = shopSphereEmail('Low Stock Alert', `
                <p>Dear <strong>${seller.shopName}</strong>,</p>
                <p>Your product is running low on stock:</p>
                <div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:16px 20px;border-radius:0 8px 8px 0;margin:16px 0;">
                  <p style="margin:0 0 8px;font-weight:700;color:#92400e;font-size:16px;">${updatedProduct.name}</p>
                  <p style="margin:0;color:#92400e;">Only <strong>${updatedProduct.quantity} unit(s)</strong> remaining</p>
                </div>
                <p>Please restock soon to avoid losing sales.</p>
                <p style="text-align:center;margin-top:24px;"><a href="#" style="display:inline-block;background:#7c3aed;color:#ffffff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:700;">Go to Seller Panel</a></p>
              `, { accentColor: '#f59e0b', icon: '⚠️' });
              sendEmail(seller.email, subject, text, html);
              // In-app notification for seller
              await prisma.notification.create({
                data: {
                  id: generateId(),
                  userId: seller.id,
                  type: "low_stock",
                  title: "⚠️ Low Stock Alert",
                  message: `"${updatedProduct.name}" has only ${updatedProduct.quantity} unit(s) left. Please restock soon.`,
                  productId: updatedProduct.id,
                  productName: updatedProduct.name,
                  productImage: updatedProduct.images?.[0] || null,
                },
              });
            }
          } catch (alertError) {
            console.error("Error sending low stock alert:", alertError);
          }
        }
      } catch (orderError) {
        console.error(`Error confirming order ${order.id}:`, orderError);
        errors.push(`Failed to confirm order ${order.id}`);
      }
    }

    // Send consolidated confirmation email to customer
    try {
      const hasDeliveryAddress = primaryOrder.deliveryStreet || primaryOrder.deliveryCity || primaryOrder.deliveryState || primaryOrder.deliveryZipCode || primaryOrder.deliveryCountry;
      const deliveryAddressText = hasDeliveryAddress
        ? `${primaryOrder.deliveryStreet || ''}, ${primaryOrder.deliveryCity || ''}, ${primaryOrder.deliveryState || ''} ${primaryOrder.deliveryZipCode || ''}, ${primaryOrder.deliveryCountry || ''}`
        : 'Not provided';

      const totalAmount = confirmedOrders.reduce((sum, order) => sum + (order.totalPrice || 0), 0);

      const subject = "Order Confirmation - ShopSphere";

      // Build product list for email
      let productListText = '';
      let productListHtml = '';
      confirmedOrders.forEach((order, index) => {
        const productName = order.product?.name || 'Product';
        const productPrice = order.product?.price || 0;
        productListText += `${index + 1}. ${productName} - Quantity: ${order.quantity} - Rs. ${(productPrice * order.quantity).toLocaleString()}\n`;
        productListHtml += `
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${productName}</td>
            <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: center;">${order.quantity}</td>
            <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: right;">Rs. ${(productPrice * order.quantity).toLocaleString()}</td>
          </tr>
        `;
      });

      const text = `Dear ${primaryOrder.firstName} ${primaryOrder.lastName},\n\nThank you for your purchase!\n\nOrder Details:\n\n${productListText}\nTotal Amount: Rs. ${totalAmount.toLocaleString()}\n\nDelivery Information:\nAddress: ${deliveryAddressText}\nExpected Delivery Date: ${primaryOrder.deliveryDate ? new Date(primaryOrder.deliveryDate).toLocaleDateString() : 'To be confirmed'}\n\nYour order has been successfully placed and will be delivered soon.\n\nThank you for shopping with ShopSphere!`;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #7c3aed; text-align: center;">Order Confirmation</h1>
          <p>Dear ${primaryOrder.firstName} ${primaryOrder.lastName},</p>
          <p>Thank you for your purchase! Your order${confirmedOrders.length > 1 ? 's have' : ' has'} been successfully placed.</p>

          <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h2 style="color: #1f2937; margin-top: 0;">Order Details</h2>
            <table style="width: 100%; border-collapse: collapse;">
              <tr style="background-color: #e5e7eb;">
                <th style="padding: 10px; text-align: left;">Product</th>
                <th style="padding: 10px; text-align: center;">Quantity</th>
                <th style="padding: 10px; text-align: right;">Price</th>
              </tr>
              ${productListHtml}
              <tr>
                <td colspan="2" style="padding: 10px; border-bottom: 2px solid #7c3aed;"><strong>Total Amount:</strong></td>
                <td style="padding: 10px; border-bottom: 2px solid #7c3aed; text-align: right; font-size: 18px; color: #7c3aed;"><strong>Rs. ${totalAmount.toLocaleString()}</strong></td>
              </tr>
            </table>
          </div>

          <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h2 style="color: #1f2937; margin-top: 0;">Delivery Information</h2>
            <p><strong>Delivery Address:</strong><br>${deliveryAddressText}</p>
            <p><strong>Expected Delivery Date:</strong> ${primaryOrder.deliveryDate ? new Date(primaryOrder.deliveryDate).toLocaleDateString() : 'To be confirmed'}</p>
          </div>

          <p style="color: #666; text-align: center;">Your order${confirmedOrders.length > 1 ? 's' : ''} will be shipped soon. You can track ${confirmedOrders.length > 1 ? 'them' : 'it'} in your orders page.</p>
          <p style="color: #666; text-align: center;">For any queries, please contact our customer support team.</p>

          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
          <p style="color: #666; text-align: center; font-size: 12px;">Thank you for shopping with ShopSphere!</p>
        </div>
      `;

      sendEmail(primaryOrder.email, subject, text, html);
      console.log(`✅ Order confirmation email sent to customer: ${primaryOrder.email}`);
    } catch (emailError) {
      console.error("Error sending order confirmation email:", emailError);
      // Don't fail the order if email fails
    }

    // Clear the user's cart after successful order confirmation
    try {
      const userEmail = primaryOrder.email;
      const cart = await prisma.cart.findFirst({ where: { email: userEmail }, include: { items: true } });
      if (cart && cart.items.length > 0) {
        await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
        await prisma.cart.update({ where: { id: cart.id }, data: { totalPrice: 0, updatedAt: new Date() } });
        console.log(`✅ Cart cleared for user: ${userEmail}`);
      }
    } catch (cartError) {
      console.error("Error clearing cart:", cartError);
      // Don't fail the order if cart clearing fails
    }

  return { primaryOrder, confirmedOrders, errors, alreadyConfirmed: false };
};

// Route handler: user hits this after being redirected back from eSewa. Gated on a Payment
// row — if this order went through eSewa checkout, that payment must already be Succeeded
// (set by the webhook in controller/payment.js) before we'll deduct stock. Orders with no
// Payment row (e.g. cash on delivery) skip the gate, matching pre-existing behavior for them.
export const confirmOrderAndDeductStock = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user?.id;

    const primaryOrder = await prisma.order.findUnique({ where: { id: orderId } });
    if (!primaryOrder) {
      return res.status(404).json({ message: "Order not found" });
    }
    if (primaryOrder.userId !== userId) {
      return res.status(403).json({ message: "Unauthorized to confirm this order" });
    }
    if (primaryOrder.status !== 'Pending') {
      return res.status(400).json({ message: "Order already confirmed or cancelled" });
    }

    const payment = await prisma.payment.findFirst({
      where: primaryOrder.orderGroupId ? { orderGroupId: primaryOrder.orderGroupId } : { orderId },
      orderBy: { createdAt: "desc" },
    });
    if (payment && payment.status !== "Succeeded") {
      return res.status(402).json({ message: "Payment not verified yet. Please wait a moment and try again." });
    }

    const { confirmedOrders, errors } = await confirmOrderCore(orderId);

    res.status(200).json({
      message: `${confirmedOrders.length} order(s) confirmed and stock deducted successfully`,
      confirmedCount: confirmedOrders.length,
      orders: confirmedOrders.map(withNestedOrderShape),
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error("Error confirming order:", error);
    res.status(error.statusCode || 500).json({ message: error.message || "Server error while confirming order" });
  }
};

// ─── Cancel Order (user-initiated) ────────────────────────────────────────────
// Allowed only when status is Pending or Confirmed. Restores stock automatically.
export const cancelOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user.id;

    let order = await prisma.order.findUnique({ where: { id: orderId }, include: { product: true } });
    if (!order) return res.status(404).json({ message: "Order not found" });

    // Only the order owner can cancel
    if (order.userId !== userId) {
      return res.status(403).json({ message: "Not authorized to cancel this order" });
    }

    const cancellableStatuses = ["Pending", "Confirmed"];
    if (!cancellableStatuses.includes(order.status)) {
      return res.status(400).json({
        message: `Order cannot be cancelled. Current status: ${order.status}. Only Pending or Confirmed orders can be cancelled.`,
      });
    }

    // Restore stock and flip status atomically — a failure partway through must not
    // leave stock restored but the order still showing as Confirmed/Pending, or vice versa.
    const { quantity } = order;
    order = await prisma.$transaction(async (tx) => {
      await adjustStock(order.product.id, quantity, order.variantColor, order.variantStorage, 1, tx);
      return tx.order.update({
        where: { id: orderId },
        data: { status: "Cancelled", cancelledAt: new Date() },
        include: { product: true },
      });
    });
    console.log(`✅ Stock restored: ${quantity} units for order ${orderId}`);

    // Notify customer
    const cancelHtml = shopSphereEmail('Order Cancelled', `
      <p>Hi <strong>${order.firstName}</strong>,</p>
      <p>Your order for <strong>${order.product?.name}</strong> has been successfully cancelled.</p>
      ${emailTable(
        emailRow('Order ID', order.id.slice(-8).toUpperCase()) +
        emailRow('Product', order.product?.name || 'Product')
      )}
      <p style="margin-top:16px;">If you paid online, a refund will be processed within <strong>5–7 business days</strong>.</p>
    `, { accentColor: '#ef4444', icon: '❌' });
    sendEmail(order.email, "Order Cancelled – ShopSphere", "Your order has been cancelled.", cancelHtml);

    res.status(200).json({ message: "Order cancelled successfully", order: withNestedOrderShape(order) });
  } catch (error) {
    console.error("Error cancelling order:", error);
    res.status(500).json({ message: "Server error while cancelling order" });
  }
};

// ─── Request Return (user-initiated) ─────────────────────────────────────────
// Allowed only when status is Delivered AND within 7 days of deliveredAt.
export const requestReturn = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { reason } = req.body;
    const userId = req.user.id;
    const returnImagePath = req.file ? req.file.filename : null; // Get uploaded image

    let order = await prisma.order.findUnique({ where: { id: orderId }, include: { product: true } });
    if (!order) return res.status(404).json({ message: "Order not found" });

    if (order.userId !== userId) {
      return res.status(403).json({ message: "Not authorized to request return for this order" });
    }

    if (order.status !== "Delivered") {
      return res.status(400).json({ message: "Return can only be requested for delivered orders" });
    }

    // Check 7-day window from deliveredAt (fallback to deliveryDate if deliveredAt missing)
    const deliveredDate = order.deliveredAt || order.deliveryDate;
    const daysSinceDelivery = (Date.now() - new Date(deliveredDate).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceDelivery > 7) {
      return res.status(400).json({
        message: "Return window has expired. Returns are only accepted within 7 days of delivery.",
      });
    }

    order = await prisma.order.update({
      where: { id: orderId },
      data: {
        status: "Return Requested",
        returnRequestedAt: new Date(),
        ...(reason ? { returnReason: reason } : {}),
        ...(returnImagePath ? { returnImage: returnImagePath } : {}),
      },
      include: { product: true },
    });

    // Notify customer
    const customerHtml = shopSphereEmail('Return Request Received', `
      <p>Hi <strong>${order.firstName}</strong>,</p>
      <p>We've received your return request for <strong>${order.product?.name}</strong>.</p>
      <div style="background:#fff7ed;border-left:4px solid #f97316;padding:16px 20px;border-radius:0 8px 8px 0;margin:16px 0;">
        <p style="margin:0 0 6px;font-weight:700;color:#9a3412;">Reason</p>
        <p style="margin:0;color:#9a3412;">${reason || 'Not specified'}</p>
      </div>
      <p>Our team will review it within <strong>1–2 business days</strong> and you'll be notified by email once a decision is made.</p>
    `, { accentColor: '#f97316', icon: '📦' });
    sendEmail(order.email, "Return Request Received – ShopSphere", "Your return request has been received.", customerHtml);

    // Notify admin
    const adminEmail = process.env.ADMIN_EMAIL;
    if (adminEmail) {
      const adminHtml = shopSphereEmail('New Return Request', `
        <p>Customer <strong>${order.firstName} ${order.lastName}</strong> (${order.email}) has requested a return.</p>
        ${emailTable(
          emailRow('Product', order.product?.name) +
          emailRow('Order ID', order.id.slice(-8).toUpperCase()) +
          emailRow('Reason', reason || 'Not specified')
        )}
        ${returnImagePath ? '<p style="color:#059669;font-weight:600;">✅ Defect image uploaded</p>' : ''}
        <p style="margin-top:16px;">Please review and approve or reject this return from the <strong>Admin Orders</strong> panel.</p>
      `, { accentColor: '#f97316', icon: '⚠️' });
      sendEmail(adminEmail, `Return Request: Order ${order.id.slice(-8)} – ShopSphere`, "A customer has requested a return.", adminHtml);
    }

    // Notify seller
    try {
      const seller = order.product?.sellerId
        ? await prisma.user.findUnique({ where: { id: order.product.sellerId } })
        : null;
      if (seller?.email) {
        const sellerHtml = shopSphereEmail('Return Request for Your Product', `
          <p>A customer has requested a return for your product <strong>${order.product?.name}</strong>.</p>
          ${emailTable(
            emailRow('Customer', order.firstName + ' ' + order.lastName) +
            emailRow('Order ID', order.id.slice(-8).toUpperCase()) +
            emailRow('Reason', reason || 'Not specified')
          )}
          ${returnImagePath ? '<p style="color:#059669;font-weight:600;">✅ Defect image uploaded</p>' : ''}
          <p style="margin-top:16px;">The admin will review and process this return. You can monitor it in your <strong>Seller Orders</strong> panel.</p>
        `, { accentColor: '#f97316', icon: '⚠️' });
        sendEmail(seller.email, `Return Request: ${order.product?.name} – ShopSphere`, "A return has been requested for your product.", sellerHtml);
      }
    } catch (sellerNotifyErr) { /* non-fatal */ }

    res.status(200).json({ message: "Return request submitted successfully", order: withNestedOrderShape(order) });
  } catch (error) {
    console.error("Error requesting return:", error);
    res.status(500).json({ message: "Server error while requesting return" });
  }
};

// ─── Process Return (admin/seller) ───────────────────────────────────────────
// Approve or Reject a return request. If approved, stock is restored.
export const processReturn = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { action } = req.body; // "approve" or "reject"

    if (!["approve", "reject"].includes(action)) {
      return res.status(400).json({ message: "Action must be 'approve' or 'reject'" });
    }

    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { product: true } });
    if (!order) return res.status(404).json({ message: "Order not found" });

    // sellers may only process returns for their own products
    if (req.user.role === "seller") {
      const sellerId = req.user.id;
      if (!order.product || order.product.sellerId !== sellerId) {
        return res.status(403).json({ message: "Access denied. This order does not belong to you." });
      }
    }

    if (order.status !== "Return Requested") {
      return res.status(400).json({ message: "Order is not in 'Return Requested' status" });
    }

    let newStatus;
    if (action === "approve") {
      newStatus = "Return Approved";

      // Restore stock
      try {
        const { quantity } = order;
        await adjustStock(order.product.id, quantity, order.variantColor, order.variantStorage, 1);
      } catch (stockErr) {
        console.error("Stock restore error on return approval:", stockErr);
      }

      const approvedHtml = shopSphereEmail('Return Approved', `
        <p>Hi <strong>${order.firstName}</strong>,</p>
        <p>Great news! Your return for <strong>${order.product?.name}</strong> has been approved.</p>
        <div style="background:#ecfdf5;border-left:4px solid #10b981;padding:16px 20px;border-radius:0 8px 8px 0;margin:16px 0;">
          <p style="margin:0;color:#065f46;font-weight:700;">Next Steps</p>
          <p style="margin:8px 0 0;color:#065f46;">Please ship the product back to us. Refund will be processed within <strong>5–7 business days</strong> of receiving the item.</p>
        </div>
      `, { accentColor: '#10b981', icon: '✅' });
      sendEmail(order.email, "Return Approved – ShopSphere", "Your return has been approved.", approvedHtml);
      // Notify seller
      try {
        const seller = order.product?.sellerId
          ? await prisma.user.findUnique({ where: { id: order.product.sellerId } })
          : null;
        if (seller?.email) {
          const sellerHtml = shopSphereEmail('Return Approved for Your Product', `
            <p>The return request for <strong>${order.product?.name}</strong> has been <strong>approved</strong>.</p>
            ${emailTable(
              emailRow('Order ID', order.id.slice(-8).toUpperCase()) +
              emailRow('Product', order.product?.name)
            )}
            <p style="margin-top:16px;color:#059669;font-weight:600;">Stock has been restored to your inventory.</p>
          `, { accentColor: '#10b981', icon: '✅' });
          sendEmail(seller.email, `Return Approved: ${order.product?.name} – ShopSphere`, "A return was approved for your product.", sellerHtml);
        }
      } catch (_) { /* non-fatal */ }
    } else {
      newStatus = "Return Rejected";
      const rejectedHtml = shopSphereEmail('Return Request Rejected', `
        <p>Hi <strong>${order.firstName}</strong>,</p>
        <p>Unfortunately, your return request for <strong>${order.product?.name}</strong> could not be approved.</p>
        <div style="background:#fef2f2;border-left:4px solid #ef4444;padding:16px 20px;border-radius:0 8px 8px 0;margin:16px 0;">
          <p style="margin:0;color:#991b1b;">If you believe this is an error, please contact our support team for assistance.</p>
        </div>
      `, { accentColor: '#ef4444', icon: '❌' });
      sendEmail(order.email, "Return Request Rejected – ShopSphere", "Your return request was rejected.", rejectedHtml);
      // Notify seller
      try {
        const seller = order.product?.sellerId
          ? await prisma.user.findUnique({ where: { id: order.product.sellerId } })
          : null;
        if (seller?.email) {
          const sellerHtml = shopSphereEmail('Return Rejected for Your Product', `
            <p>The return request for <strong>${order.product?.name}</strong> has been <strong>rejected</strong>.</p>
            ${emailTable(
              emailRow('Order ID', order.id.slice(-8).toUpperCase()) +
              emailRow('Product', order.product?.name)
            )}
            <p style="margin-top:16px;color:#6b7280;">No stock changes were made.</p>
          `, { accentColor: '#ef4444', icon: '❌' });
          sendEmail(seller.email, `Return Rejected: ${order.product?.name} – ShopSphere`, "A return was rejected for your product.", sellerHtml);
        }
      } catch (_) { /* non-fatal */ }
    }

    const updatedOrder = await prisma.order.update({ where: { id: orderId }, data: { status: newStatus }, include: { product: true } });
    res.status(200).json({ message: `Return ${action === "approve" ? "approved" : "rejected"} successfully`, order: withNestedOrderShape(updatedOrder) });
  } catch (error) {
    console.error("Error processing return:", error);
    res.status(500).json({ message: "Server error while processing return" });
  }
};

// ─── Release Refund (admin) ───────────────────────────────────────────────────
// Marks the order as Refund Released and notifies customer + seller by email.
export const releaseRefund = async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { product: true } });
    if (!order) return res.status(404).json({ message: "Order not found" });

    if (order.status !== "Return Approved") {
      return res.status(400).json({
        message: `Refund can only be released for Return Approved orders. Current status: ${order.status}`,
      });
    }

    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: { status: "Refund Released", refundReleasedAt: new Date() },
      include: { product: true },
    });

    // Mark revenue record as Refunded so it's excluded from all revenue totals
    try {
      await updateFirstRevenueByOrder(order.id, { status: "Refunded", totalSalePrice: 0, adminCommission: 0, sellerRevenue: 0 });
      console.log(`✅ Revenue record marked as Refunded for order ${order.id}`);
    } catch (revErr) {
      console.error("Revenue update error (non-fatal):", revErr);
    }

    // Notify customer
    const customerHtml = shopSphereEmail('Refund Released!', `
      <p>Hi <strong>${updatedOrder.firstName}</strong>,</p>
      <p>Great news! Your refund for <strong>${updatedOrder.product?.name}</strong> has been released.</p>
      ${emailTable(
        emailRow('Order ID', updatedOrder.id.slice(-8).toUpperCase()) +
        emailRow('Product', updatedOrder.product?.name) +
        emailRow('Refund Amount', 'Rs. ' + updatedOrder.totalPrice, true)
      )}
      <div style="background:#ecfdf5;border-left:4px solid #10b981;padding:16px 20px;border-radius:0 8px 8px 0;margin:16px 0;">
        <p style="margin:0;color:#065f46;">The refund of <strong>Rs. ${updatedOrder.totalPrice}</strong> will be credited to your original payment method within <strong>5–7 business days</strong>.</p>
      </div>
      <p>If you have any questions, please contact our support team.</p>
    `, { accentColor: '#10b981', icon: '💰' });
    sendEmail(updatedOrder.email, "Refund Released – ShopSphere", `Your refund of Rs. ${updatedOrder.totalPrice} has been released.`, customerHtml);

    // Notify seller
    try {
      const seller = updatedOrder.product?.sellerId
        ? await prisma.user.findUnique({ where: { id: updatedOrder.product.sellerId } })
        : null;
      if (seller?.email) {
        const sellerHtml = shopSphereEmail('Refund Released', `
          <p>The refund for order <strong>${updatedOrder.id.slice(-8).toUpperCase()}</strong> (<strong>${updatedOrder.product?.name}</strong>) has been released to the customer.</p>
          ${emailTable(
            emailRow('Order ID', updatedOrder.id.slice(-8).toUpperCase()) +
            emailRow('Product', updatedOrder.product?.name) +
            emailRow('Refund Amount', 'Rs. ' + updatedOrder.totalPrice, true)
          )}
        `, { accentColor: '#10b981', icon: '💰' });
        sendEmail(seller.email, `Refund Released: ${updatedOrder.product?.name} – ShopSphere`, "A refund was released for your product.", sellerHtml);
      }
    } catch (_) { /* non-fatal */ }

    res.status(200).json({ message: "Refund released successfully", order: withNestedOrderShape(updatedOrder) });
  } catch (error) {
    console.error("Error releasing refund:", error);
    res.status(500).json({ message: "Server error while releasing refund" });
  }
};

// ─── Track Order (user) ────────────────────────────────────────────────────────
// Returns order with all timeline timestamps so the frontend can render the journey.
export const trackOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user.id;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { product: { select: { name: true, images: true, price: true } } },
    });
    if (!order) return res.status(404).json({ message: "Order not found" });

    // Users can only track their own orders
    if (order.userId !== userId) {
      return res.status(403).json({ message: "Not authorized to track this order" });
    }

    const timeline = [
      { step: "Order Placed",  status: "Pending",    time: order.createdAt,    done: true },
      { step: "Confirmed",     status: "Confirmed",   time: order.confirmedAt,  done: !!order.confirmedAt  || ["Confirmed","Processing","Shipped","Delivered"].includes(order.status) },
      { step: "Processing",    status: "Processing",  time: order.processingAt, done: !!order.processingAt || ["Processing","Shipped","Delivered"].includes(order.status) },
      { step: "Shipped",       status: "Shipped",     time: order.shippedAt,    done: !!order.shippedAt    || ["Shipped","Delivered"].includes(order.status) },
      { step: "Delivered",     status: "Delivered",   time: order.deliveredAt,  done: !!order.deliveredAt  || order.status === "Delivered" },
    ];

    res.status(200).json({ order: withNestedOrderShape(order), timeline });
  } catch (error) {
    console.error("Error tracking order:", error);
    res.status(500).json({ message: "Server error while tracking order" });
  }
};
