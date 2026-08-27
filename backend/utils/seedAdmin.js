import bcrypt from "bcryptjs";
import { prisma } from "../database/prismaClient.js";
import { generateId } from "./generateId.js";

const verifyAdminRole = (account, email) => {
  if (account.role !== "admin") {
    throw new Error(`${email} already belongs to role ${account.role}; expected admin`);
  }
  return { status: "existing", email };
};

export const bootstrapAdmin = async ({ client, email, password }) => {
  const normalizedEmail = (email || "").trim().toLowerCase();
  if (!normalizedEmail || !password) {
    return { status: "skipped", reason: "missing-config" };
  }

  const existingUser = await client.user.findUnique({ where: { email: normalizedEmail } });
  if (existingUser) {
    return verifyAdminRole(existingUser, normalizedEmail);
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  try {
    await client.user.create({
      data: {
        id: generateId(),
        firstName: "ShopSphere",
        lastName: "Admin",
        email: normalizedEmail,
        password: hashedPassword,
        role: "admin",
        isVerified: true,
      },
    });
  } catch (error) {
    if (error?.code !== "P2002") throw error;
    const concurrentUser = await client.user.findUnique({ where: { email: normalizedEmail } });
    if (!concurrentUser) throw error;
    return verifyAdminRole(concurrentUser, normalizedEmail);
  }
  return { status: "created", email: normalizedEmail };
};

export const ensureDefaultAdmin = async () => {
  const result = await bootstrapAdmin({
    client: prisma,
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  });

  if (result.status === "skipped") {
    console.warn("Admin bootstrap skipped: explicit ADMIN_EMAIL and ADMIN_PASSWORD are required");
  } else if (result.status === "created") {
    console.log(`✅ Configured admin created: ${result.email}`);
  } else {
    console.log(`✅ Configured admin already exists: ${result.email}`);
  }

  return result;
};
