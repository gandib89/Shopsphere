import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { prisma } from "../database/prismaClient.js";

dotenv.config();

export const verifyToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Access denied. No token provided." });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      console.error("Token verification failed:", err.message);
      return res.status(403).json({ message: "Invalid token" });
    }

    console.log("Token verified. User:", { id: user.id, role: user.role });
    req.user = user; 
    next();
  });
};

export const authorizeAdmin = (req, res, next) => {
  if (req.user.role !== "admin") {
    console.warn("Access denied. User role is not admin:", req.user.role);
    return res.status(403).json({ message: "Access denied. Admins only." });
  }
  next();
};

export const authorizeSeller = (req, res, next) => {
  if (req.user.role !== "seller") {
    console.warn("Access denied. User role is not seller:", req.user.role);
    return res.status(403).json({ message: "Access denied. Sellers only." });
  }
  console.log("Seller access granted for user:", req.user.id);
  next();
};

// Check if seller is verified before allowing product operations
export const checkSellerVerification = async (req, res, next) => {
  try {
    const seller = await prisma.user.findUnique({ where: { id: req.user.id } });
    
    if (!seller || seller.role !== "seller") {
      return res.status(403).json({ message: "Seller not found" });
    }
    
    if (!seller.isVerified) {
      return res.status(403).json({ 
        message: "Your account is pending admin verification. You cannot perform this action until approved.",
        sellerVerified: false 
      });
    }
    
    next();
  } catch (error) {
    console.error("Error checking seller verification:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const isAuthenticated = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // Attach user details to the request
    next();
  } catch (error) {
    console.error("Token verification failed in isAuthenticated:", error.message);
    return res.status(401).json({ message: "Invalid token" });
  }
};


