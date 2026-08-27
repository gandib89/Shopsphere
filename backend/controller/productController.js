import { prisma } from "../database/prismaClient.js";
import { generateId } from "../utils/generateId.js";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import { promisify } from "util";
import { execFile } from "child_process";

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/"); // Save images in the "uploads" folder
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const upload = multer({ storage });

let recommendationCache = null;
let recommendationCacheLoadedAt = 0;
const RECOMMENDATION_CACHE_TTL_MS = 5 * 60 * 1000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RECOMMENDATION_FILE_PATH = path.resolve(
  __dirname,
  "../recommendation/output/recommendations_map.json"
);
const execFileAsync = promisify(execFile);

// Full embedded-doc shape from the old Mongoose schema: colorVariants/storageVariants/reviews
// used to live inline on every Product document, so any endpoint that used to return a whole
// product now needs this include to match the old response shape.
const PRODUCT_FULL_INCLUDE = { colorVariants: true, storageVariants: true, reviews: true };
const SELLER_SELECT = { shopName: true, phone: true, firstName: true, lastName: true };

export const formatProductResponse = (product) => {
  return {
    ...product,
    _id: product._id || product.id,
    category: product.category || "Uncategorized",
  };
};

export const formatRecommendedProducts = (products) => products.map(formatProductResponse);

// Shared by updateProduct/updateSellerProduct, which both used to do a raw
// findByIdAndUpdate(id, req.body) pass-through. colorVariants/storageVariants were embedded
// arrays that got replaced wholesale whenever present in the body, so we mirror that with a
// delete-then-recreate nested write.
const buildProductUpdateData = (body) => {
  const data = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.price !== undefined) data.price = Number(body.price);
  if (body.quantity !== undefined) data.quantity = Number(body.quantity);
  if (body.description !== undefined) data.description = body.description;
  if (body.images !== undefined) data.images = body.images;
  if (body.category !== undefined) data.category = body.category;
  if (body.sellerId !== undefined) data.sellerId = body.sellerId;
  if (body.discount !== undefined) data.discount = Number(body.discount);
  if (body.discountUpdatedAt !== undefined) data.discountUpdatedAt = body.discountUpdatedAt;

  if (body.variants !== undefined) {
    const v = body.variants || {};
    data.variantStorage = v.storage || [];
    data.variantColor = v.color || [];
    data.variantRam = v.ram || [];
    data.variantScreenSize = v.screenSize || [];
    data.variantProcessor = v.processor || [];
  }

  if (body.colorVariants !== undefined) {
    data.colorVariants = {
      deleteMany: {},
      create: (body.colorVariants || []).map((cv) => ({
        color: cv.color,
        images: cv.images || [],
        stock: cv.stock || 0,
      })),
    };
  }

  if (body.storageVariants !== undefined) {
    data.storageVariants = {
      deleteMany: {},
      create: (body.storageVariants || []).map((sv) => ({
        storage: sv.storage,
        stock: sv.stock || 0,
      })),
    };
  }

  return data;
};

const getRecommendationMap = async () => {
  const now = Date.now();
  if (recommendationCache && now - recommendationCacheLoadedAt < RECOMMENDATION_CACHE_TTL_MS) {
    return recommendationCache;
  }

  const raw = await fs.readFile(RECOMMENDATION_FILE_PATH, "utf-8");
  recommendationCache = JSON.parse(raw);
  recommendationCacheLoadedAt = now;
  return recommendationCache;
};

const normalizeRecommendationKey = (value = "") =>
  value
    .toLowerCase()
    .replace(/[\-_]/g, " ")
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const resolveRecommendationCandidates = (productName, recommendationMap) => {
  const entries = Object.entries(recommendationMap || {});
  if (entries.length === 0) return [];

  const normalizedProductName = normalizeRecommendationKey(productName);

  // Try exact normalized match first
  for (const [key, value] of entries) {
    const normalizedKey = normalizeRecommendationKey(key);

    if (normalizedKey === normalizedProductName) {
      return value;
    }
  }

  // Fuzzy match: token-based similarity (Jaccard)
  let bestMatch = null;
  let bestSimilarity = 0;
  let bestKey = null;

  for (const [key, value] of entries) {
    const normalizedKey = normalizeRecommendationKey(key);

    const productTokens = new Set(normalizedProductName.split(" "));
    const keyTokens = new Set(normalizedKey.split(" "));

    const intersection = [...productTokens].filter(token => keyTokens.has(token));
    const union = new Set([...productTokens, ...keyTokens]);
    const similarity = intersection.length / union.size;

    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestMatch = value;
      bestKey = key;
    }
  }

  // Only return matches above 60% similarity
  if (bestSimilarity > 0.6) {
    return bestMatch;
  }

  return [];
};

