import { z } from "zod";
import { prisma } from "../database/prismaClient.js";
import { generateId } from "../utils/generateId.js";
import { parsePagination } from "../utils/pagination.js";
import { hashPassword, verifyPassword, isLegacyHash } from "../utils/password.js";
import { signAccessToken, REFRESH_TOKEN_TTL_MS } from "../utils/tokens.js";
import {
  issueRefreshFamily,
  rotateRefreshToken,
  revokeFamilyByToken,
  revokeAllFamiliesForUser,
  RefreshTokenError,
} from "../utils/refreshTokenStore.js";
import { generateRefreshToken as generateOpaqueToken, hashRefreshToken as hashOpaqueToken } from "../utils/tokens.js";
import { OAuth2Client } from "google-auth-library";
import nodemailer from "nodemailer";
import { sendEmail } from "../utils/emailService.js";

export { authorizeAdmin } from "../middlewares/authMiddleware.js";

const REFRESH_COOKIE_NAME = "refresh_token";
const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict",
  path: "/api/v1/auth",
};

const setRefreshCookie = (res, refreshToken) =>
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    ...REFRESH_COOKIE_OPTIONS,
    maxAge: REFRESH_TOKEN_TTL_MS,
  });

const clearRefreshCookie = (res) => res.clearCookie(REFRESH_COOKIE_NAME, REFRESH_COOKIE_OPTIONS);

// Issues a fresh access token + a new refresh-token family, and sets the cookie.
const issueSession = async (res, user, client = prisma) => {
  const refreshToken = await issueRefreshFamily(user.id, client);
  setRefreshCookie(res, refreshToken);
  return signAccessToken({ id: user.id, role: user.role });
};

const toPublicUser = (user) => ({
  id: user.id,
  email: user.email,
  role: user.role,
  admin: user.role === "admin",
  seller: user.role === "seller",
  sellerVerified: user.role !== "seller" || user.isVerified,
});

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

const sendApprovalEmail = async (seller) => {
  try {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.warn("Email credentials not configured. Skipping approval email.");
      return;
    }
    const transporter = getTransporter();
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: seller.email,
      subject: 'Your ShopSphere Seller Account Has Been Approved!',
      html: `
        <div style="font-family: Arial, sans-serif; background-color: #f5f5f5; padding: 20px;">
          <div style="background-color: white; padding: 30px; border-radius: 8px; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #27ae60; margin-bottom: 20px;">Congratulations! Your Account is Approved</h2>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">Hi ${seller.firstName} ${seller.lastName},</p>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
              Great news! Your seller account for <strong>${seller.shopName}</strong> has been approved by our admin team.
            </p>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">You can now log in and start selling on ShopSphere!</p>
            <div style="background-color: #27ae60; padding: 15px; border-radius: 5px; text-align: center; margin: 20px 0;">
              <a href="http://localhost:5173/seller-auth" style="color: white; text-decoration: none; font-weight: bold; font-size: 16px;">
                Login to Your Seller Panel
              </a>
            </div>
            <p style="color: #999; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
              If you did not apply for a seller account, please ignore this email.<br>ShopSphere Team
            </p>
          </div>
        </div>
      `,
    });
  } catch (error) {
    console.error("Error sending approval email:", error.message);
  }
};

const sendRejectionEmail = async (seller, reason) => {
  try {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.warn("Email credentials not configured. Skipping rejection email.");
      return;
    }
    const transporter = getTransporter();
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: seller.email,
      subject: 'Your ShopSphere Seller Application Status',
      html: `
        <div style="font-family: Arial, sans-serif; background-color: #f5f5f5; padding: 20px;">
          <div style="background-color: white; padding: 30px; border-radius: 8px; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #e74c3c; margin-bottom: 20px;">Application Status Update</h2>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">Hi ${seller.firstName} ${seller.lastName},</p>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
              Thank you for applying to become a seller on ShopSphere. After reviewing your application, we have decided not to approve it at this time.
            </p>
            <div style="background-color: #fff3cd; padding: 15px; border-left: 4px solid #e74c3c; margin: 20px 0;">
              <p style="color: #333; margin: 0;"><strong>Reason for Rejection:</strong><br>${reason || 'Not specified'}</p>
            </div>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
              You are welcome to apply again after addressing the concerns. If you have any questions, please contact our support team.
            </p>
            <p style="color: #999; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">ShopSphere Team</p>
          </div>
        </div>
      `,
    });
  } catch (error) {
    console.error("Error sending rejection email:", error.message);
  }
};

const registerSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  phone: z.string().optional(),
  // Administrative accounts are provisioned out-of-band. Accepting "admin" here would
  // let any unauthenticated visitor grant themselves full control of the demo.
  role: z.enum(["user", "seller"]),
  shopName: z.string().optional(),
  shopDescription: z.string().optional(),
});

export const register = async (req, res, client = prisma) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ code: "invalid_input", message: parsed.error.issues[0].message });
  }
  const { firstName, lastName, phone, password, role, shopName, shopDescription } = parsed.data;
  const email = normalizeEmail(parsed.data.email);

  if (role === "seller" && !shopName) {
    return res.status(400).json({ code: "invalid_input", message: "Shop name is required for sellers" });
  }

  const existingUser = await client.user.findUnique({ where: { email } });
  if (existingUser) {
    return res.status(409).json({ code: "email_taken", message: "User already exists" });
  }

  const userData = {
    id: generateId(),
    firstName,
    lastName,
    phone,
    email,
    password: await hashPassword(password),
    role,
  };

  if (role === "seller") {
    userData.shopName = shopName;
    userData.shopDescription = shopDescription || "";
    userData.isVerified = false;
    userData.verificationRequestDate = new Date();
  } else {
    userData.isVerified = true;
  }

  try {
    const user = await client.user.create({ data: userData });
    const accessToken = await issueSession(res, user, client);
    res.status(201).json({ user: toPublicUser(user), accessToken });
  } catch (error) {
    if (error?.code === "P2002" && error?.meta?.target?.includes("email")) {
      return res.status(409).json({ code: "email_taken", message: "User already exists" });
    }
    console.error("Register error:", error.message);
    res.status(500).json({ code: "internal_error", message: "Server error" });
  }
};

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const login = async (req, res, client = prisma) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ code: "invalid_input", message: parsed.error.issues[0].message });
  }
  const email = normalizeEmail(parsed.data.email);
  const { password } = parsed.data;

  const user = await client.user.findUnique({ where: { email } });
  if (!user || !user.password) {
    return res.status(401).json({ code: "invalid_credentials", message: "Invalid email or password" });
  }

  const isMatch = await verifyPassword(user.password, password);
  if (!isMatch) {
    return res.status(401).json({ code: "invalid_credentials", message: "Invalid email or password" });
  }

  // Opportunistic upgrade: this user still had a pre-argon2 (bcrypt) hash.
  if (isLegacyHash(user.password)) {
    await client.user.update({
      where: { id: user.id },
      data: { password: await hashPassword(password) },
    });
  }

  const accessToken = await issueSession(res, user, client);
  res.status(200).json({ user: toPublicUser(user), accessToken });
};

export const refresh = async (req, res, client = prisma) => {
  const rawToken = req.cookies?.[REFRESH_COOKIE_NAME];
  if (!rawToken) {
    return res.status(401).json({ code: "unauthenticated", message: "No refresh token provided" });
  }

  try {
    const { userId, refreshToken } = await rotateRefreshToken(rawToken, client);
    const user = await client.user.findUnique({ where: { id: userId } });
    if (!user) {
      clearRefreshCookie(res);
      return res.status(401).json({ code: "unauthenticated", message: "User not found" });
    }

    setRefreshCookie(res, refreshToken);
    const accessToken = signAccessToken({ id: user.id, role: user.role });
    res.status(200).json({ user: toPublicUser(user), accessToken });
  } catch (error) {
    if (error instanceof RefreshTokenError) {
      clearRefreshCookie(res);
      return res.status(401).json({ code: "unauthenticated", message: error.message });
    }
    console.error("Refresh error:", error.message);
    res.status(500).json({ code: "internal_error", message: "Server error" });
  }
};

