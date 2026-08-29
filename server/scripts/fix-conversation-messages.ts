import { db } from "../db";
import { conversations, messages } from "@shared/schema";
import { sql } from "drizzle-orm";

async function fixConversationsAndMessages() {
  console.log("Starting conversation and message validation process...");

  try {
    // Get all existing messages
    const allMessages = await db.select().from(messages);
    console.log(`Found ${allMessages.length} total messages`);

    for (const message of allMessages) {
      // For each message, ensure there's a conversation between the users
      const [smallerId, largerId] = [message.senderId, message.receiverId].sort((a, b) => a - b);

      // Check if conversation exists
      let [conversation] = await db
        .select()
        .from(conversations)
        .where(sql`user1_id = ${smallerId} AND user2_id = ${largerId}`);

      if (!conversation) {
        // Create conversation if it doesn't exist
        [conversation] = await db
          .insert(conversations)
          .values({
            user1Id: smallerId,
            user2Id: largerId,
            createdAt: message.createdAt,
            lastMessageAt: message.createdAt
          })
          .returning();

        console.log(`Created new conversation ${conversation.id} between users ${smallerId} and ${largerId}`);
      }

      // Update message with conversation ID if needed
      if (!message.conversationId || message.conversationId !== conversation.id) {
        await db
          .update(messages)
          .set({ conversationId: conversation.id })
          .where(sql`id = ${message.id}`);

        console.log(`Updated message ${message.id} with conversation ID ${conversation.id}`);
      }
    }

    console.log("Conversation and message validation completed");

  } catch (error) {
    console.error("Error validating conversations and messages:", error);
  }
}

// Execute the function
fixConversationsAndMessages().then(() => {
  console.log("All messages have been linked to their conversations");
}).catch(error => {
  console.error("Error in conversation validation script:", error);
  process.exit(1);
});
