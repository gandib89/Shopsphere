import nodemailer from "nodemailer";

export const sendEmail = async (to, subject, text, html) => {
  // Create transporter lazily so env vars are loaded by the time this runs
  const transporter = nodemailer.createTransport({
    service: "Gmail",
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