export const logout = async (req, res, client = prisma) => {
  const rawToken = req.cookies?.[REFRESH_COOKIE_NAME];
  if (rawToken) await revokeFamilyByToken(rawToken, client);
  clearRefreshCookie(res);
  res.status(204).send();
};

export const getAllUsers = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ code: "forbidden", message: "Access denied. Admins only." });
    }
    const { paginated, page, pageSize, prismaArgs } = parsePagination(req.query);
    const [users, total] = await Promise.all([
      prisma.user.findMany({ omit: { password: true }, ...prismaArgs }),
      paginated ? prisma.user.count() : Promise.resolve(null),
    ]);

    if (paginated) {
      return res.status(200).json({ items: users, total, page, pageSize });
    }
    res.status(200).json(users);
  } catch (err) {
    res.status(500).json({ code: "internal_error", message: err.message });
  }
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
    res.status(500).json({ code: "internal_error", message: "Server error while fetching sellers" });
  }
};

// Verify a seller
export const verifySeller = async (req, res) => {
  try {
    const { sellerId } = req.params;
    let seller = await prisma.user.findUnique({ where: { id: sellerId } });
    if (!seller || seller.role !== 'seller') {
      return res.status(404).json({ code: "not_found", message: "Seller not found" });
    }

    seller = await prisma.user.update({
      where: { id: sellerId },
      data: { isVerified: true, verificationApprovedDate: new Date() },
    });

    await sendApprovalEmail(seller);

    res.status(200).json({ message: "Seller verified successfully", seller });
  } catch (error) {
    res.status(500).json({ code: "internal_error", message: "Server error while verifying seller" });
  }
};

// Reject a seller
export const rejectSeller = async (req, res) => {
  try {
    const { sellerId } = req.params;
    const { reason } = req.body;

    let seller = await prisma.user.findUnique({ where: { id: sellerId } });
    if (!seller || seller.role !== 'seller') {
      return res.status(404).json({ code: "not_found", message: "Seller not found" });
    }

    seller = await prisma.user.update({
      where: { id: sellerId },
      data: { verificationRejectionReason: reason || "Not specified" },
    });

    await sendRejectionEmail(seller, reason);

    res.status(200).json({ message: "Seller rejection noted", seller });
  } catch (error) {
    res.status(500).json({ code: "internal_error", message: "Server error while rejecting seller" });
  }
};

// Google Sign-In Handler
export const googleSignIn = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ code: "invalid_input", message: "Google token is required" });
    }

    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    const ticket = await client.verifyIdToken({ idToken: token, audience: process.env.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const { sub: googleId, email, email_verified: emailVerified, given_name: firstName, family_name: lastName } = payload;
    if (!email || !emailVerified) {
      return res.status(401).json({ code: "invalid_credentials", message: "Google account email is not verified" });
    }
    const normalizedEmail = normalizeEmail(email);

    let user = await prisma.user.findFirst({ where: { OR: [{ googleId }, { email: normalizedEmail }] } });

    if (!user) {
      user = await prisma.user.create({
        data: {
          id: generateId(),
          firstName: firstName || "User",
          lastName: lastName || "",
          email: normalizedEmail,
          googleId,
          role: "user",
          isVerified: true,
        },
      });
    } else if (!user.googleId) {
      user = await prisma.user.update({ where: { id: user.id }, data: { googleId } });
    }

    const accessToken = await issueSession(res, user);
    res.status(200).json({ user: toPublicUser(user), accessToken });
  } catch (error) {
    if (error?.code === "P2002" && error?.meta?.target?.includes("email")) {
      return res.status(409).json({ code: "email_taken", message: "Email already in use" });
    }
    console.error("Google Sign-In error:", error.message);
    res.status(500).json({ code: "internal_error", message: "Google Sign-In failed" });
  }
};

