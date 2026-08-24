import { response } from "express";
import { prisma } from "../database/prismaClient.js";
import { generateId } from "../utils/generateId.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import nodemailer from "nodemailer";

// Normalize emails to avoid case/whitespace mismatches
const normalizeEmail = (email = "") => email.trim().toLowerCase();

// Email transporter setup - created dynamically to ensure env vars are loaded
const getTransporter = () => {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
};

// Helper function to send approval email
const sendApprovalEmail = async (seller) => {
  try {
    // Verify env variables are set
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.warn("❌ Email credentials not configured. Skipping approval email.");
      console.warn("EMAIL_USER:", process.env.EMAIL_USER ? "✅" : "❌");
      console.warn("EMAIL_PASS:", process.env.EMAIL_PASS ? "✅" : "❌");
      return;
    }

    console.log("📧 Sending approval email to:", seller.email);
    const transporter = getTransporter();
    
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: seller.email,
      subject: '✅ Your ShopSphere Seller Account Has Been Approved!',
      html: `
        <div style="font-family: Arial, sans-serif; background-color: #f5f5f5; padding: 20px;">
          <div style="background-color: white; padding: 30px; border-radius: 8px; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #27ae60; margin-bottom: 20px;">🎉 Congratulations! Your Account is Approved</h2>
            
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
              Hi ${seller.firstName} ${seller.lastName},
            </p>
            
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
              Great news! Your seller account for <strong>${seller.shopName}</strong> has been approved by our admin team.
            </p>
            
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
              You can now log in and start selling on ShopSphere!
            </p>
            
            <div style="background-color: #27ae60; padding: 15px; border-radius: 5px; text-align: center; margin: 20px 0;">
              <a href="http://localhost:5173/seller-auth" style="color: white; text-decoration: none; font-weight: bold; font-size: 16px;">
                👉 Login to Your Seller Panel
              </a>
            </div>
            
            <p style="color: #666; font-size: 14px; line-height: 1.6;">
              <strong>What's Next?</strong><br>
              1. Upload your products<br>
              2. Manage your inventory<br>
              3. Track orders and revenue<br>
              4. Start earning!
            </p>
            
            <p style="color: #999; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
              If you did not apply for a seller account, please ignore this email.<br>
              ShopSphere Team
            </p>
          </div>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log("✅ Approval email sent successfully to:", seller.email);
  } catch (error) {
    console.error("❌ Error sending approval email:", error.message);
    console.error("Full error:", error);
    // Don't throw error, just log it
  }
};

// Helper function to send rejection email
const sendRejectionEmail = async (seller, reason) => {
  try {
    // Verify env variables are set
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.warn("❌ Email credentials not configured. Skipping rejection email.");
      console.warn("EMAIL_USER:", process.env.EMAIL_USER ? "✅" : "❌");
      console.warn("EMAIL_PASS:", process.env.EMAIL_PASS ? "✅" : "❌");
      return;
    }

    console.log("📧 Sending rejection email to:", seller.email);
    const transporter = getTransporter();
    
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: seller.email,
      subject: '❌ Your ShopSphere Seller Application Status',
      html: `
        <div style="font-family: Arial, sans-serif; background-color: #f5f5f5; padding: 20px;">
          <div style="background-color: white; padding: 30px; border-radius: 8px; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #e74c3c; margin-bottom: 20px;">📋 Application Status Update</h2>
            
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
              Hi ${seller.firstName} ${seller.lastName},
            </p>
            
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
              Thank you for applying to become a seller on ShopSphere. After reviewing your application, we have decided not to approve it at this time.
            </p>
            
            <div style="background-color: #fff3cd; padding: 15px; border-left: 4px solid #e74c3c; margin: 20px 0;">
              <p style="color: #333; margin: 0;">
                <strong>Reason for Rejection:</strong><br>
                ${reason || 'Not specified'}
              </p>
            </div>
            
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
              You are welcome to apply again after addressing the concerns. If you have any questions, please contact our support team.
            </p>
            
            <p style="color: #999; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
              ShopSphere Team
            </p>
          </div>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log("✅ Rejection email sent successfully to:", seller.email);
  } catch (error) {
    console.error("❌ Error sending rejection email:", error.message);
    console.error("Full error:", error);
    // Don't throw error, just log it
  }
};

