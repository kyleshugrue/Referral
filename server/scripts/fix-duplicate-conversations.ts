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
      const duplicateIds = duplicateConversations
        .slice(1) // Skip the primary conversation
        .map(c => c.id);

      console.log(`Primary conversation ID: ${primaryConversation.id}`);
      console.log(`Duplicate conversation IDs to be merged: ${duplicateIds.join(', ')}`);

      // Count messages across all duplicates
      const allConversationIds = [primaryConversation.id, ...duplicateIds];
      const totalMessagesBefore = await db
        .select({ count: sql<number>`count(*)` })
        .from(messages)
        .where(
          sql`conversation_id IN (${sql.join(allConversationIds)})`
        );
        
      console.log(`Total messages before migration: ${totalMessagesBefore[0].count}`);

      // Get all messages from each duplicate and move them to the primary conversation
      for (const duplicateId of duplicateIds) {
        // Update messages in the duplicate conversation to point to the primary conversation
        await db
          .update(messages)
          .set({ conversationId: primaryConversation.id })
          .where(eq(messages.conversationId, duplicateId));
          
        console.log(`Updated messages from conversation ${duplicateId} to point to conversation ${primaryConversation.id}`);
          
        // Delete the duplicate conversation
        await db
          .delete(conversations)
          .where(eq(conversations.id, duplicateId));
          
        console.log(`Deleted duplicate conversation ${duplicateId}`);
      }

      // Verify all messages were properly migrated
      const totalMessagesAfter = await db
        .select({ count: sql<number>`count(*)` })
        .from(messages)
        .where(eq(messages.conversationId, primaryConversation.id));
        
      console.log(`Total messages after migration to conversation ${primaryConversation.id}: ${totalMessagesAfter[0].count}`);
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