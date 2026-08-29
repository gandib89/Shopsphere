import { z } from "zod";
import { prisma } from "../database/prismaClient.js";
import { generateId } from "../utils/generateId.js";

const createPromoCodeSchema = z.object({
  code: z.string().min(1),
  description: z.string().min(1),
  discountType: z.enum(["percentage", "fixed"]),
  discountValue: z.coerce.number().positive(),
  minPurchase: z.coerce.number().nonnegative().optional(),
  maxDiscount: z.coerce.number().positive().optional(),
  usageLimit: z.coerce.number().int().positive().optional(),
  validFrom: z.string().min(1),
  validUntil: z.string().min(1),
});

// Create a new promo code (Admin only)
export const createPromoCode = async (req, res) => {
  const parsed = createPromoCodeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues[0].message });
  }
  try {
    const {
      code,
      description,
      discountType,
      discountValue,
      minPurchase,
      maxDiscount,
      usageLimit,
      validFrom,
      validUntil,
    } = parsed.data;

    // Validate dates
    const fromDate = new Date(validFrom);
    const untilDate = new Date(validUntil);

    if (untilDate <= fromDate) {
      return res.status(400).json({ message: "Valid until date must be after valid from date" });
    }

    // Validate discount value
    if (discountType === "percentage" && discountValue > 100) {
      return res.status(400).json({ message: "Percentage discount cannot exceed 100%" });
    }

    const promoCode = await prisma.promoCode.create({
      data: {
        id: generateId(),
        code: code.toUpperCase(),
        description,
        discountType,
        discountValue,
        minPurchase: minPurchase || 0,
        maxDiscount: maxDiscount || null,
        usageLimit: usageLimit || null,
        validFrom: fromDate,
        validUntil: untilDate,
        isActive: true,
        createdById: req.user.id,
      },
    });

    // Send notification to all users about the new promo code
    try {
      const users = await prisma.user.findMany({ where: { role: "user" }, select: { id: true } });

      const discountText = discountType === "percentage"
        ? `${discountValue}% OFF`
        : `Rs. ${discountValue} OFF`;

      const minPurchaseText = minPurchase > 0
        ? ` on orders above Rs. ${minPurchase}`
        : "";

      const notifications = users.map(user => ({
        id: generateId(),
        userId: user.id,
        type: "discount",
        title: `New Promo Code: ${code.toUpperCase()}`,
        message: `${description} - Get ${discountText}${minPurchaseText}. Valid until ${untilDate.toLocaleDateString()}. Use code: ${code.toUpperCase()}`,
        read: false,
        createdAt: new Date(),
      }));

      if (notifications.length > 0) {
        await prisma.notification.createMany({ data: notifications });
        console.log(`Sent promo code notifications to ${notifications.length} users`);
      }
    } catch (notifError) {
      console.error("Error sending promo notifications:", notifError);
      // Don't fail the promo code creation if notifications fail
    }

    res.status(201).json({
      success: true,
      message: "Promo code created successfully",
      promoCode,
    });
  } catch (error) {
    console.error("Error creating promo code:", error);
    if (error?.code === "P2002") {
      return res.status(400).json({ message: "Promo code already exists" });
    }
    res.status(500).json({ message: "Server error while creating promo code" });
  }
};

const validatePromoCodeSchema = z.object({
  code: z.string().min(1),
  purchaseAmount: z.coerce.number().positive(),
});

