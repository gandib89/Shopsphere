import express from "express";
import { verifyToken } from "../middlewares/authMiddleware.js";
import {
  getNotifications,
  markAsRead,
  markAllRead,
  deleteNotification,
  deleteAllNotifications,
} from "../controller/notificationController.js";

const notificationRouter = express.Router();

notificationRouter.get("/", verifyToken, getNotifications);
notificationRouter.put("/read/:id", verifyToken, markAsRead);
notificationRouter.put("/read-all", verifyToken, markAllRead);
notificationRouter.delete("/:id", verifyToken, deleteNotification);
notificationRouter.delete("/", verifyToken, deleteAllNotifications);

export default notificationRouter;