export const uploadImage = (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ message: "No files uploaded" });
  }

  try {
    const imageUrls = req.files.map((file) => {
      return `${req.protocol}://${req.get("host")}/uploads/${file.filename}`;
    });

    console.log("Uploaded image URLs:", imageUrls); // Debugging
    res.status(200).json({ imageUrls });
  } catch (error) {
    console.error("Error uploading images:", error);
    res.status(500).json({ message: "Server error while uploading images" });
  }
};

export const createProduct = async (req, res) => {
  try {
    const { name, price, description, quantity, images, category, variants, colorVariants, storageVariants } = req.body;

    console.log("Request body:", req.body); // Debugging
    console.log("Color variants received:", colorVariants); // Debugging
    console.log("Storage variants received:", storageVariants); // Debugging

    if (!images || images.length === 0) {
      console.error("No images provided"); // Debugging
      return res.status(400).json({ message: "At least one image is required" });
    }

    if (!category) {
      return res.status(400).json({ message: "Category is required" });
    }

    const v = variants || {};
    const product = await prisma.product.create({
      data: {
        id: generateId(),
        name,
        price: Number(price),
        description,
        quantity: Number(quantity),
        images, // Save the images array
        category, // Save the category
        variantStorage: v.storage || [],
        variantColor: v.color || [],
        variantRam: v.ram || [],
        variantScreenSize: v.screenSize || [],
        variantProcessor: v.processor || [],
        sellerId: req.user.role === 'seller' ? req.user.id : null, // Store seller ID if user is a seller
        colorVariants: {
          create: (colorVariants || []).map((cv) => ({
            color: cv.color,
            images: cv.images || [],
            stock: cv.stock || 0,
          })),
        },
        storageVariants: {
          create: (storageVariants || []).map((sv) => ({
            storage: sv.storage,
            stock: sv.stock || 0,
          })),
        },
      },
      include: PRODUCT_FULL_INCLUDE,
    });

    console.log("Product saved:", product); // Debugging
    console.log("Saved color variants:", product.colorVariants); // Debugging

    // Fan out new-product notifications to all regular users (non-blocking)
    try {
      const allUsers = await prisma.user.findMany({ where: { role: "user" }, select: { id: true } });
      if (allUsers.length > 0) {
        const seller = product.sellerId
          ? await prisma.user.findUnique({ where: { id: product.sellerId }, select: { shopName: true, firstName: true } })
          : null;
        const shopLabel = seller?.shopName || seller?.firstName || "A seller";
        const notifDocs = allUsers.map((u) => ({
          id: generateId(),
          userId: u.id,
          type: "new_product",
          title: "🛒 New Product Added!",
          message: `${shopLabel} just added "${product.name}" — check it out!`,
          productId: product.id,
          productName: product.name,
          productImage: product.images?.[0] || null,
        }));
        await prisma.notification.createMany({ data: notifDocs });
        console.log(`New-product notifications sent to ${allUsers.length} users`);
      }
    } catch (notifErr) {
      console.error("Notification fan-out error (non-fatal):", notifErr);
    }

    res.status(201).json({ message: "Product created successfully", product });
  } catch (error) {
    console.error("Error creating product:", error); // Debugging
    res.status(500).json({ message: "Server error while creating product" });
  }
};

export const getProducts = async (req, res) => {
  console.log("Fetching products...");
  try {
    const products = await prisma.product.findMany({
      include: { seller: { select: SELLER_SELECT }, ...PRODUCT_FULL_INCLUDE },
      take: 1000, // ponytail: hard cap, not real pagination — see order.js getAllOrder note
    });

    // Ensure all products have category (for backward compatibility with old data)
    const enrichedProducts = products.map(formatProductResponse);

    res.status(200).json(enrichedProducts);
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({ message: "Server error while fetching products" });
  }
};