// Validate and apply promo code
export const validatePromoCode = async (req, res) => {
  const parsed = validatePromoCodeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Code and purchase amount are required" });
  }
  const { code, purchaseAmount } = parsed.data;

  try {
    const promoCode = await prisma.promoCode.findUnique({ where: { code: code.toUpperCase() } });

    if (!promoCode) {
      return res.status(404).json({ message: "Invalid promo code" });
    }

    console.log(`Validating promo code ${code} for user ${req.user.id}`);
    console.log(`Promo details - Active: ${promoCode.isActive}, UsedCount: ${promoCode.usedCount}, UsageLimit: ${promoCode.usageLimit}`);

    // Check if active
    if (!promoCode.isActive) {
      console.log(`Promo ${code} validation failed: inactive`);
      return res.status(400).json({ message: "This promo code is no longer active" });
    }

    // Check date validity
    const now = new Date();
    if (now < promoCode.validFrom) {
      console.log(`Promo ${code} validation failed: not yet valid`);
      return res.status(400).json({ message: "This promo code is not yet valid" });
    }
    if (now > promoCode.validUntil) {
      console.log(`Promo ${code} validation failed: expired`);
      return res.status(400).json({ message: "This promo code has expired" });
    }

    // Check if user has already used this promo code
    const userId = req.user.id;
    const existingUsage = await prisma.promoCodeUsage.findUnique({
      where: { promoCodeId_userId: { promoCodeId: promoCode.id, userId } },
    });
    if (existingUsage) {
      console.log(`Promo ${code} validation failed: user ${userId} already used it`);
      return res.status(400).json({ message: "You have already used this promo code" });
    }

    // Check usage limit
    if (promoCode.usageLimit && promoCode.usedCount >= promoCode.usageLimit) {
      console.log(`Promo ${code} validation failed: usage limit reached`);
      return res.status(400).json({ message: "This promo code has reached its usage limit" });
    }

    // Check minimum purchase
    if (purchaseAmount < promoCode.minPurchase) {
      console.log(`Promo ${code} validation failed: minimum purchase not met (${purchaseAmount} < ${promoCode.minPurchase})`);
      return res.status(400).json({
        message: `Minimum purchase of Rs. ${promoCode.minPurchase} required to use this promo code`,
      });
    }

    // Calculate discount
    let discountAmount = 0;
    if (promoCode.discountType === "percentage") {
      discountAmount = (purchaseAmount * promoCode.discountValue) / 100;
      // Apply max discount cap if exists
      if (promoCode.maxDiscount && discountAmount > promoCode.maxDiscount) {
        discountAmount = promoCode.maxDiscount;
      }
    } else {
      // Fixed discount
      discountAmount = promoCode.discountValue;
      // Discount cannot exceed purchase amount
      if (discountAmount > purchaseAmount) {
        discountAmount = purchaseAmount;
      }
    }

    const finalAmount = purchaseAmount - discountAmount;

    res.status(200).json({
      success: true,
      message: "Promo code applied successfully",
      promoCode: {
        code: promoCode.code,
        description: promoCode.description,
        discountType: promoCode.discountType,
        discountValue: promoCode.discountValue,
      },
      originalAmount: purchaseAmount,
      discountAmount: Math.round(discountAmount),
      finalAmount: Math.round(finalAmount),
    });
  } catch (error) {
    console.error("Error validating promo code:", error);
    res.status(500).json({ message: "Server error while validating promo code" });
  }
};

// Apply promo code (increment usage count)
export const applyPromoCode = async (req, res) => {
  const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  if (!code) {
    return res.status(400).json({ message: "Code is required" });
  }

  try {
    const userId = req.user.id;

    const promoCode = await prisma.promoCode.findUnique({ where: { code: code.toUpperCase() } });

    if (!promoCode) {
      return res.status(404).json({ message: "Promo code not found" });
    }

    const existingUsage = await prisma.promoCodeUsage.findUnique({
      where: { promoCodeId_userId: { promoCodeId: promoCode.id, userId } },
    });

    if (existingUsage) {
      return res.status(400).json({ message: "You have already used this promo code" });
    }

    try {
      // Mark the code as used by this user; the composite primary key rejects a
      // duplicate the same way the old $addToSet no-op'd on a repeat id.
      await prisma.promoCodeUsage.create({ data: { promoCodeId: promoCode.id, userId } });
    } catch (usageError) {
      if (usageError?.code === "P2002") {
        return res.status(400).json({ message: "You have already used this promo code" });
      }
      throw usageError;
    }

    // Conditional update (not read-then-write) so concurrent redemptions from different
    // users can't collectively blow past usageLimit.
    const { count } = await prisma.promoCode.updateMany({
      where: {
        id: promoCode.id,
        OR: [{ usageLimit: null }, { usedCount: { lt: promoCode.usageLimit ?? 0 } }],
      },
      data: { usedCount: { increment: 1 } },
    });
    if (count === 0) {
      await prisma.promoCodeUsage.delete({ where: { promoCodeId_userId: { promoCodeId: promoCode.id, userId } } });
      return res.status(400).json({ message: "This promo code has reached its usage limit" });
    }

    res.status(200).json({
      success: true,
      message: "Promo code applied",
    });
  } catch (error) {
    console.error("Error applying promo code:", error);
    res.status(500).json({ message: "Server error while applying promo code" });
  }
};

// Get all promo codes (Admin only)
export const getAllPromoCodes = async (req, res) => {
  try {
    const promoCodes = await prisma.promoCode.findMany({ orderBy: { createdAt: "desc" } });
    res.status(200).json({
      success: true,
      promoCodes,
    });
  } catch (error) {
    console.error("Error fetching promo codes:", error);
    res.status(500).json({ message: "Server error while fetching promo codes" });
  }
};

// Toggle promo code status (Admin only)
export const togglePromoCodeStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.promoCode.findUnique({ where: { id } });

    if (!existing) {
      return res.status(404).json({ message: "Promo code not found" });
    }

    const promoCode = await prisma.promoCode.update({
      where: { id },
      data: { isActive: !existing.isActive },
    });

    res.status(200).json({
      success: true,
      message: `Promo code ${promoCode.isActive ? "activated" : "deactivated"}`,
      promoCode,
    });
  } catch (error) {
    console.error("Error toggling promo code status:", error);
    res.status(500).json({ message: "Server error while toggling promo code status" });
  }
};

