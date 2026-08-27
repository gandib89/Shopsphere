import { prisma } from "../database/prismaClient.js";
import { generateId } from "../utils/generateId.js";
import { sendEmail } from "../utils/emailService.js";

// Create revenue record when order is placed
export const createRevenueRecord = async (req, res) => {
  const orderId = typeof req.body?.orderId === "string" ? req.body.orderId : "";
  if (!orderId) {
    return res.status(400).json({ message: "orderId is required" });
  }

  try {
    // Find the order
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { product: true },
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Calculate commission and revenue
    const totalSalePrice = order.totalPrice;
    const adminCommission = totalSalePrice * 0.05; // 5% admin commission
    const sellerRevenue = totalSalePrice * 0.95; // 95% goes to seller

    // Get current month and year
    const now = new Date();
    const month = now.getMonth() + 1; // 1-12
    const year = now.getFullYear();

    // Create revenue record
    const revenue = await prisma.revenue.create({
      data: {
        id: generateId(),
        orderId: order.id,
        sellerId: order.product.sellerId,
        adminId: null, // Will be filled by admin dashboard
        productId: order.product.id,
        totalSalePrice,
        adminCommission,
        sellerRevenue,
        transactionDate: new Date(),
        month,
        year,
        status: "Completed"
      },
    });

    res.status(201).json({
      message: "Revenue record created successfully",
      revenue
    });
  } catch (error) {
    console.error("Error creating revenue record:", error);
    res.status(500).json({ message: "Server error while creating revenue record" });
  }
};

// Get monthly revenue for admin
export const getAdminMonthlyRevenue = async (req, res) => {
  try {
    const { month, year } = req.query;

    const matchMonth = month ? parseInt(month) : new Date().getMonth() + 1;
    const matchYear = year ? parseInt(year) : new Date().getFullYear();

    // Get all revenue records for the month
    const revenues = await prisma.revenue.findMany({
      where: {
        month: matchMonth,
        year: matchYear,
        status: "Completed"
      },
      include: {
        seller: { select: { shopName: true, email: true } },
        product: { select: { name: true, price: true } },
      },
    });

    // Calculate totals
    const totalSalePrice = revenues.reduce((sum, r) => sum + r.totalSalePrice, 0);
    const totalAdminCommission = revenues.reduce((sum, r) => sum + r.adminCommission, 0);
    const totalSellerRevenue = revenues.reduce((sum, r) => sum + r.sellerRevenue, 0);

    res.status(200).json({
      message: "Admin monthly revenue retrieved successfully",
      month: matchMonth,
      year: matchYear,
      revenues,
      totals: {
        totalSalePrice,
        totalAdminCommission,
        totalSellerRevenue,
        orderCount: revenues.length
      }
    });
  } catch (error) {
    console.error("Error fetching admin monthly revenue:", error);
    res.status(500).json({ message: "Server error while fetching revenue" });
  }
};

