import { prisma } from "../database/prismaClient.js";

// Get all notifications for the logged-in user (newest first, max 50)
export const getNotifications = async (req, res) => {
  try {
    const userId = req.user.id;
    const notifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    const unreadCount = await prisma.notification.count({ where: { userId, read: false } });

    res.status(200).json({ notifications, unreadCount });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({ message: "Server error while fetching notifications" });
  }
};

// Mark a single notification as read
export const markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const { count } = await prisma.notification.updateMany({
      where: { id, userId },
      data: { read: true },
    });

    if (count === 0) return res.status(404).json({ message: "Notification not found" });

    const notification = await prisma.notification.findUnique({ where: { id } });

    res.status(200).json({ message: "Marked as read", notification });
  } catch (error) {
    console.error("Error marking notification:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// Mark ALL notifications as read for this user
export const markAllRead = async (req, res) => {
  try {
    const userId = req.user.id;
    await prisma.notification.updateMany({ where: { userId, read: false }, data: { read: true } });
    res.status(200).json({ message: "All notifications marked as read" });
  } catch (error) {
    console.error("Error marking all notifications:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// Delete a single notification
export const deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    await prisma.notification.deleteMany({ where: { id, userId } });
    res.status(200).json({ message: "Notification deleted" });
  } catch (error) {
    console.error("Error deleting notification:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// Delete all notifications for this user
export const deleteAllNotifications = async (req, res) => {
  try {
    const userId = req.user.id;
    await prisma.notification.deleteMany({ where: { userId } });
    res.status(200).json({ message: "All notifications cleared" });
  } catch (error) {
    console.error("Error clearing notifications:", error);
    res.status(500).json({ message: "Server error" });
  }
};
