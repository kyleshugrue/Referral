
import { db, pool } from "../db";
import { connections } from "@shared/schema";
import { sql } from "drizzle-orm";

async function removeDuplicateConnections() {
  console.log("Starting duplicate connection removal process...");
  
  try {
    // Get all connections
    const allConnections = await db.select().from(connections);
    console.log(`Found ${allConnections.length} total connections`);
    
    // Map to identify unique connections
    const connectionMap = new Map();
    const duplicates = [];
    
    // First pass: build a map of unique connections and identify duplicates
    for (const conn of allConnections) {
      // Create a unique key for each user pair regardless of direction
      const key = [conn.user1Id, conn.user2Id].sort((a, b) => a - b).join('-');
      
      if (!connectionMap.has(key)) {
        // First occurrence of this connection
        connectionMap.set(key, {
          id: conn.id,
          createdAt: conn.createdAt
        });
      } else {
        // Duplicate found
        const existing = connectionMap.get(key);
        // Determine which one to keep (older one)
        const existingDate = new Date(existing.createdAt);
        const currentDate = new Date(conn.createdAt);
        
        if (currentDate < existingDate) {
          // Current is older, mark existing as duplicate
          duplicates.push(existing.id);
          // Update map with current connection
          connectionMap.set(key, {
            id: conn.id,
            createdAt: conn.createdAt
          });
        } else {
          // Existing is older, mark current as duplicate
          duplicates.push(conn.id);
        }
      }
    }
    
    console.log(`Found ${duplicates.length} duplicate connections to remove`);
    
    // Delete the duplicates
    if (duplicates.length > 0) {
      // Delete connections in batches to avoid potential query size limits
      const batchSize = 50;
      for (let i = 0; i < duplicates.length; i += batchSize) {
        const batch = duplicates.slice(i, i + batchSize);
        await db.delete(connections).where(
          sql`id IN (${sql.join(batch, sql`, `)})`
        );
        console.log(`Deleted batch of ${batch.length} duplicate connections`);
      }
      
      console.log(`Successfully removed ${duplicates.length} duplicate connections`);
    } else {
      console.log("No duplicate connections found");
    }
  } catch (error) {
    console.error("Error removing duplicate connections:", error);
  } finally {
    // Close the database connection
    await pool.end();
  }
}

// Execute the function
removeDuplicateConnections().then(() => {
  console.log("Duplicate connection removal completed");
}).catch(error => {
  console.error("Error in duplicate connection removal script:", error);
});
