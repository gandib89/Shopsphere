import express from "express";
import nodemailer from "nodemailer";
import { verifyToken, authorizeAdmin } from "../middlewares/authMiddleware.js";

const router = express.Router();

// Debug endpoint for verifying SMTP config — admin-only, since it sends real email through
// the server's own credentials and was previously reachable by anyone on the internet.
router.post("/test-email", verifyToken, authorizeAdmin, async (req, res) => {
  try {
    const { testEmail } = req.body;
    const recipientEmail = testEmail || process.env.ADMIN_EMAIL;

    console.log("=== EMAIL TEST START ===");
    console.log("Recipient:", recipientEmail);
    console.log("EMAIL_USER:", process.env.EMAIL_USER);
    console.log("EMAIL_PASS exists:", !!process.env.EMAIL_PASS);
    console.log("EMAIL_PASS length:", process.env.EMAIL_PASS?.length);

    // Create transporter
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    // Verify connection
    console.log("Verifying SMTP connection...");
    await transporter.verify();
    console.log("✅ SMTP connection verified successfully");

    // Send test email
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: recipientEmail,
      subject: "🧪 ShopSphere Email Test",
      text: "If you receive this, nodemailer is working correctly!",
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f0f0f0;">
          <div style="background-color: white; padding: 30px; border-radius: 10px; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #27ae60;">✅ Email Test Successful!</h1>
            <p style="font-size: 16px; color: #333;">
              This is a test email from ShopSphere. If you're seeing this, your nodemailer configuration is working correctly!
            </p>
            <p style="font-size: 14px; color: #666;">
              Sent at: ${new Date().toLocaleString()}
            </p>
          </div>
        </div>
      `,
    };

    console.log("Sending test email...");
    const info = await transporter.sendMail(mailOptions);
    console.log("✅ Email sent successfully!");
    console.log("Message ID:", info.messageId);
    console.log("Response:", info.response);
    console.log("=== EMAIL TEST END ===");

    res.status(200).json({
      success: true,
      message: "Test email sent successfully",
      messageId: info.messageId,
      recipient: recipientEmail,
    });
  } catch (error) {
    console.error("❌ EMAIL TEST FAILED");
    console.error("Error name:", error.name);
    console.error("Error message:", error.message);
    console.error("Error code:", error.code);
    console.error("Full error:", error);
    console.log("=== EMAIL TEST END ===");

    res.status(500).json({
      success: false,
      message: "Failed to send test email",
    });
  }
});

export default router;
