import { Router } from "express";
import type { Request, Response } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { messages, conversations, users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { requireAuthJWT } from '../auth';
import { requireCompleteRegistration } from '../middleware/require-complete-registration';
import { validateDirectMessageInput, groupMessageSchema } from '../lib/message-validation';
import { logger } from '../lib/logger';
import { toMessageDto, toMessageSummaryDto } from "../lib/privacy-dto";

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
    const otherUserId = parseInt(req.params.userId);

    if (!otherUserId || isNaN(otherUserId)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    // Get messages between users using the storage interface
    const messagesList = await storage.getMessages(currentUserId, otherUserId);

    res.json(messagesList.map(toMessageDto));

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
    const receiverId = parseInt(req.params.userId);
    const { content } = req.body;

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

// Group message creation endpoint
export async function legacyCreateGroupMessageHandler(req: Request, res: Response) {
  if (req.method === "POST") {
    return res.status(410).json({
      message: "Group chat is not supported. Use a direct connection chat instead.",
    });
  }

  try {
    const authenticatedUser = req.user;
    if (!authenticatedUser) {
      return res.status(401).json({ message: 'User not found' });
    }
    
    const senderId = req.user!.id;
    const { content, memberIds } = req.body;

    // Validate request data
    const validation = groupMessageSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        message: "Invalid request data", 
        errors: validation.error?.format()
      });
    }

    // Check if all memberIds are actual connections of the current user
    const connections = await storage.getConnections(senderId);
    const connectionUserIds = connections.map((conn) => conn.otherUser.id);
    
    logger.debug("Group chat members validated against connections", {
      connectionCount: connectionUserIds.length,
      requestedMemberCount: memberIds.length,
    });
    
    // Filter out the current user ID from the memberIds
    const memberIdsWithoutSelf = memberIds.filter((id: number) => id !== senderId);
    logger.debug("Group chat excluded sender from member list", {
      memberCount: memberIdsWithoutSelf.length,
    });
    
    // Get valid connections only (members that the current user is connected to)
    const validMemberIds = memberIdsWithoutSelf.filter((id: number) => 
      connectionUserIds.includes(id)
    );
    logger.debug("Group chat connection membership checked", {
      validMemberCount: validMemberIds.length,
    });
    
    // Identify actually invalid members (excluding current user)
    const invalidMembers = memberIdsWithoutSelf.filter((id: number) => 
      !connectionUserIds.includes(id)
    );
    
    if (invalidMembers.length > 0) {
      logger.warn("Group chat contains invalid members", {
        invalidMemberCount: invalidMembers.length,
      });
      return res.status(400).json({ 
        message: "Invalid members", 
        invalidMembers 
      });
    }
    
    // If no valid members after filtering, return an error
    if (validMemberIds.length === 0 && memberIdsWithoutSelf.length > 0) {
      logger.warn("Group chat contains no valid members");
      return res.status(400).json({
        message: "No valid members found"
      });
    }
    
    logger.debug("Group chat proceeding with validated members", {
      validMemberCount: validMemberIds.length,
    });
    
    // Create a new conversation for the group chat
    let conversation;
    try {
      // Set user2Id properly - must be a real connection, not self
      const user2Id = validMemberIds.length > 0 ? validMemberIds[0] : senderId;
      
      // Create unique list of all members including sender
      const allGroupMembers = [...new Set([...validMemberIds, senderId])];
      
      // Create a group conversation
      conversation = await db.insert(conversations).values({
        user1Id: senderId,
        user2Id: user2Id,
        isGroup: true,
        groupMemberIds: allGroupMembers,
        createdAt: new Date().toISOString(),
        lastMessageAt: new Date().toISOString()
      }).returning().execute();
      
      
      if (!conversation || conversation.length === 0) {
        throw new Error("Failed to create conversation");
      }
    } catch (err) {
      logger.error("Error creating group conversation:", err);
      return res.status(500).json({ message: "Failed to create group chat conversation" });
    }

    const conversationId = conversation[0].id;
    
    // Send initial message to all group members
    const sentMessages = [];
    
    // Always create at least one message for the sender
    try {
      const senderMessage = await db.insert(messages).values({
        conversationId,
        senderId,
        receiverId: senderId, // Send to self to record the message
        content: content.trim(),
        createdAt: new Date().toISOString()
      }).returning().execute();
      
      sentMessages.push(senderMessage[0]);
    } catch (err) {
      logger.error("Group chat sender message creation failed:", err);
    }
    
    // First, verify each receiver ID exists in the database
    // This detects mismatches between frontend/backend current user handling
    const allMemberDetails = [];
    for (const id of [...validMemberIds, senderId]) {
      try {
        const userResult = await db.select().from(users).where(eq(users.id, id)).limit(1);
        if (userResult.length > 0) {
          allMemberDetails.push({ id, valid: true, name: userResult[0].fullName });
        } else {
          allMemberDetails.push({ id, valid: false, name: null });
        }
      } catch (err) {
        logger.error("Group chat member validation failed:", err);
        allMemberDetails.push({ id, valid: false, name: null });
      }
    }
    
    logger.debug("Group chat member validation completed", {
      memberCount: allMemberDetails.length,
      validMemberCount: allMemberDetails.filter((member) => member.valid).length,
    });
    
    // If any receivers are invalid, return an error
    const invalidReceivers = allMemberDetails.filter(m => !m.valid);
    if (invalidReceivers.length > 0) {
      logger.warn("Group chat contains invalid receivers", {
        invalidReceiverCount: invalidReceivers.length,
      });
      return res.status(400).json({ 
        message: "Invalid receiver ID", 
        invalidReceivers 
      });
    }
    
    // Send the message to each valid recipient (after thorough validation)
    for (const receiverId of validMemberIds) {
      try {
        // Final verification
        if (!receiverId || isNaN(receiverId) || receiverId === senderId) {
          logger.warn("Group chat skipped invalid receiver");
          continue;
        }
        
        
        // Create the message
        const message = await db.insert(messages).values({
          conversationId,
          senderId,
          receiverId,
          content: content.trim(),
          createdAt: new Date().toISOString()
        }).returning().execute();
        
        sentMessages.push(message[0]);
        logger.debug("Group chat message sent", { receiverId });
      } catch (err) {
        logger.error("Group chat message delivery failed:", err);
        // Continue with other members even if one fails
      }
    }

    res.status(201).json({ 
      conversationId, 
      messages: sentMessages.map(toMessageSummaryDto),
      success: true
    });
  } catch (error) {
    logger.error('Error creating group chat:', error);
    res.status(500).json({ message: "Failed to create group chat" });
  }
}

export default router;