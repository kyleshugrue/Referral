import { db, pool } from "../db";
import { conversations, messages } from "@shared/schema";
import { sql, and, eq, desc } from "drizzle-orm";

async function fixDuplicateConversations() {
  console.log("Starting duplicate conversation fix...");

  try {
    // Find all pairs of users with multiple conversations
    // This query finds all user1_id, user2_id pairs that have more than one conversation
    const duplicateResults = await db.execute<{ user1_id: number, user2_id: number, count: string }>(sql`
      SELECT user1_id, user2_id, COUNT(*) as count
      FROM conversations 
      WHERE is_group = false OR is_group IS NULL
      GROUP BY user1_id, user2_id
      HAVING COUNT(*) > 1
    `);

    const duplicatePairs = duplicateResults.rows;
    console.log(`Found ${duplicatePairs.length} pairs of users with duplicate conversations`);

    // For each duplicate pair, fix the conversations
    for (const result of duplicatePairs) {
      const user1Id = result.user1_id;
      const user2Id = result.user2_id;
      const count = result.count;

      console.log(`Processing duplicate conversations between users ${user1Id} and ${user2Id} (${count} conversations found)`);

      // Get all conversations for this pair of users, ordered by most recently active first
      const duplicateConversations = await db
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.user1Id, user1Id),
            eq(conversations.user2Id, user2Id),
            sql`(is_group = false OR is_group IS NULL)`
          )
        )
        .orderBy(desc(conversations.lastMessageAt));

      if (duplicateConversations.length <= 1) {
        console.log(`No duplicate conversations found for users ${user1Id} and ${user2Id}, skipping`);
        continue;
      }

      // The first conversation is the primary one we want to keep
      const primaryConversation = duplicateConversations[0];
      console.log(`Primary conversation ID: ${primaryConversation.id}`);
      
      // Process each duplicate one at a time (safer than trying to do all at once)
      for (let i = 1; i < duplicateConversations.length; i++) {
        const duplicateConversation = duplicateConversations[i];
        console.log(`Processing duplicate conversation ${duplicateConversation.id}`);
        
        // Count messages in this duplicate conversation
        const [messagesToMigrate] = await db
          .select({ count: sql<number>`count(*)` })
          .from(messages)
          .where(eq(messages.conversationId, duplicateConversation.id));
        
        console.log(`Found ${messagesToMigrate.count} messages to migrate from conversation ${duplicateConversation.id}`);
        
        // Update messages in the duplicate conversation to point to the primary conversation
        try {
          await db
            .update(messages)
            .set({ conversationId: primaryConversation.id })
            .where(eq(messages.conversationId, duplicateConversation.id));
            
          console.log(`Updated messages from conversation ${duplicateConversation.id} to point to conversation ${primaryConversation.id}`);
        } catch (updateError) {
          console.error(`Error updating messages for conversation ${duplicateConversation.id}:`, updateError);
          // Continue to the next duplicate conversation
          continue;
        }
        
        // Delete the duplicate conversation
        try {
          await db
            .delete(conversations)
            .where(eq(conversations.id, duplicateConversation.id));
            
          console.log(`Deleted duplicate conversation ${duplicateConversation.id}`);
        } catch (deleteError) {
          console.error(`Error deleting conversation ${duplicateConversation.id}:`, deleteError);
          // Continue to the next duplicate conversation
          continue;
        }
      }
      
      // Verify all messages were properly migrated
      const [totalMessagesAfter] = await db
        .select({ count: sql<number>`count(*)` })
        .from(messages)
        .where(eq(messages.conversationId, primaryConversation.id));
        
      console.log(`Total messages after migration to conversation ${primaryConversation.id}: ${totalMessagesAfter.count}`);
    }

    console.log("Duplicate conversation fix completed successfully");
  } catch (error) {
    console.error("Error fixing duplicate conversations:", error);
  } finally {
    await pool.end();
  }
}

// Execute the function
fixDuplicateConversations().then(() => {
  console.log("All duplicate conversations have been fixed");
  process.exit(0);
}).catch(error => {
  console.error("Error in fix-duplicate-conversations script:", error);
  process.exit(1);
});