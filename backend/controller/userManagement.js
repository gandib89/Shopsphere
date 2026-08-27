import { prisma } from "../database/prismaClient.js";
import nodemailer from "nodemailer";

const normalizeEmail = (email = "") => email.trim().toLowerCase();

// Get transporter for email
const getTransporter = () => {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
};

// Get all users and sellers
export const getAllUsersAndSellers = async (req, res) => {
  try {
    const users = await prisma.user.findMany({ omit: { password: true }, take: 1000 });
    res.status(200).json(users);
  } catch (error) {
    console.error("❌ Error fetching users:", error.message);
    res.status(500).json({ message: "Server error while fetching users", error: error.message });
  }
};

// Get users by role
export const getUsersByRole = async (req, res) => {
  try {
    const { role } = req.params;

    if (!['user', 'seller', 'admin'].includes(role)) {
      return res.status(400).json({ message: "Invalid role" });
    }

    const users = await prisma.user.findMany({ where: { role }, omit: { password: true } });
    res.status(200).json(users);
  } catch (error) {
    console.error("❌ Error fetching users by role:", error.message);
    res.status(500).json({ message: "Server error while fetching users", error: error.message });
  }
};

// Update user details
export const updateUserDetails = async (req, res) => {
  try {
    const { userId } = req.params;
    const { firstName, lastName, email, phone, shopName, shopDescription } = req.body;

    const existingRecord = await prisma.user.findUnique({ where: { id: userId } });
    if (!existingRecord) {
      return res.status(404).json({ message: "User not found" });
    }

    // Update fields
    const data = {};
    if (firstName) data.firstName = firstName;
    if (lastName) data.lastName = lastName;
    if (email && normalizeEmail(email) !== existingRecord.email) {
      const normalizedEmail = normalizeEmail(email);
      // Check if email already exists
      const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
      if (existingUser && existingUser.id !== userId) {
        return res.status(400).json({ message: "Email already in use" });
      }
      data.email = normalizedEmail;
    }
    if (phone) data.phone = phone;
    if (shopName) data.shopName = shopName;
    if (shopDescription) data.shopDescription = shopDescription;

    const user = await prisma.user.update({ where: { id: userId }, data });
    console.log("✅ User updated:", userId);

    res.status(200).json({ message: "User details updated successfully", user });
  } catch (error) {
    console.error("❌ Error updating user:", error.message);
    if (error?.code === "P2002" && error?.meta?.target?.includes("email")) {
      return res.status(400).json({ message: "Email already in use" });
    }
    res.status(500).json({ message: "Server error while updating user", error: error.message });
  }
};

// Delete user
export const deleteUser = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    await prisma.user.delete({ where: { id: userId } });

    console.log("✅ User deleted:", userId, user.email);

    res.status(200).json({
      message: "User deleted successfully",
      deletedUser: user.email
    });
  } catch (error) {
    console.error("❌ Error deleting user:", error.message);
    res.status(500).json({ message: "Server error while deleting user", error: error.message });
  }
};

// Send message to user
export const sendMessageToUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { subject, message } = req.body;

    if (!subject || !message) {
      return res.status(400).json({ message: "Subject and message are required" });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Verify email credentials
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.warn("❌ Email credentials not configured. Cannot send message.");
      return res.status(500).json({ message: "Email service not configured" });
    }

    console.log("📧 Sending message to:", user.email);
    const transporter = getTransporter();

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: subject,
      html: `
        <div style="font-family: Arial, sans-serif; background-color: #f5f5f5; padding: 20px;">
          <div style="background-color: white; padding: 30px; border-radius: 8px; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333; margin-bottom: 20px;">📬 Message from ShopSphere Admin</h2>

            <p style="color: #333; font-size: 16px; line-height: 1.6;">
              Hi ${user.firstName} ${user.lastName},
            </p>

            <div style="background-color: #f9f9f9; padding: 20px; border-left: 4px solid #7c3aed; margin: 20px 0;">
              <p style="color: #333; margin: 0; white-space: pre-wrap; line-height: 1.6;">
                ${message}
              </p>
            </div>

            <p style="color: #999; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
              This is an automated message from ShopSphere Admin Team.
            </p>
          </div>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log("✅ Message sent successfully to:", user.email);

    res.status(200).json({
      message: "Message sent successfully",
      sentTo: user.email
    });
  } catch (error) {
    console.error("❌ Error sending message:", error.message);
    res.status(500).json({ message: "Server error while sending message", error: error.message });
  }
};

// Get user statistics
export const getUserStatistics = async (req, res) => {
  try {
    const totalUsers = await prisma.user.count({ where: { role: "user" } });
    const totalSellers = await prisma.user.count({ where: { role: "seller" } });
    const verifiedSellers = await prisma.user.count({ where: { role: "seller", isVerified: true } });
    const unverifiedSellers = await prisma.user.count({ where: { role: "seller", isVerified: false } });
    const totalAdmins = await prisma.user.count({ where: { role: "admin" } });

    res.status(200).json({
      totalUsers,
      totalSellers,
      verifiedSellers,
      unverifiedSellers,
      totalAdmins,
      totalAccounts: totalUsers + totalSellers + totalAdmins
    });
  } catch (error) {
    console.error("❌ Error fetching statistics:", error.message);
    res.status(500).json({ message: "Server error while fetching statistics", error: error.message });
  }
};