export const getProductById = async (req, res) => {
  try {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
      include: { seller: { select: SELLER_SELECT }, ...PRODUCT_FULL_INCLUDE },
    });
    if (!product) return res.status(404).json({ message: "Product not found" });

    res.status(200).json(formatProductResponse(product));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const updateProduct = async (req, res) => {
  console.log("Updating product with ID:", req.params.id);
  console.log("Request body:", req.body);

  try {
    const { id } = req.params;
    const data = buildProductUpdateData(req.body);

    let updatedProduct;
    try {
      updatedProduct = await prisma.product.update({
        where: { id },
        data,
        include: PRODUCT_FULL_INCLUDE,
      });
    } catch (err) {
      if (err.code === "P2025") {
        return res.status(404).json({ message: "Product not found" });
      }
      throw err;
    }

    res.status(200).json(updatedProduct);
  } catch (error) {
    console.error("Error updating product:", error);
    res.status(500).json({ message: "Server error while updating product" });
  }
};

export const deleteProduct = async (req, res) => {
  try {
    await prisma.product.delete({ where: { id: req.params.id } });
    res.status(200).json({ message: "Product deleted successfully" });
  } catch (error) {
    if (error.code === "P2025") {
      return res.status(404).json({ message: "Product not found" });
    }
    res.status(500).json({ error: error.message });
  }
};

export const searchProducts = async (req, res) => {
  const { type, query } = req.query;

  try {
    let products;

    if (type === "name") {
      // Search by product name (case-insensitive)
      products = await prisma.product.findMany({
        where: { name: { contains: query, mode: "insensitive" } },
        include: PRODUCT_FULL_INCLUDE,
      });
    } else if (type === "category") {
      // Search by category (case-insensitive)
      products = await prisma.product.findMany({
        where: { category: { contains: query, mode: "insensitive" } },
        include: PRODUCT_FULL_INCLUDE,
      });
    } else {
      return res.status(400).json({ message: "Invalid search type" });
    }

    // Ensure all products have category (for backward compatibility with old data)
    const enrichedProducts = products.map(formatProductResponse);

    res.status(200).json(enrichedProducts);
  } catch (error) {
    console.error("Error searching products:", error);
    res.status(500).json({ message: "Server error while searching products" });
  }
};

// Get all products for a specific seller
export const getSellerProducts = async (req, res) => {
  try {
    const sellerId = req.user.id; // Get seller ID from authenticated user
    const products = await prisma.product.findMany({
      where: { sellerId },
      include: PRODUCT_FULL_INCLUDE,
    });

    // Ensure all products have category (for backward compatibility with old data)
    const enrichedProducts = products.map(formatProductResponse);

    res.status(200).json({
      message: "Seller products retrieved successfully",
      products: enrichedProducts,
      count: enrichedProducts.length
    });
  } catch (error) {
    console.error("Error fetching seller products:", error);
    res.status(500).json({ message: "Server error while fetching seller products" });
  }
};

// Update product (only seller can update their own product)
export const updateSellerProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const sellerId = req.user.id;

    const product = await prisma.product.findUnique({ where: { id } });

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    // Check if the seller owns this product
    if (product.sellerId !== sellerId) {
      return res.status(403).json({ message: "You can only update your own products" });
    }

    const data = buildProductUpdateData(req.body);
    const updatedProduct = await prisma.product.update({
      where: { id },
      data,
      include: PRODUCT_FULL_INCLUDE,
    });
    res.status(200).json({
      message: "Product updated successfully",
      product: updatedProduct
    });
  } catch (error) {
    console.error("Error updating seller product:", error);
    res.status(500).json({ message: "Server error while updating product" });
  }
};

// Delete product (only seller can delete their own product)
export const deleteSellerProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const sellerId = req.user.id;

    const product = await prisma.product.findUnique({ where: { id } });

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    // Check if the seller owns this product
    if (product.sellerId !== sellerId) {
      return res.status(403).json({ message: "You can only delete your own products" });
    }

    await prisma.product.delete({ where: { id } });
    res.status(200).json({ message: "Product deleted successfully" });
  } catch (error) {
    console.error("Error deleting seller product:", error);
    res.status(500).json({ message: "Server error while deleting product" });
  }
};