// Update password
export const updatePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ code: "invalid_input", message: "Both current and new password are required" });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ code: "invalid_input", message: "New password must be at least 8 characters long" });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) {
      return res.status(404).json({ code: "not_found", message: "User not found" });
    }
    if (!user.password) {
      return res.status(400).json({ code: "invalid_input", message: "Cannot change password for Google sign-in accounts" });
    }

    const isMatch = await verifyPassword(user.password, currentPassword);
    if (!isMatch) {
      return res.status(400).json({ code: "invalid_credentials", message: "Current password is incorrect" });
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { password: await hashPassword(newPassword) } });
      await revokeAllFamiliesForUser(user.id, tx);
    });
    clearRefreshCookie(res);
    res.status(200).json({ message: "Password updated successfully" });
  } catch (error) {
    console.error("Error updating password:", error);
    res.status(500).json({ code: "internal_error", message: "Server error while updating password" });
  }
};

const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

const forgotPasswordSchema = z.object({ email: z.string().email() });

// Request a password reset link. Always responds with the same generic message regardless of
// whether the email exists — unlike /register, this endpoint must not confirm account existence.
export const forgotPassword = async (req, res, client = prisma, send = sendEmail) => {
  const parsed = forgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ code: "invalid_input", message: "A valid email is required" });
  }
  const email = normalizeEmail(parsed.data.email);
  const genericResponse = { message: "If an account exists for that email, a reset link has been sent." };

  const user = await client.user.findUnique({ where: { email } });
  // Google-only accounts have no password to reset — silently skip, same generic response.
  if (user && user.password) {
    const rawToken = generateOpaqueToken();
    await client.user.update({
      where: { id: user.id },
      data: {
        resetTokenHash: hashOpaqueToken(rawToken),
        resetTokenExpiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
      },
    });

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    const resetLink = `${frontendUrl}/#/reset-password?token=${rawToken}`;
    send(
      user.email,
      "Reset your ShopSphere password",
      `Reset your password: ${resetLink}\nThis link expires in 1 hour. If you didn't request this, you can ignore this email.`,
      `<div style="font-family: Arial, sans-serif; background-color: #f5f5f5; padding: 20px;">
        <div style="background-color: white; padding: 30px; border-radius: 8px; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #7c3aed; margin-bottom: 20px;">Reset your password</h2>
          <p style="color: #333; font-size: 16px; line-height: 1.6;">Hi ${user.firstName},</p>
          <p style="color: #333; font-size: 16px; line-height: 1.6;">We received a request to reset your ShopSphere password. This link expires in 1 hour.</p>
          <div style="text-align:center;margin:24px 0;">
            <a href="${resetLink}" style="background-color:#7c3aed;color:white;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:bold;">Reset Password</a>
          </div>
          <p style="color: #999; font-size: 12px;">If you didn't request this, you can safely ignore this email — your password won't change.</p>
        </div>
      </div>`
    );
  }

  res.status(200).json(genericResponse);
};

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8),
});

// Complete a password reset. The token is single-use (cleared on success) and expires after
// PASSWORD_RESET_TTL_MS — resetting also revokes every existing refresh-token family, since a
// reset is a signal the account may have been compromised.
export const resetPassword = async (req, res, client = prisma) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ code: "invalid_input", message: parsed.error.issues[0].message });
  }
  const { token, newPassword } = parsed.data;

  const user = await client.user.findUnique({ where: { resetTokenHash: hashOpaqueToken(token) } });
  if (!user || !user.resetTokenExpiresAt || user.resetTokenExpiresAt < new Date()) {
    return res.status(400).json({ code: "invalid_token", message: "This reset link is invalid or has expired" });
  }

  await client.user.update({
    where: { id: user.id },
    data: { password: await hashPassword(newPassword), resetTokenHash: null, resetTokenExpiresAt: null },
  });
  await revokeAllFamiliesForUser(user.id, client);

  res.status(200).json({ message: "Password reset successfully. Please log in with your new password." });
};
