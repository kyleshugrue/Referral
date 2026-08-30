import crypto from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isDisposableDatabaseUrl } from "../lib/database-readiness";

const databaseUrl = process.env.RELATIONAL_TEST_DATABASE_URL;
const canRun = Boolean(databaseUrl && isDisposableDatabaseUrl(databaseUrl));
const describeIfDatabase = canRun ? describe : describe.skip;
const { Pool } = pg;

describeIfDatabase("relational consistency PostgreSQL invariants", () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  let userIds: number[] = [];

  beforeAll(async () => {
    const suffix = crypto.randomUUID();
    const first = await pool.query(
      `INSERT INTO users (email, full_name, firebase_uid)
       VALUES ($1, $2, $3) RETURNING id`,
      [`relational-a-${suffix}@example.invalid`, "Relational A", `relational-a-${suffix}`],
    );
    const second = await pool.query(
      `INSERT INTO users (email, full_name, firebase_uid)
       VALUES ($1, $2, $3) RETURNING id`,
      [`relational-b-${suffix}@example.invalid`, "Relational B", `relational-b-${suffix}`],
    );
    userIds = [first.rows[0].id, second.rows[0].id];
  });

  afterAll(async () => {
    if (userIds.length) {
      await pool.query("DELETE FROM users WHERE id = ANY($1::int[])", [userIds]);
    }
    await pool.end();
  });

  it("collapses concurrent direct conversation creation to one canonical row", async () => {
    const [userA, userB] = userIds;
    const insert = `
      INSERT INTO conversations (user1_id, user2_id, is_group)
      VALUES (LEAST($1::int, $2::int), GREATEST($1::int, $2::int), false)
      ON CONFLICT DO NOTHING
      RETURNING id
    `;
    const [first, second] = await Promise.all([
      pool.query(insert, [userA, userB]),
      pool.query(insert, [userB, userA]),
    ]);
    const rows = await pool.query(
      `SELECT id FROM conversations
        WHERE LEAST(user1_id, user2_id) = LEAST($1::int, $2::int)
          AND GREATEST(user1_id, user2_id) = GREATEST($1::int, $2::int)
          AND COALESCE(is_group, false) = false`,
      [userA, userB],
    );
    expect(first.rows.length + second.rows.length).toBe(1);
    expect(rows.rows).toHaveLength(1);
  });

  it("rolls back a failed conversation/message/notification unit together", async () => {
    const [userA, userB] = userIds;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const conversation = await client.query(
        `INSERT INTO conversations (user1_id, user2_id, is_group)
         VALUES ($1, $2, false)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [userA, userB],
      );
      const conversationId = conversation.rows[0]?.id ?? (await client.query(
        `SELECT id FROM conversations
          WHERE user1_id = LEAST($1::int, $2::int) AND user2_id = GREATEST($1::int, $2::int)
            AND COALESCE(is_group, false) = false`,
        [userA, userB],
      )).rows[0].id;
      const message = await client.query(
        `INSERT INTO messages (conversation_id, sender_id, receiver_id, content)
         VALUES ($1, $2, $3, 'rollback probe') RETURNING id`,
        [conversationId, userA, userB],
      );
      await client.query(
        `INSERT INTO notifications (user_id, type, related_id)
         VALUES ($1, 'message', $2)`,
        [userB, message.rows[0].id],
      );
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }

    const remaining = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM messages WHERE content = 'rollback probe')::int AS messages,
         (SELECT COUNT(*) FROM notifications WHERE type = 'message' AND related_id IN
           (SELECT id FROM messages WHERE content = 'rollback probe'))::int AS notifications`,
    );
    expect(remaining.rows[0]).toEqual({ messages: 0, notifications: 0 });
  });

  it("makes pending requests and directed blocks idempotent under conflict", async () => {
    const [userA, userB] = userIds;
    await pool.query(
      `DELETE FROM connection_requests
        WHERE sender_id = $1 AND receiver_id = $2`,
      [userA, userB],
    );
    const requestInsert = `
      INSERT INTO connection_requests (sender_id, receiver_id, status)
      VALUES ($1, $2, 'requested')
      ON CONFLICT DO NOTHING
      RETURNING id
    `;
    const requestResults = await Promise.all([
      pool.query(requestInsert, [userA, userB]),
      pool.query(requestInsert, [userB, userA]),
    ]);
    const requests = await pool.query(
      `SELECT id FROM connection_requests
        WHERE status = 'requested'
          AND LEAST(sender_id, receiver_id) = LEAST($1::int, $2::int)
          AND GREATEST(sender_id, receiver_id) = GREATEST($1::int, $2::int)`,
      [userA, userB],
    );
    expect(requestResults[0].rows.length + requestResults[1].rows.length).toBe(1);
    expect(requests.rows).toHaveLength(1);

    const blockInsert = `
      INSERT INTO user_blocks (user_id, blocked_user_id)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
      RETURNING id
    `;
    const blocks = await Promise.all([
      pool.query(blockInsert, [userA, userB]),
      pool.query(blockInsert, [userA, userB]),
    ]);
    expect(blocks[0].rows.length + blocks[1].rows.length).toBe(1);
  });
});