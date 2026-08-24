import bcrypt from "bcryptjs";
import { prisma } from "../database/prismaClient.js";
import { generateId } from "./generateId.js";

const DEFAULT_ADMIN_EMAIL = "puspa@gmail.com";
const DEFAULT_ADMIN_PASSWORD = "puspa123";

export const ensureDefaultAdmin = async () => {
  try {
    const adminEmail = (process.env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL).trim().toLowerCase();
    const adminPassword = process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;

    if (!adminEmail || !adminPassword) {
      console.warn("Admin seed skipped: ADMIN_EMAIL or ADMIN_PASSWORD missing");
      return;
    }

    const existingUser = await prisma.user.findUnique({ where: { email: adminEmail } });
    const hashedPassword = await bcrypt.hash(adminPassword, 12);

    if (!existingUser) {
      await prisma.user.create({
        data: {
          id: generateId(),
          firstName: "Puspa",
          lastName: "Admin",
          email: adminEmail,
          password: hashedPassword,
          role: "admin",
          isVerified: true,
        },
      });
      console.log(`✅ Default admin created: ${adminEmail}`);
      return;
    }

    await prisma.user.update({
      where: { id: existingUser.id },
      data: {
        role: "admin",
        password: hashedPassword,
        isVerified: true,
      },
    });

    console.log(`✅ Default admin ensured/updated: ${adminEmail}`);
  } catch (error) {
    console.error("❌ Failed to ensure default admin:", error.message);
  }
};
