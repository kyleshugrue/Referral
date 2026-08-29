import { db, pool } from "../db";
import { connectionRequests } from "@shared/schema";
import { sql } from "drizzle-orm";

async function removeDuplicateRequests() {
  console.log("Starting duplicate connection request removal process...");

  try {
    // Get all connection requests
    const requests = await db
      .select()
      .from(connectionRequests);

    console.log(`Found ${requests.length} total connection requests`);

    // Track unique user pairs and identify duplicates
    const userPairMap = new Map();
    const duplicates = [];

    // First pass: identify duplicates
    for (const request of requests) {
      // Create a unique key for each user pair with direction preserved
      // For requests, direction matters (who sent it to whom)
      const key = `${request.senderId}-${request.receiverId}`;

      if (!userPairMap.has(key)) {
        // First occurrence
        userPairMap.set(key, {
          id: request.id,
          createdAt: request.createdAt
        });
      } else {
        // Duplicate found
        const existing = userPairMap.get(key);
        // Keep the older one (earlier timestamp)
        const existingDate = new Date(existing.createdAt);
        const currentDate = new Date(request.createdAt);

        if (currentDate < existingDate) {
          // Current is older, mark existing as duplicate
          duplicates.push(existing.id);
          // Update map with current connection
          userPairMap.set(key, {
            id: request.id,
            createdAt: request.createdAt
          });
        } else {
          // Existing is older, mark current as duplicate
          duplicates.push(request.id);
        }
      }
    }

    console.log(`Found ${duplicates.length} duplicate connection requests to remove`);

    // Delete the duplicates
    if (duplicates.length > 0) {
      console.log("Duplicate connection request IDs:", duplicates);

      // Delete requests in batches to avoid potential query size limits
      const batchSize = 50;
      for (let i = 0; i < duplicates.length; i += batchSize) {
        const batch = duplicates.slice(i, i + batchSize);
        await db.delete(connectionRequests).where(
          sql`id IN (${sql.join(batch, sql`, `)})`
        );
        console.log(`Deleted batch of ${batch.length} duplicate connection requests`);
      }

      console.log(`Successfully removed ${duplicates.length} duplicate connection requests`);
    } else {
      console.log("No duplicate connection requests found");
    }
  } catch (error) {
    console.error("Error removing duplicate connection requests:", error);
  } finally {
    // Close the database connection
    await pool.end();
  }
}

// Execute the function
removeDuplicateRequests()
  .then(() => {
    console.log("Duplicate connection request removal completed");
  })
  .catch(error => {
    console.error("Error in duplicate connection request removal script:", error);
  });