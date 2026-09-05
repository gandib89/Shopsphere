import { prisma } from "../database/prismaClient.js";
import { verifyAccessToken } from "../utils/tokens.js";

export const authenticate = async (req, res, next, client = prisma) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ code: "unauthenticated", message: "No token provided" });
  }

  try {
    const payload = verifyAccessToken(token);
    const account = await client.user.findUnique({ where: { id: payload.sub }, select: { id: true, role: true } });
    if (!account) return res.status(401).json({ code: "unauthenticated", message: "This account no longer exists" });
    req.userId = payload.sub;
    req.user = { id: payload.sub, role: account.role };
    next();
  } catch (err) {
    return res.status(401).json({ code: "unauthenticated", message: "Invalid or expired token" });
  }
};

// Kept as an alias: every existing route file imports `verifyToken` by name.
export const verifyToken = authenticate;
export const isAuthenticated = authenticate;

export const authorizeAdmin = (req, res, next) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ code: "forbidden", message: "Admins only" });
  }
  next();
};

export const authorizeSeller = (req, res, next) => {
  if (req.user.role !== "seller") {
    return res.status(403).json({ code: "forbidden", message: "Sellers only" });
  }
  next();
};

// Admins have full oversight of the marketplace, so anything seller-scoped also allows admin.
export const authorizeSellerOrAdmin = (req, res, next) => {
  if (req.user.role !== "seller" && req.user.role !== "admin") {
    return res.status(403).json({ code: "forbidden", message: "Sellers or admins only" });
  }
  next();
};

// Check if seller is verified before allowing product operations
export const checkSellerVerification = async (req, res, next) => {
  try {
    const seller = await prisma.user.findUnique({ where: { id: req.user.id } });

    if (!seller || seller.role !== "seller") {
      return res.status(403).json({ code: "forbidden", message: "Seller not found" });
    }

    if (!seller.isVerified) {
      return res.status(403).json({
        code: "forbidden",
        message: "Your account is pending admin verification. You cannot perform this action until approved.",
        sellerVerified: false,
      });
    }

    next();
  } catch (error) {
    return res.status(500).json({ code: "internal_error", message: "Server error" });
  }
};