// Delete promo code (Admin only)
export const deletePromoCode = async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.promoCode.findUnique({ where: { id } });

    if (!existing) {
      return res.status(404).json({ message: "Promo code not found" });
    }

    await prisma.promoCode.delete({ where: { id } });

    res.status(200).json({
      success: true,
      message: "Promo code deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting promo code:", error);
    res.status(500).json({ message: "Server error while deleting promo code" });
  }
};

// Send notification about a promo code to all users (Admin only)
export const notifyPromoCode = async (req, res) => {
  try {
    const { id } = req.params;
    const promoCode = await prisma.promoCode.findUnique({ where: { id } });

    if (!promoCode) {
      return res.status(404).json({ message: "Promo code not found" });
    }

    if (!promoCode.isActive) {
      return res.status(400).json({ message: "Cannot send notifications for inactive promo codes" });
    }

    // Check if promo code is still valid
    const now = new Date();
    if (now > promoCode.validUntil) {
      return res.status(400).json({ message: "Cannot send notifications for expired promo codes" });
    }

    // Get all users
    const users = await prisma.user.findMany({ where: { role: "user" }, select: { id: true } });

    if (users.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No users to notify",
      });
    }

    const discountText = promoCode.discountType === "percentage"
      ? `${promoCode.discountValue}% OFF`
      : `Rs. ${promoCode.discountValue} OFF`;

    const minPurchaseText = promoCode.minPurchase > 0
      ? ` on orders above Rs. ${promoCode.minPurchase}`
      : "";

    const notifications = users.map(user => ({
      id: generateId(),
      userId: user.id,
      type: "discount",
      title: `Special Offer: ${promoCode.code}`,
      message: `${promoCode.description} - Get ${discountText}${minPurchaseText}. Valid until ${promoCode.validUntil.toLocaleDateString()}. Use code: ${promoCode.code}`,
      read: false,
      createdAt: new Date(),
    }));

    await prisma.notification.createMany({ data: notifications });

    res.status(200).json({
      success: true,
      message: `Notifications sent to ${notifications.length} users`,
      notificationCount: notifications.length,
    });
  } catch (error) {
    console.error("Error sending promo notifications:", error);
    res.status(500).json({ message: "Server error while sending notifications" });
  }
};

// Reset promo code usage for a specific user (Admin only)
export const resetPromoForUser = async (req, res) => {
  try {
    const { promoId, userEmail, promoCode } = req.body;

    if ((!promoId && !promoCode) || !userEmail) {
      return res.status(400).json({ message: "Promo code (ID or code) and user email are required" });
    }

    // Find the user by email
    const user = await prisma.user.findUnique({ where: { email: userEmail } });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Find promo by ID or code
    let promo;
    if (promoId) {
      promo = await prisma.promoCode.findUnique({ where: { id: promoId } });
    } else if (promoCode) {
      promo = await prisma.promoCode.findUnique({ where: { code: promoCode.toUpperCase() } });
    }

    if (!promo) {
      return res.status(404).json({ message: "Promo code not found" });
    }

    console.log(`Resetting promo ${promo.code} for user ${userEmail} (${user.id})`);
    console.log(`Current usedCount:`, promo.usedCount);

    const existingUsage = await prisma.promoCodeUsage.findUnique({
      where: { promoCodeId_userId: { promoCodeId: promo.id, userId: user.id } },
    });
    const wasUsedByUser = !!existingUsage;

    if (wasUsedByUser) {
      await prisma.promoCodeUsage.delete({
        where: { promoCodeId_userId: { promoCodeId: promo.id, userId: user.id } },
      });
      await prisma.promoCode.update({
        where: { id: promo.id },
        data: { usedCount: { decrement: 1 } },
      });

      console.log(`Successfully reset promo ${promo.code} for user ${userEmail}`);

      res.status(200).json({
        success: true,
        message: `Promo code ${promo.code} has been reset for user ${userEmail}. They can now use it.`,
      });
    } else {
      console.log(`User ${userEmail} was not in usedBy array for promo ${promo.code}`);
      // if code has a usageLimit of 1 and usedCount>0, decrement global count
      if (promo.usageLimit === 1 && promo.usedCount && promo.usedCount > 0) {
        await prisma.promoCode.update({
          where: { id: promo.id },
          data: { usedCount: { decrement: 1 } },
        });
        console.log(`Global usage count decremented for promo ${promo.code}`);
        res.status(200).json({
          success: true,
          message: `Promo code ${promo.code} usage limit has been reset (global). User ${userEmail} can now use it.`,
        });
      } else {
        res.status(200).json({
          success: true,
          message: `User ${userEmail} has not used promo code ${promo.code}. No reset needed.`,
        });
      }
    }
  } catch (error) {
    console.error("Error resetting promo code for user:", error);
    res.status(500).json({ message: "Server error while resetting promo code" });
  }
};