export const signup = async (req, res) => {
  console.log("Signup endpoint hit");
  try {
    const { firstName, lastName, email, phone, password, role, shopName, shopDescription } = req.body;

    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      return res.status(400).json({ message: "Email is required" });
    }

    console.log("Signup request received:", { firstName, lastName, email: normalizedEmail, phone, role });

    if (!['user', 'admin', 'seller'].includes(role)) {
      console.log("Invalid role:", role);
      return res.status(400).json({ message: "Invalid role selected" });
    }

    if (role === 'seller' && !shopName) {
      return res.status(400).json({ message: "Shop name is required for sellers" });
    }

    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingUser) {
      console.log("User already exists with email:", email);
      return res.status(400).json({ message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const userData = { id: generateId(), firstName, lastName, phone, email: normalizedEmail, password: hashedPassword, role };

    if (role === 'seller') {
      userData.shopName = shopName;
      userData.shopDescription = shopDescription || "";
      userData.isVerified = false; // Sellers need verification
      userData.verificationRequestDate = new Date();
    } else {
      userData.isVerified = true; // Regular users are verified by default
    }

    const newUser = await prisma.user.create({ data: userData });

    console.log("User registered successfully:", newUser);
    res.status(201).json({ message: "User registered successfully" });
  } catch (error) {
    console.error("Signup error:", error.message);
    if (error?.code === "P2002" && error?.meta?.target?.includes("email")) {
      return res.status(400).json({ message: "User already exists" });
    }
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

export const getAllUsers = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Access denied. Admins only." });
    }

    const users = await prisma.user.findMany({ omit: { password: true } });
    res.status(200).json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const signin = async (req, res) => {
  console.log("Signin endpoint hit");
  try {
    const { email, password, role } = req.body;
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      return res.status(400).json({ message: "Email is required" });
    }

    console.log("Signin request received:", { email: normalizedEmail, role });

    if (!['user', 'admin', 'seller'].includes(role)) {
      console.log("Invalid role:", role);
      return res.status(400).json({ message: "Invalid role selected" });
    }

    const user = await prisma.user.findFirst({ where: { email: normalizedEmail, role } });
    if (!user) {
      console.log("User not found:", email);
      return res.status(400).json({ message: "Invalid email or role" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.log("Password mismatch for user:", email);
      return res.status(400).json({ message: "Invalid password" });
    }

    const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, {
      expiresIn: "30d",
    });

    // If seller, check if verified
    let isSellerVerified = true;
    if (user.role === "seller" && !user.isVerified) {
      isSellerVerified = false;
    }

    res.status(200).json({ 
      message: "Login successful", 
      token, 
      admin: user.role === "admin",
      seller: user.role === "seller",
      sellerVerified: isSellerVerified,
      userId: user.id
    });
  } catch (error) {
    console.error("Signin error:", error.message);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ message: "Access denied. No token provided." });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: "Invalid token" });
    req.user = user;
    next();
  });
};

export const authorizeAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: "Access denied. Admins only." });
  }
  next();
};

export const authorizeSeller = (req, res, next) => {
  if (req.user.role !== 'seller') {
    return res.status(403).json({ message: "Access denied. Sellers only." });
  }
  next();
};

// Get all unverified sellers
export const getUnverifiedSellers = async (req, res) => {
  try {
    const unverifiedSellers = await prisma.user.findMany({
      where: { role: 'seller', isVerified: false },
      omit: { password: true },
    });
    res.status(200).json(unverifiedSellers);
  } catch (error) {
    console.error("Error fetching unverified sellers:", error);
    res.status(500).json({ message: "Server error while fetching sellers" });
  }
};

