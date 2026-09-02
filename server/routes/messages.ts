import { Router } from "express";
import { storage } from "../storage";
import { requireAuthJWT } from '../auth';
import { requireCompleteRegistration } from '../middleware/require-complete-registration';
import { validateDirectMessageInput } from '../lib/message-validation';
import { logger } from '../lib/logger';
import { toMessageDto } from "../lib/privacy-dto";
import { parseStrictPositiveInteger } from "../lib/request-validation";
import {
  decodeMessageCursor,
  DEFAULT_MESSAGE_PAGE_SIZE,
  MAX_MESSAGE_PAGE_SIZE,
} from "../lib/message-pagination";

const router = Router();

// Chain both middlewares: auth first, then registration check
router.use(requireAuthJWT);
router.use(requireCompleteRegistration);

// Get messages between current user and another user
// Register the static group route before the parameterized user route so
// "/group" cannot be interpreted as a user ID.
router.post("/group", (_req, res) => {
  res.status(410).json({
    message: "Group chat is not supported. Use a direct connection chat instead.",
  });
});

router.get("/:userId", async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'User not found' });
    }
    
    const currentUserId = req.user.id;
    const otherUserId = parseStrictPositiveInteger(req.params.userId);

    if (!otherUserId) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    const rawLimit = Number(req.query.limit ?? DEFAULT_MESSAGE_PAGE_SIZE);
    if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > MAX_MESSAGE_PAGE_SIZE) {
      return res.status(400).json({ message: `limit must be an integer between 1 and ${MAX_MESSAGE_PAGE_SIZE}` });
    }
    const cursor = req.query.cursor ? decodeMessageCursor(req.query.cursor) : undefined;
    if (req.query.cursor && !cursor) {
      return res.status(400).json({ message: "Invalid message cursor" });
    }

    const page = await storage.getMessagesPage(currentUserId, otherUserId, {
      limit: rawLimit,
      cursor,
    });

    const serializedMessages = page.items.map(toMessageDto);
    // Preserve the legacy array response for existing web and native clients.
    // Callers that opt into cursor pagination receive metadata alongside the
    // bounded page.
    if (!req.query.cursor && req.query.limit === undefined) {
      return res.json(serializedMessages);
    }
    return res.json({
      messages: serializedMessages,
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    });

  } catch (error) {
    logger.error("Error fetching messages:", error);
    if (error instanceof Error && error.message === "Users are not connected") {
      return res.status(403).json({ message: "Messages require an accepted connection" });
    }
    res.status(500).json({ message: "Failed to fetch messages" });
  }
});

// Message creation endpoint
router.post("/:userId", async (req, res) => {
  try {
    const authenticatedUser = req.user;
    if (!authenticatedUser) {
      return res.status(401).json({ message: 'User not found' });
    }
    
    const senderId = req.user!.id;
    const receiverId = parseStrictPositiveInteger(req.params.userId);
    const { content } = req.body;

    if (!receiverId) {
      return res.status(400).json({ message: "Invalid user ID" });
    }
    const validation = validateDirectMessageInput(receiverId, content);
    if (!validation.ok) {
      return res.status(400).json({ message: validation.message });
    }

    const connection = await storage.getConnectionBetweenUsers(senderId, receiverId);
    if (!connection) {
      return res.status(403).json({ message: "Messages require an accepted connection" });
    }

    // Create message using the storage interface
    const message = await storage.createMessage({
      senderId,
      receiverId,
      content: validation.content
    });

    // Send push notification to iOS native users only
    const pushTimestamp = new Date().toISOString();
    logger.debug('[NewMessage-PUSH] Starting push notification', { pushTimestamp, receiverId });
    
    try {
      const { sendNewMessageNotification } = await import('../services/push-notifications');
      const { storage: storageService } = await import('../storage');
      const senderUser = await storageService.getUserById(senderId);
      
      if (senderUser) {
        const pushResult = await sendNewMessageNotification(receiverId, senderUser.fullName, validation.content);
        logger.debug('[NewMessage-PUSH] Push notification completed', {
          pushTimestamp,
          receiverId,
          sent: Boolean(pushResult),
        });
      } else {
        logger.warn('[NewMessage-PUSH] Sender not found; push skipped', { pushTimestamp, senderId });
      }
    } catch (pushError) {
      logger.error('[NewMessage-PUSH] Push notification failed:', pushError);
      // Don't fail the request if push notification fails
    }
    
    logger.debug('[NewMessage-PUSH] Push notification section finished', { pushTimestamp, receiverId });

    res.status(201).json(toMessageDto(message));
  } catch (error) {
    logger.error('Error sending message:', error);
    if (error instanceof Error && error.message === "Users are not connected") {
      return res.status(403).json({ message: "Messages require an accepted connection" });
    }
    res.status(500).json({ message: "Failed to send message" });
  }
});

export default router;