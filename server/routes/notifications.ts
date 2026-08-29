import { Router } from "express";
import { storage } from "../storage";
import { requireAuthJWT } from '../auth';
import { requireCompleteRegistration } from '../middleware/require-complete-registration.js';
import { logger } from '../lib/logger';

const router = Router();

// Chain both middlewares: auth first, then registration check
router.use(requireAuthJWT);
router.use(requireCompleteRegistration);

// Get unread notification counts for the current user
router.get("/counts", async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'User not found' });
    }
    
    const counts = await storage.getUnreadNotificationCounts(req.user.id);
    res.json(counts);
  } catch (error) {
    logger.error("Error getting notification counts:", error);
    res.status(500).json({ error: "Failed to get notification counts" });
  }
});

// Get all unread notifications for the current user
router.get("/", async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'User not found' });
    }
    
    const notifications = await storage.getUnreadNotifications(req.user.id);
    res.json(notifications);
  } catch (error) {
    logger.error("Error getting notifications:", error);
    res.status(500).json({ error: "Failed to get notifications" });
  }
});

// Static routes must be registered before parameterized routes.
router.patch("/read-all/:type?", async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'User not found' });
    }
    
    const type = req.params.type;
    await storage.markAllNotificationsAsRead(req.user.id, type);
    
    res.json({ success: true });
  } catch (error) {
    logger.error("Error marking all notifications as read:", error);
    res.status(500).json({ error: "Failed to mark all notifications as read" });
  }
});

// Mark a notification as read, scoped to the authenticated owner.
router.patch("/:id", async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'User not found' });
    }
    const notificationId = parseInt(req.params.id);
    if (isNaN(notificationId)) {
      return res.status(400).json({ error: "Invalid notification ID" });
    }

    const updatedNotification = await storage.markNotificationAsRead(notificationId, req.user.id);
    if (!updatedNotification) {
      return res.status(404).json({ error: "Notification not found" });
    }
    res.json(updatedNotification);
  } catch (error) {
    logger.error("Error marking notification as read:", error);
    res.status(500).json({ error: "Failed to mark notification as read" });
  }
});

// Mark message notifications for a specific conversation as read
router.patch("/read-conversation/:conversationId", async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'User not found' });
    }
    
    const conversationId = parseInt(req.params.conversationId);
    if (isNaN(conversationId)) {
      return res.status(400).json({ error: "Invalid conversation ID" });
    }

    await storage.markConversationNotificationsAsRead(req.user.id, conversationId);
    
    res.json({ success: true });
  } catch (error) {
    logger.error("Error marking conversation notifications as read:", error);
    res.status(500).json({ error: "Failed to mark conversation notifications as read" });
  }
});

// Mark notifications for a specific connection as read
router.patch("/read-connection/:connectionId", async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'User not found' });
    }
    
    const connectionId = parseInt(req.params.connectionId);
    if (isNaN(connectionId)) {
      return res.status(400).json({ error: "Invalid connection ID" });
    }

    await storage.markConnectionNotificationsAsRead(req.user.id, connectionId);
    
    res.json({ success: true });
  } catch (error) {
    logger.error("Error marking connection notifications as read:", error);
    res.status(500).json({ error: "Failed to mark connection notifications as read" });
  }
});

export default router;