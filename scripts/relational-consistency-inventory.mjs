import pg from "pg";

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL or NEON_DATABASE_URL is required.");
}

const pool = new Pool({ connectionString, max: 1 });
const queries = {
  pendingRequestPairs: `
    SELECT LEAST(sender_id, receiver_id) AS user_a,
           GREATEST(sender_id, receiver_id) AS user_b,
           COUNT(*)::int AS row_count,
           ARRAY_AGG(id ORDER BY created_at, id) AS ids
      FROM connection_requests
     WHERE status = 'requested'
     GROUP BY 1, 2
    HAVING COUNT(*) > 1
     ORDER BY 1, 2
  `,
  connectionPairs: `
    SELECT LEAST(user1_id, user2_id) AS user_a,
           GREATEST(user1_id, user2_id) AS user_b,
           COUNT(*)::int AS row_count,
           ARRAY_AGG(id ORDER BY created_at, id) AS ids
      FROM connections
     GROUP BY 1, 2
    HAVING COUNT(*) > 1
     ORDER BY 1, 2
  `,
  blocks: `
    SELECT user_id, blocked_user_id, COUNT(*)::int AS row_count,
           ARRAY_AGG(id ORDER BY created_at, id) AS ids
      FROM user_blocks
     GROUP BY 1, 2
    HAVING COUNT(*) > 1
     ORDER BY 1, 2
  `,
  directConversations: `
    SELECT LEAST(user1_id, user2_id) AS user_a,
           GREATEST(user1_id, user2_id) AS user_b,
           COUNT(*)::int AS row_count,
           ARRAY_AGG(id ORDER BY created_at, id) AS ids
      FROM conversations
     WHERE COALESCE(is_group, false) = false
     GROUP BY 1, 2
    HAVING COUNT(*) > 1
     ORDER BY 1, 2
  `,
  notifications: `
    SELECT user_id, type, related_id, COUNT(*)::int AS row_count,
           ARRAY_AGG(id ORDER BY created_at, id) AS ids
      FROM notifications
     GROUP BY 1, 2, 3
    HAVING COUNT(*) > 1
     ORDER BY 1, 2, 3
  `,
  selfRelationships: `
    SELECT 'connection_requests' AS table_name, id
      FROM connection_requests WHERE sender_id = receiver_id
    UNION ALL
    SELECT 'connections', id FROM connections WHERE user1_id = user2_id
    UNION ALL
    SELECT 'user_blocks', id FROM user_blocks WHERE user_id = blocked_user_id
    UNION ALL
    SELECT 'direct_conversations', id
      FROM conversations
     WHERE COALESCE(is_group, false) = false AND user1_id = user2_id
     ORDER BY 1, 2
  `,
};

try {
  const report = { generatedAt: new Date().toISOString(), duplicateGroups: {}, selfRelationships: [] };
  for (const [name, query] of Object.entries(queries)) {
    const result = await pool.query(query);
    if (name === "selfRelationships") report.selfRelationships = result.rows;
    else report.duplicateGroups[name] = result.rows;
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  await pool.end();
}