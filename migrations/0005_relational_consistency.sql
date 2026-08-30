DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM connection_requests
     WHERE status = 'requested'
     GROUP BY LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id)
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Unresolved duplicate pending connection request pairs; run npm run db:relational:inventory and reconcile with owner approval';
  END IF;
  IF EXISTS (
    SELECT 1 FROM connections
     GROUP BY LEAST(user1_id, user2_id), GREATEST(user1_id, user2_id)
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Unresolved duplicate connection pairs; run npm run db:relational:inventory and reconcile with owner approval';
  END IF;
  IF EXISTS (
    SELECT 1 FROM user_blocks
     GROUP BY user_id, blocked_user_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Unresolved duplicate block rows; run npm run db:relational:inventory and reconcile with owner approval';
  END IF;
  IF EXISTS (
    SELECT 1 FROM conversations
     WHERE COALESCE(is_group, false) = false
     GROUP BY LEAST(user1_id, user2_id), GREATEST(user1_id, user2_id)
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Unresolved duplicate direct conversation pairs; run npm run db:relational:inventory and reconcile with owner approval';
  END IF;
  IF EXISTS (
    SELECT 1 FROM notifications
     GROUP BY user_id, type, related_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Unresolved duplicate notification identities; run npm run db:relational:inventory and reconcile with owner approval';
  END IF;
  IF EXISTS (SELECT 1 FROM connection_requests WHERE sender_id = receiver_id)
     OR EXISTS (SELECT 1 FROM connections WHERE user1_id = user2_id)
     OR EXISTS (SELECT 1 FROM user_blocks WHERE user_id = blocked_user_id)
     OR EXISTS (
       SELECT 1 FROM conversations
        WHERE COALESCE(is_group, false) = false AND user1_id = user2_id
     ) THEN
    RAISE EXCEPTION 'Self relationships are not valid; reconcile rows before applying relational consistency migration';
  END IF;
END $$;
--> statement-breakpoint

ALTER TABLE connection_requests
  ADD CONSTRAINT connection_requests_distinct_users_check
  CHECK (sender_id <> receiver_id);
--> statement-breakpoint
ALTER TABLE connections
  ADD CONSTRAINT connections_distinct_users_check
  CHECK (user1_id <> user2_id);
--> statement-breakpoint
ALTER TABLE user_blocks
  ADD CONSTRAINT user_blocks_distinct_users_check
  CHECK (user_id <> blocked_user_id);
--> statement-breakpoint
ALTER TABLE conversations
  ADD CONSTRAINT conversations_distinct_users_check
  CHECK (user1_id <> user2_id);
--> statement-breakpoint

CREATE UNIQUE INDEX connection_requests_pending_pair_unique
  ON connection_requests (LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id))
  WHERE status = 'requested';
--> statement-breakpoint
CREATE UNIQUE INDEX connections_unordered_pair_unique
  ON connections (LEAST(user1_id, user2_id), GREATEST(user1_id, user2_id));
--> statement-breakpoint
CREATE UNIQUE INDEX user_blocks_directed_pair_unique
  ON user_blocks (user_id, blocked_user_id);
--> statement-breakpoint
CREATE UNIQUE INDEX conversations_direct_pair_unique
  ON conversations (LEAST(user1_id, user2_id), GREATEST(user1_id, user2_id))
  WHERE COALESCE(is_group, false) = false;
--> statement-breakpoint
CREATE UNIQUE INDEX notifications_identity_unique
  ON notifications (user_id, type, related_id);
--> statement-breakpoint

CREATE INDEX connection_requests_pending_receiver_idx
  ON connection_requests (receiver_id, created_at)
  WHERE status = 'requested';
--> statement-breakpoint
CREATE INDEX connections_pair_lookup_idx
  ON connections (user1_id, user2_id);
--> statement-breakpoint
CREATE INDEX conversations_pair_lookup_idx
  ON conversations (user1_id, user2_id, last_message_at);