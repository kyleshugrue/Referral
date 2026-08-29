import { Router } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { messages, conversations, users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { requireAuthJWT } from '../auth';
import { requireCompleteRegistration } from '../middleware/require-complete-registration';
import { validateDirectMessageInput, groupMessageSchema } from '../lib/message-validation';

const router = Router();

// Chain both middlewares: auth first, then registration check
router.use(requireAuthJWT);
router.use(requireCompleteRegistration);

// Get messages between current user and another user
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

    res.json(messagesList);

  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).json({ 
      message: "Failed to fetch messages",
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Message creation endpoint
router.post("/:userId", async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'User not found' });
    }
    
    const senderId = req.user.id;
    const receiverId = parseInt(req.params.userId);
    const { content } = req.body;

    const validation = validateDirectMessageInput(receiverId, content);
    if (!validation.ok) {
      return res.status(400).json({ message: validation.message });
    }

    // Create message using the storage interface
    const message = await storage.createMessage({
      senderId,
      receiverId,
      content: validation.content
    });

    // Send push notification to iOS native users only
    const pushTimestamp = new Date().toISOString();
    console.log(`[${pushTimestamp}] [NewMessage-PUSH] 🚀 ENTERING push notification section for user ${receiverId}`);
    
    try {
      console.log(`[${pushTimestamp}] [NewMessage-PUSH] 📦 Importing push notification service...`);
      const { sendNewMessageNotification } = await import('../services/push-notifications');
      console.log(`[${pushTimestamp}] [NewMessage-PUSH] ✅ Push notification service imported successfully`);
      
      console.log(`[${pushTimestamp}] [NewMessage-PUSH] 📦 Importing storage service...`);
      const { storage: storageService } = await import('../storage');
      console.log(`[${pushTimestamp}] [NewMessage-PUSH] ✅ Storage service imported successfully`);
      
      console.log(`[${pushTimestamp}] [NewMessage-PUSH] 👤 Fetching sender user ${senderId}...`);
      const senderUser = await storageService.getUserById(senderId);
      
      if (senderUser) {
        const preview = validation.content.substring(0, 50);
        console.log(`[${pushTimestamp}] [NewMessage-PUSH] ✅ Sender found: ${senderUser.fullName} (ID: ${senderId})`);
        console.log(`[${pushTimestamp}] [NewMessage-PUSH] 📤 Calling sendNewMessageNotification(${receiverId}, "${senderUser.fullName}", "${preview}...")...`);
        
        const pushResult = await sendNewMessageNotification(receiverId, senderUser.fullName, validation.content);
        
        console.log(`[${pushTimestamp}] [NewMessage-PUSH] 📊 Push notification result:`, pushResult);
        if (pushResult) {
          console.log(`[${pushTimestamp}] [NewMessage-PUSH] ✅ Push notification sent successfully to user ${receiverId}`);
        } else {
          console.warn(`[${pushTimestamp}] [NewMessage-PUSH] ⚠️ Push notification returned false (no tokens or failed) for user ${receiverId}`);
        }
      } else {
        console.error(`[${pushTimestamp}] [NewMessage-PUSH] ❌ Sender user ${senderId} not found, cannot send push`);
      }
    } catch (pushError) {
      console.error(`[${pushTimestamp}] [NewMessage-PUSH] ❌ EXCEPTION in push notification:`, pushError);
      console.error(`[${pushTimestamp}] [NewMessage-PUSH] ❌ Error stack:`, pushError instanceof Error ? pushError.stack : 'No stack trace');
      // Don't fail the request if push notification fails
    }
    
    console.log(`[${pushTimestamp}] [NewMessage-PUSH] 🏁 EXITING push notification section for user ${receiverId}`);

    res.status(201).json(message);
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ 
      message: "Failed to send message",
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Group message creation endpoint
router.post("/group", async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'User not found' });
    }
    
    const senderId = req.user.id;
    const { content, memberIds } = req.body;

    // Validate request data
    const validation = groupMessageSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        message: "Invalid request data", 
        errors: validation.error.format() 
      });
    }

    // Check if all memberIds are actual connections of the current user
    const connections = await storage.getConnections(senderId);
    const connectionUserIds = connections.map((conn) => conn.otherUser.id);
    
    console.log("Group Chat - User connections:", connectionUserIds);
    console.log("Group Chat - Requested members:", memberIds);
    
    // Filter out the current user ID from the memberIds
    const memberIdsWithoutSelf = memberIds.filter((id: number) => id !== senderId);
    console.log("Group Chat - Member IDs without self:", memberIdsWithoutSelf);
    
    // Get valid connections only (members that the current user is connected to)
    const validMemberIds = memberIdsWithoutSelf.filter((id: number) => 
      connectionUserIds.includes(id)
    );
    console.log("Group Chat - Valid member IDs:", validMemberIds);
    
    // Identify actually invalid members (excluding current user)
    const invalidMembers = memberIdsWithoutSelf.filter((id: number) => 
      !connectionUserIds.includes(id)
    );
    
    if (invalidMembers.length > 0) {
      console.log("Group Chat - Invalid members detected:", invalidMembers);
      return res.status(400).json({ 
        message: "Invalid members", 
        invalidMembers 
      });
    }
    
    // If no valid members after filtering, return an error
    if (validMemberIds.length === 0 && memberIdsWithoutSelf.length > 0) {
      console.log("Group Chat - No valid members after filtering");
      return res.status(400).json({
        message: "No valid members found"
      });
    }
    
    console.log("Group Chat - Proceeding with valid members:", validMemberIds);
    
    // Create a new conversation for the group chat
    let conversation;
    try {
      // Set user2Id properly - must be a real connection, not self
      const user2Id = validMemberIds.length > 0 ? validMemberIds[0] : senderId;
      console.log(`Group Chat - Setting user2Id to: ${user2Id}`);
      
      // Create unique list of all members including sender
      const allGroupMembers = [...new Set([...validMemberIds, senderId])];
      console.log(`Group Chat - All group members: ${allGroupMembers}`);
      
      // Create a group conversation
      conversation = await db.insert(conversations).values({
        user1Id: senderId,
        user2Id: user2Id,
        isGroup: true,
        groupMemberIds: allGroupMembers,
        createdAt: new Date().toISOString(),
        lastMessageAt: new Date().toISOString()
      }).returning().execute();
      
      console.log("Created conversation:", conversation);
      
      if (!conversation || conversation.length === 0) {
        throw new Error("Failed to create conversation");
      }
    } catch (err) {
      console.error("Error creating conversation:", err);
      return res.status(500).json({ message: "Failed to create group chat conversation" });
    }

    const conversationId = conversation[0].id;
    
    // Send initial message to all group members
    const sentMessages = [];
    
    // Always create at least one message for the sender
    try {
      console.log("Group Chat - Creating message for sender");
      const senderMessage = await db.insert(messages).values({
        conversationId,
        senderId,
        receiverId: senderId, // Send to self to record the message
        content: content.trim(),
        createdAt: new Date().toISOString()
      }).returning().execute();
      
      sentMessages.push(senderMessage[0]);
      console.log("Group Chat - Message created for sender");
    } catch (err) {
      console.error("Group Chat - Error creating message for sender:", err);
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
        console.error(`Group Chat - Error checking user ${id}:`, err);
        allMemberDetails.push({ id, valid: false, name: null, error: String(err) });
      }
    }
    
    console.log(`Group Chat - All member details:`, allMemberDetails);
    
    // If any receivers are invalid, return an error
    const invalidReceivers = allMemberDetails.filter(m => !m.valid);
    if (invalidReceivers.length > 0) {
      console.log(`Group Chat - Invalid receivers found:`, invalidReceivers);
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
          console.log(`Group Chat - Skipping invalid receiver ID: ${receiverId}`);
          continue;
        }
        
        console.log(`Group Chat - Sending message to receiver ${receiverId}`);
        
        // Find user details from our verified list
        const userDetails = allMemberDetails.find(u => u.id === receiverId);
        console.log(`Group Chat - Using verified user details:`, userDetails);
        
        // Create the message
        const message = await db.insert(messages).values({
          conversationId,
          senderId,
          receiverId,
          content: content.trim(),
          createdAt: new Date().toISOString()
        }).returning().execute();
        
        sentMessages.push(message[0]);
        console.log(`Group Chat - Message sent successfully to receiver ${receiverId}`);
      } catch (err) {
        console.error(`Group Chat - Error sending message to user ${receiverId}:`, err);
        // Continue with other members even if one fails
      }
    }

    res.status(201).json({ 
      conversationId, 
      messages: sentMessages,
      success: true
    });
  } catch (error) {
    console.error('Error creating group chat:', error);
    res.status(500).json({ 
      message: "Failed to create group chat",
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;