// Add a review to a product
export const addProductReview = async (req, res) => {
  try {
    const { productId } = req.params;
    const { rating, comment, userName, orderId, userId } = req.body;

    // Validate input
    if (!productId || !rating || !comment || !userName) {
      return res.status(400).json({ message: "Missing required fields: productId, rating, comment, userName" });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({ message: "Rating must be between 1 and 5" });
    }

    // Find the product
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: { reviews: true },
    });
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    // Avoid duplicate reviews from the same user/order by updating the existing one when present
    const existingIndex = product.reviews.findIndex((r) => {
      // Prefer strict match on userId + orderId when available
      if (userId && r.userId && r.userId === userId) {
        if (orderId && r.orderId) {
          return r.orderId === orderId;
        }
        return true;
      }
      // Fall back to orderId match
      if (orderId && r.orderId && r.orderId === orderId) {
        return true;
      }
      // Last resort: userName match to reduce accidental duplicates
      return r.userName === userName;
    });

    const newReview = {
      userName,
      userId: userId || null,
      orderId: orderId || null,
      rating: Number(rating),
      comment,
      createdAt: new Date(),
    };

    let savedReview;
    if (existingIndex >= 0) {
      const existing = product.reviews[existingIndex];
      savedReview = await prisma.productReview.update({
        where: { id: existing.id },
        data: newReview,
      });
    } else {
      savedReview = await prisma.productReview.create({
        data: { productId: product.id, ...newReview },
      });
    }

    const updatedProduct = await prisma.product.findUnique({
      where: { id: productId },
      include: PRODUCT_FULL_INCLUDE,
    });

    res.status(existingIndex >= 0 ? 200 : 201).json({
      message: existingIndex >= 0 ? "Review updated" : "Review added successfully",
      review: savedReview,
      product: updatedProduct,
    });
  } catch (error) {
    console.error("Error adding review:", error);
    res.status(500).json({ message: "Server error while adding review" });
  }
};

// Get reviews for a product
export const getProductReviews = async (req, res) => {
  try {
    const { productId } = req.params;

    // Find the product and get its reviews
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { reviews: true },
    });
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    // Sort reviews by date (newest first)
    const sortedReviews = product.reviews.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.status(200).json({
      message: "Reviews retrieved successfully",
      reviews: sortedReviews,
      totalReviews: sortedReviews.length,
      averageRating: sortedReviews.length > 0
        ? (sortedReviews.reduce((sum, r) => sum + r.rating, 0) / sortedReviews.length).toFixed(1)
        : 0,
    });
  } catch (error) {
    console.error("Error fetching reviews:", error);
    res.status(500).json({ message: "Server error while fetching reviews" });
  }
};

