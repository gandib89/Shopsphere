import nodemailer from "nodemailer";

export const sendEmail = async (to, subject, text, html) => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS || process.env.EMAIL_PASS === "your_email_app_password_here") {
    console.warn("Email delivery skipped because SMTP is not configured");
    return;
  }
  // Create transporter lazily so env vars are loaded by the time this runs
  const transporter = nodemailer.createTransport({
    service: "Gmail",
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    disableFileAccess: true,
    disableUrlAccess: true,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to,
    subject,
    text,
    html,
  };

  try {
    console.log("Sending email to:", to);
    await transporter.sendMail(mailOptions);
    console.log("Email sent successfully");
  } catch (error) {
    console.error("Error sending email (non-fatal):", error.message || error);
    // Do NOT throw — email failure should never crash the server or block the purchase flow
  }
};