// Get seller's monthly revenue
export const getSellerMonthlyRevenue = async (req, res) => {
  try {
    const sellerId = req.user.id;
    const { month, year } = req.query;

    const matchMonth = month ? parseInt(month) : new Date().getMonth() + 1;
    const matchYear = year ? parseInt(year) : new Date().getFullYear();

    // Get all revenue records for this seller for the month
    const revenues = await prisma.revenue.findMany({
      where: {
        sellerId,
        month: matchMonth,
        year: matchYear,
        status: "Completed"
      },
      include: {
        product: { select: { name: true, price: true, category: true } },
        order: { select: { quantity: true, deliveryDate: true } },
      },
    });

    // Calculate totals
    const totalSalePrice = revenues.reduce((sum, r) => sum + r.totalSalePrice, 0);
    const totalAdminCommission = revenues.reduce((sum, r) => sum + r.adminCommission, 0);
    const totalSellerRevenue = revenues.reduce((sum, r) => sum + r.sellerRevenue, 0);

    // Get top products by revenue
    const topProducts = {};
    revenues.forEach(r => {
      const productName = r.product?.name || 'Unknown';
      if (!topProducts[productName]) {
        topProducts[productName] = 0;
      }
      topProducts[productName] += r.totalSalePrice;
    });

    const topProductsList = Object.entries(topProducts)
      .map(([name, revenue]) => ({ name, revenue }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    res.status(200).json({
      message: "Seller monthly revenue retrieved successfully",
      month: matchMonth,
      year: matchYear,
      revenues,
      totals: {
        totalSalePrice,
        totalAdminCommission,
        totalSellerRevenue,
        orderCount: revenues.length
      },
      topProducts: topProductsList
    });
  } catch (error) {
    console.error("Error fetching seller monthly revenue:", error);
    res.status(500).json({ message: "Server error while fetching seller revenue" });
  }
};

// Get admin's total revenue (all time)
export const getAdminTotalRevenue = async (req, res) => {
  try {
    // Get all completed revenue records
    const revenues = await prisma.revenue.findMany({
      where: {
        status: "Completed"
      },
    });

    const totalSalePrice = revenues.reduce((sum, r) => sum + r.totalSalePrice, 0);
    const totalAdminCommission = revenues.reduce((sum, r) => sum + r.adminCommission, 0);
    const totalSellerRevenue = revenues.reduce((sum, r) => sum + r.sellerRevenue, 0);

    // Group by month and year
    const monthlyBreakdown = {};
    revenues.forEach(r => {
      const key = `${r.year}-${String(r.month).padStart(2, '0')}`;
      if (!monthlyBreakdown[key]) {
        monthlyBreakdown[key] = { totalSalePrice: 0, adminCommission: 0, orderCount: 0 };
      }
      monthlyBreakdown[key].totalSalePrice += r.totalSalePrice;
      monthlyBreakdown[key].adminCommission += r.adminCommission;
      monthlyBreakdown[key].orderCount += 1;
    });

    res.status(200).json({
      message: "Admin total revenue retrieved successfully",
      totals: {
        totalSalePrice,
        totalAdminCommission,
        totalSellerRevenue,
        totalOrders: revenues.length
      },
      monthlyBreakdown
    });
  } catch (error) {
    console.error("Error fetching admin total revenue:", error);
    res.status(500).json({ message: "Server error while fetching total revenue" });
  }
};

// Get seller's total revenue (all time)
export const getSellerTotalRevenue = async (req, res) => {
  try {
    const sellerId = req.user.id;

    // Get all completed revenue records for this seller
    const revenues = await prisma.revenue.findMany({
      where: {
        sellerId,
        status: "Completed"
      },
    });

    const totalSalePrice = revenues.reduce((sum, r) => sum + r.totalSalePrice, 0);
    const totalAdminCommission = revenues.reduce((sum, r) => sum + r.adminCommission, 0);
    const totalSellerRevenue = revenues.reduce((sum, r) => sum + r.sellerRevenue, 0);

    // Group by month and year
    const monthlyBreakdown = {};
    revenues.forEach(r => {
      const key = `${r.year}-${String(r.month).padStart(2, '0')}`;
      if (!monthlyBreakdown[key]) {
        monthlyBreakdown[key] = { totalSalePrice: 0, sellerRevenue: 0, orderCount: 0 };
      }
      monthlyBreakdown[key].totalSalePrice += r.totalSalePrice;
      monthlyBreakdown[key].sellerRevenue += r.sellerRevenue;
      monthlyBreakdown[key].orderCount += 1;
    });

    res.status(200).json({
      message: "Seller total revenue retrieved successfully",
      totals: {
        totalSalePrice,
        totalAdminCommission,
        totalSellerRevenue,
        totalOrders: revenues.length
      },
      monthlyBreakdown
    });
  } catch (error) {
    console.error("Error fetching seller total revenue:", error);
    res.status(500).json({ message: "Server error while fetching seller total revenue" });
  }
};