// Get product recommendations using Apriori output with category fallback
export const getProductRecommendations = async (req, res) => {
  try {
    const { productId } = req.params;
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 5, 1), 20);

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    let recommendationMap = {};
    try {
      recommendationMap = await getRecommendationMap();
    } catch (error) {
      console.warn("Recommendation map not available, using fallback only:", error.message);
    }

    const aprioriCandidates = resolveRecommendationCandidates(product.name, recommendationMap);
    const aprioriNames = aprioriCandidates.map((candidate) => candidate.item);

    if (aprioriNames.length > 0) {
      // Fetch all products (excluding current) to do fuzzy matching
      const allDbProducts = await prisma.product.findMany({
        where: { id: { not: productId } },
        select: { id: true, name: true, price: true, images: true, category: true, quantity: true },
      });

      // Fuzzy match each recommended name against database products
      const matchedProducts = [];
      const matchedDbIds = new Set(); // prevent same DB product appearing twice
      for (const candidate of aprioriCandidates) {
        const normalizedCandidateName = normalizeRecommendationKey(candidate.item);

        for (const dbProduct of allDbProducts) {
          if (matchedDbIds.has(dbProduct.id)) continue;
          const normalizedDbName = normalizeRecommendationKey(dbProduct.name);

          // Exact normalized match
          if (normalizedDbName === normalizedCandidateName) {
            matchedDbIds.add(dbProduct.id);
            matchedProducts.push({
              ...dbProduct,
              metrics: {
                support: candidate.support,
                confidence: candidate.confidence,
                lift: candidate.lift,
              },
            });
            break;
          }

          // Token-based fuzzy matching with special handling for Apple/iPhone brand synonyms
          const candidateTokens = new Set(normalizedCandidateName.split(" "));
          const dbTokens = new Set(normalizedDbName.split(" "));

          // Treat "iphone", "ipad", "apple" as equivalent brand tokens
          const brandSynonyms = new Set(['iphone', 'ipad', 'apple', 'macbook', 'airpods', 'watch', 'magsafe', 'belkin', 'anker', 'usb', 'lightning']);
          const candidateNonBrandTokens = [...candidateTokens].filter(t => !brandSynonyms.has(t));
          const dbNonBrandTokens = [...dbTokens].filter(t => !brandSynonyms.has(t));

          // Calculate similarity based on non-brand tokens (product type keywords)
          const nonBrandIntersection = candidateNonBrandTokens.filter(t => dbNonBrandTokens.includes(t));
          const nonBrandUnion = new Set([...candidateNonBrandTokens, ...dbNonBrandTokens]);
          const nonBrandSimilarity = nonBrandUnion.size > 0 ? nonBrandIntersection.length / nonBrandUnion.size : 0;

          // Also calculate overall similarity
          const intersection = [...candidateTokens].filter(token => dbTokens.has(token));
          const union = new Set([...candidateTokens, ...dbTokens]);
          const overallSimilarity = intersection.length / union.size;

          // Match if either high overall similarity OR high non-brand similarity (for brand variants)
          if (overallSimilarity > 0.6 || nonBrandSimilarity > 0.75) {
            matchedDbIds.add(dbProduct.id);
            matchedProducts.push({
              ...dbProduct,
              metrics: {
                support: candidate.support,
                confidence: candidate.confidence,
                lift: candidate.lift,
              },
            });
            break;
          }
        }
      }

      // Sort by lift desc → confidence desc → support desc (highest quality first)
      matchedProducts.sort((a, b) => {
        if (b.metrics.lift !== a.metrics.lift) return b.metrics.lift - a.metrics.lift;
        if (b.metrics.confidence !== a.metrics.confidence) return b.metrics.confidence - a.metrics.confidence;
        return b.metrics.support - a.metrics.support;
      });
      const orderedAprioriProducts = matchedProducts.slice(0, limit);

      if (orderedAprioriProducts.length > 0) {
        return res.status(200).json({
          message: "Recommendations retrieved successfully",
          strategy: "apriori",
          sourceProduct: {
            _id: product.id,
            name: product.name,
            category: product.category,
          },
          recommendations: formatRecommendedProducts(orderedAprioriProducts),
        });
      }
    }

    const fallbackProducts = await prisma.product.findMany({
      where: {
        category: product.category,
        id: { not: productId },
        quantity: { gt: 0 },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, name: true, price: true, images: true, category: true, quantity: true },
    });

    return res.status(200).json({
      message: "Recommendations retrieved successfully",
      strategy: "category-fallback",
      sourceProduct: {
        _id: product.id,
        name: product.name,
        category: product.category,
      },
      recommendations: formatRecommendedProducts(fallbackProducts),
    });
  } catch (error) {
    console.error("Error fetching recommendations:", error);
    return res.status(500).json({ message: "Server error while fetching recommendations" });
  }
};