// Verify a seller
export const verifySeller = async (req, res) => {
  try {
    const { sellerId } = req.params;
    console.log("🔄 Attempting to verify seller:", sellerId);
    
    let seller = await prisma.user.findUnique({ where: { id: sellerId } });
    if (!seller || seller.role !== 'seller') {
      console.log("❌ Seller not found:", sellerId);
      return res.status(404).json({ message: "Seller not found" });
    }

    seller = await prisma.user.update({
      where: { id: sellerId },
      data: { isVerified: true, verificationApprovedDate: new Date() },
    });
    console.log("✅ Seller marked as verified in database:", seller.email);

    // Send approval email
    console.log("📧 Initiating approval email...");
    await sendApprovalEmail(seller);

    res.status(200).json({
      message: "Seller verified successfully",
      seller
    });
  } catch (error) {
    console.error("❌ Error verifying seller:", error.message);
    console.error("Full error:", error);
    res.status(500).json({ message: "Server error while verifying seller", error: error.message });
  }
};

// Reject a seller
export const rejectSeller = async (req, res) => {
  try {
    const { sellerId } = req.params;
    const { reason } = req.body;
    console.log("🔄 Attempting to reject seller:", sellerId);
    
    let seller = await prisma.user.findUnique({ where: { id: sellerId } });
    if (!seller || seller.role !== 'seller') {
      console.log("❌ Seller not found:", sellerId);
      return res.status(404).json({ message: "Seller not found" });
    }

    seller = await prisma.user.update({
      where: { id: sellerId },
      data: { verificationRejectionReason: reason || "Not specified" },
    });
    console.log("✅ Seller rejection saved to database:", seller.email);

    // Send rejection email
    console.log("📧 Initiating rejection email...");
    await sendRejectionEmail(seller, reason);

    res.status(200).json({
      message: "Seller rejection noted",
      seller
    });
  } catch (error) {
    console.error("❌ Error rejecting seller:", error.message);
    console.error("Full error:", error);
    res.status(500).json({ message: "Server error while rejecting seller", error: error.message });
  }
};

// Google Sign-In Handler
export const googleSignIn = async (req, res) => {
  console.log("Google Sign-In endpoint hit");
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ message: "Google token is required" });
    }

    // Initialize OAuth2 client
    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

    // Verify token
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { sub: googleId, email, given_name: firstName, family_name: lastName } = payload;

    const normalizedEmail = normalizeEmail(email);

    console.log("Google payload verified:", { googleId, email: normalizedEmail, firstName, lastName });

    // Check if user exists by googleId or email
    let user = await prisma.user.findFirst({ where: { OR: [{ googleId }, { email: normalizedEmail }] } });

    if (!user) {
      // Create new user with Google credentials
      user = await prisma.user.create({
        data: {
          id: generateId(),
          firstName: firstName || "User",
          lastName: lastName || "",
          email: normalizedEmail,
          googleId,
          role: "user",
          isVerified: true, // Regular users are verified by default
        },
      });
      console.log("New user created via Google:", user.id);
    } else if (!user.googleId) {
      // Link Google ID to existing user
      user = await prisma.user.update({ where: { id: user.id }, data: { googleId } });
      console.log("Google ID linked to existing user:", user.id);
    }

    // Generate JWT token
    const jwtToken = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, {
      expiresIn: "30d",
    });

    res.status(200).json({
      message: "Google Sign-In successful",
      token: jwtToken,
      admin: user.role === "admin",
      seller: user.role === "seller",
      userId: user.id,
    });
  } catch (error) {
    console.error("Google Sign-In error:", error.message);
    if (error?.code === "P2002" && error?.meta?.target?.includes("email")) {
      return res.status(400).json({ message: "Email already in use" });
    }
    res.status(500).json({ message: "Google Sign-In failed", error: error.message });
  }
};

// Update password
export const updatePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "Both current and new password are required" });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: "New password must be at least 6 characters long" });
    }

    // Find user
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if user signed up with Google (no password set)
    if (!user.password) {
      return res.status(400).json({ message: "Cannot change password for Google sign-in accounts" });
    }

    // Verify current password
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Current password is incorrect" });
    }

    // Hash new password and update
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: user.id }, data: { password: hashedPassword } });

    res.status(200).json({ message: "Password updated successfully" });
  } catch (error) {
    console.error("Error updating password:", error);
    res.status(500).json({ message: "Server error while updating password" });
  }
};
