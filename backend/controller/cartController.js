import { z } from "zod";
import { listPriceWithOptions } from "../utils/productPricing.js";
import { prisma } from "../database/prismaClient.js";
import { generateId } from "../utils/generateId.js";

const addToCartSchema = z.object({
  productId: z.string().min(1),
  quantity: z.coerce.number().int().positive().optional(),
  variants: z.record(z.string()).optional(),
});

const updateCartItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.coerce.number().int(), // <= 0 is a valid "remove item" signal, checked below
});

const PRODUCT_SELECT = { id: true, name: true, price: true, images: true, category: true, discount: true, options: true };

const withDiscount = (items) => {
  let totalPrice = 0;
  let totalDiscount = 0;

  const itemsWithDiscount = items.map((item) => {
    const discount = item.product.discount || 0;
    const originalPrice = item.price * item.quantity;
    const discountAmount = (originalPrice * discount) / 100;
    const finalPrice = originalPrice - discountAmount;

    totalPrice += originalPrice;
    totalDiscount += discountAmount;

    return {
      ...item,
      discount,
      discountedPrice: discount > 0 ? item.price * (1 - discount / 100) : item.price,
      itemTotal: originalPrice,
      itemDiscount: discountAmount,
      itemFinal: finalPrice,
    };
  });

  return { itemsWithDiscount, totalPrice, totalDiscount, finalPrice: totalPrice - totalDiscount };
};

const getCartWithItems = (email) =>
  prisma.cart.findFirst({
    where: { email },
    include: { items: { include: { product: { select: PRODUCT_SELECT } } } },
  });

// Add item to cart
export const addToCart = async (req, res) => {
  const parsed = addToCartSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues[0].message });
  }
  const { productId, quantity, variants } = parsed.data;

  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const product = await prisma.product.findUnique({ where: { id: productId }, include: { options: true } });
    if (!product || product.isArchived) {
      return res.status(404).json({ message: "Product not found" });
    }
    // The stored line price is the configured list price; the cart applies any discount on read,
    // exactly as it did when every product had a single price.
    const linePrice = listPriceWithOptions(product, variants);

    let cart = await prisma.cart.findFirst({ where: { email: user.email }, include: { items: true } });

    if (!cart) {
      cart = await prisma.cart.create({
        data: {
          id: generateId(),
          userId: req.user.id,
          email: user.email,
          items: {
            create: [
              {
                productId,
                quantity: quantity || 1,
                price: linePrice,
                variants: variants || {},
              },
            ],
          },
        },
        include: { items: true },
      });
    } else {
      const existingItem = cart.items.find(
        (item) =>
          item.productId === productId &&
          JSON.stringify(item.variants) === JSON.stringify(variants || {})
      );

      if (existingItem) {
        await prisma.cartItem.update({
          where: { id: existingItem.id },
          data: { quantity: existingItem.quantity + (quantity || 1) },
        });
      } else {
        await prisma.cartItem.create({
          data: {
            cartId: cart.id,
            productId,
            quantity: quantity || 1,
            price: linePrice,
            variants: variants || {},
          },
        });
      }
    }

    // Recalculate and persist totalPrice (was a Mongoose pre-save hook).
    // version bumps atomically on every mutation (#22): proposals pin the
    // version they previewed and execution rejects anything but an exact match.
    const populatedCart = await getCartWithItems(user.email);
    const { itemsWithDiscount, totalPrice, totalDiscount, finalPrice } = withDiscount(populatedCart.items);
    await prisma.cart.update({ where: { id: populatedCart.id }, data: { totalPrice, updatedAt: new Date(), version: { increment: 1 } } });

    res.status(201).json({
      success: true,
      message: "Product added to cart",
      data: {
        ...populatedCart,
        items: itemsWithDiscount,
        totalPrice,
        totalDiscount,
        finalPrice,
      },
    });
  } catch (error) {
    console.error("Error adding to cart:", error);
    res.status(500).json({ message: "Server error while adding to cart" });
  }
};

// Get user's cart
export const getCart = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const cart = await getCartWithItems(user.email);

    if (!cart) {
      return res.status(200).json({
        success: true,
        data: {
          _id: null,
          user: req.user.id,
          email: user.email,
          items: [],
          totalPrice: 0,
          totalDiscount: 0,
          finalPrice: 0,
        },
      });
    }

    const { itemsWithDiscount, totalPrice, totalDiscount, finalPrice } = withDiscount(cart.items);

    res.status(200).json({
      success: true,
      data: {
        ...cart,
        items: itemsWithDiscount,
        totalPrice,
        totalDiscount,
        finalPrice,
      },
    });
  } catch (error) {
    console.error("Error fetching cart:", error);
    res.status(500).json({ message: "Server error while fetching cart" });
  }
};

// Update cart item quantity
export const updateCartItem = async (req, res) => {
  const parsed = updateCartItemSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues[0].message });
  }
  const { productId, quantity } = parsed.data;

  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const cart = await prisma.cart.findFirst({ where: { email: user.email }, include: { items: true } });
    if (!cart) {
      return res.status(404).json({ message: "Cart not found" });
    }

    const item = cart.items.find((item) => item.productId === productId);
    if (!item) {
      return res.status(404).json({ message: "Item not found in cart" });
    }

    if (quantity <= 0) {
      await prisma.cartItem.delete({ where: { id: item.id } });
    } else {
      await prisma.cartItem.update({ where: { id: item.id }, data: { quantity } });
    }

    const populatedCart = await getCartWithItems(user.email);
    const totalPrice = populatedCart.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    await prisma.cart.update({ where: { id: populatedCart.id }, data: { totalPrice, updatedAt: new Date(), version: { increment: 1 } } });

    res.status(200).json({
      success: true,
      message: "Cart updated",
      data: { ...populatedCart, totalPrice },
    });
  } catch (error) {
    console.error("Error updating cart:", error);
    res.status(500).json({ message: "Server error while updating cart" });
  }
};

// Remove item from cart
export const removeFromCart = async (req, res) => {
  const { productId } = req.params;

  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const cart = await prisma.cart.findFirst({ where: { email: user.email }, include: { items: true } });
    if (!cart) {
      return res.status(404).json({ message: "Cart not found" });
    }

    const item = cart.items.find((item) => item.productId === productId);
    if (item) {
      await prisma.cartItem.delete({ where: { id: item.id } });
    }

    const populatedCart = await getCartWithItems(user.email);
    const totalPrice = populatedCart.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    await prisma.cart.update({ where: { id: populatedCart.id }, data: { totalPrice, updatedAt: new Date(), version: { increment: 1 } } });

    res.status(200).json({
      success: true,
      message: "Item removed from cart",
      data: { ...populatedCart, totalPrice },
    });
  } catch (error) {
    console.error("Error removing from cart:", error);
    res.status(500).json({ message: "Server error while removing from cart" });
  }
};

// Clear cart
export const clearCart = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const cart = await prisma.cart.findFirst({ where: { email: user.email } });
    if (!cart) {
      return res.status(404).json({ message: "Cart not found" });
    }

    await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    await prisma.cart.update({ where: { id: cart.id }, data: { totalPrice: 0, updatedAt: new Date(), version: { increment: 1 } } });

    res.status(200).json({
      success: true,
      message: "Cart cleared",
      data: {
        _id: null,
        user: req.user.id,
        email: user.email,
        items: [],
        totalPrice: 0,
      },
    });
  } catch (error) {
    console.error("Error clearing cart:", error);
    res.status(500).json({ message: "Server error while clearing cart" });
  }
};