// Admin: retrain Apriori recommendation model and regenerate output artifacts
export const retrainProductRecommendations = async (req, res) => {
  try {
    const requestedMinSupport = Number(req.body?.minSupport);
    const requestedMinConfidence = Number(req.body?.minConfidence);
    const requestedTopK = Number(req.body?.topK);

    const minSupport = Number.isFinite(requestedMinSupport) && requestedMinSupport > 0 && requestedMinSupport <= 1
      ? requestedMinSupport
      : 0.005;
    const minConfidence = Number.isFinite(requestedMinConfidence) && requestedMinConfidence > 0 && requestedMinConfidence <= 1
      ? requestedMinConfidence
      : 0.25;
    const topK = Number.isFinite(requestedTopK) && requestedTopK >= 1 && requestedTopK <= 20
      ? Math.floor(requestedTopK)
      : 10;

    const recommendationDir = path.resolve(__dirname, "../recommendation");
    const scriptPath = path.resolve(recommendationDir, "train_apriori.py");
    const datasetPath = path.resolve(
      recommendationDir,
      "data/Final_Apple_Apriori_Dataset.csv"
    );
    const outputDir = path.resolve(recommendationDir, "output");

    const venvPythonPath = path.resolve(__dirname, "../../.venv/bin/python");
    let pythonCommand = "python3";

    try {
      await fs.access(venvPythonPath);
      pythonCommand = venvPythonPath;
    } catch {
      pythonCommand = "python3";
    }

    await fs.access(scriptPath);
    await fs.access(datasetPath);

    const { stdout, stderr } = await execFileAsync(
      pythonCommand,
      [
        scriptPath,
        "--input",
        datasetPath,
        "--output-dir",
        outputDir,
        "--min-support",
        String(minSupport),
        "--min-confidence",
        String(minConfidence),
        "--top-k",
        String(topK),
      ],
      { cwd: recommendationDir, maxBuffer: 1024 * 1024 * 10 }
    );

    recommendationCache = null;
    recommendationCacheLoadedAt = 0;

    return res.status(200).json({
      message: "Recommendation model retrained successfully",
      pythonCommand,
      parameters: {
        minSupport,
        minConfidence,
        topK,
      },
      outputPath: outputDir,
      stdout: (stdout || "").slice(-3000),
      stderr: (stderr || "").slice(-3000),
    });
  } catch (error) {
    console.error("Error retraining recommendation model:", error);
    return res.status(500).json({
      message: "Failed to retrain recommendation model",
      error: error.message,
    });
  }
};

// Set discount on a product and notify users who have it in cart
export const setProductDiscount = async (req, res) => {
  try {
    const { productId } = req.params;
    const { discount } = req.body;
    const sellerId = req.user.id;

    // Validate discount percentage
    if (discount < 0 || discount > 100) {
      return res.status(400).json({ message: "Discount must be between 0 and 100" });
    }

    // Find the product and verify seller ownership
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    if (product.sellerId !== sellerId) {
      return res.status(403).json({ message: "You are not authorized to set discount on this product" });
    }

    // Update product discount
    const updatedProduct = await prisma.product.update({
      where: { id: productId },
      data: { discount: Number(discount), discountUpdatedAt: new Date() },
    });

    // If discount is greater than 0, notify users who have this product in their cart
    if (discount > 0) {
      // Find all carts containing this product
      const carts = await prisma.cart.findMany({
        where: { items: { some: { productId } } },
      });

      // Create notifications for each user
      const notifications = carts.map(cart => ({
        id: generateId(),
        userId: cart.userId,
        type: "discount",
        title: `${discount}% Discount on ${updatedProduct.name}!`,
        message: `Great news! The ${updatedProduct.name} in your cart now has a ${discount}% discount. Check it out before the offer ends!`,
        productId: updatedProduct.id,
        productName: updatedProduct.name,
        productImage: updatedProduct.images && updatedProduct.images.length > 0 ? updatedProduct.images[0] : null,
      }));

      if (notifications.length > 0) {
        await prisma.notification.createMany({ data: notifications });
      }

      return res.status(200).json({
        message: `Discount of ${discount}% set successfully`,
        notifiedUsers: notifications.length,
        product: {
          _id: updatedProduct.id,
          name: updatedProduct.name,
          price: updatedProduct.price,
          discount: updatedProduct.discount,
          discountedPrice: updatedProduct.price * (1 - discount / 100)
        }
      });
    } else {
      return res.status(200).json({
        message: "Discount removed successfully",
        product: {
          _id: updatedProduct.id,
          name: updatedProduct.name,
          price: updatedProduct.price,
          discount: updatedProduct.discount
        }
      });
    }
  } catch (error) {
    console.error("Error setting product discount:", error);
    return res.status(500).json({
      message: "Failed to set product discount",
      error: error.message
    });
  }
};
