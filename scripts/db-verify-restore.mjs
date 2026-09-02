import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';
import { verifyMigrationIntegrity } from './migration-integrity.mjs';

const { Pool } = pg;
const connectionString = process.env.RESTORE_DATABASE_URL;
const acknowledged = process.argv.includes('--ack-isolated') || process.env.RESTORE_DATABASE_ISOLATED === 'true';
const verifierVersion = '2';

function fail(message) {
  console.error(`db:verify-restore failed: ${message}`);
  process.exitCode = 1;
}

if (!connectionString) {
  fail('RESTORE_DATABASE_URL is required; production DATABASE_URL is never used as a fallback.');
} else if (!acknowledged) {
  fail('refusing to connect without --ack-isolated or RESTORE_DATABASE_ISOLATED=true.');
} else {
  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch {
    fail('RESTORE_DATABASE_URL must be a valid PostgreSQL URL.');
  }

  if (parsed && !['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    fail('RESTORE_DATABASE_URL must use the PostgreSQL protocol.');
  }

  const host = parsed?.hostname.toLowerCase() || '';
  const databaseName = parsed?.pathname.replace(/^\/+/, '').toLowerCase() || '';
  if (/(^|[-_.])(prod|production|live|primary|main)([-_.]|$)/.test(host) ||
      /(^|[-_.])(prod|production|live|primary|main)([-_.]|$)/.test(databaseName)) {
    fail('refusing a production-looking restore target.');
  }

  if (process.exitCode !== 1) {
    await verifyRestore(connectionString);
  }
}

async function verifyRestore(url) {
  let integrity;
  try {
    integrity = await verifyMigrationIntegrity();
  } catch (error) {
    fail(error instanceof Error ? error.message : 'migration integrity verification failed');
    return;
  }

  const migrationSources = await Promise.all(integrity.migrations.map(({ file }) =>
    fs.readFile(path.resolve('migrations', file), 'utf8'),
  ));
  const expectedTables = [...new Set(migrationSources.flatMap((source) =>
    [...source.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?"?([a-zA-Z0-9_]+)"?/gi)].map((match) => match[1]),
  ))];
  const expectedConstraints = [...new Set(migrationSources.flatMap((source) =>
    [...source.matchAll(/(?:ADD\s+)?CONSTRAINT\s+"?([a-zA-Z0-9_]+)"?/gi)].map((match) => match[1]),
  ))];
  const expectedIndexes = [...new Set(migrationSources.flatMap((source) =>
    [...source.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF NOT EXISTS\s+)?"?([a-zA-Z0-9_]+)"?/gi)].map((match) => match[1]),
  ))];

  const pool = new Pool({
    connectionString: url,
    max: 1,
    application_name: 'db-verify-restore',
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
    query_timeout: 20_000,
  });
  let client;
  const startedAt = Date.now();
  try {
    client = await pool.connect();
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const readOnly = await client.query('SHOW transaction_read_only');
    if (readOnly.rows[0]?.transaction_read_only !== 'on') {
      throw new Error('restore transaction is not read-only');
    }

    const tables = await client.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    const presentTables = new Set(tables.rows.map((row) => row.table_name));
    const missingTables = expectedTables.filter((table) => !presentTables.has(table));
    if (missingTables.length) throw new Error(`schema contract missing ${missingTables.length} required table(s)`);

    const constraints = await client.query(
      `SELECT conname FROM pg_constraint WHERE connamespace = 'public'::regnamespace`,
    );
    const presentConstraints = new Set(constraints.rows.map((row) => row.conname));
    const missingConstraints = expectedConstraints.filter((name) => !presentConstraints.has(name));
    if (missingConstraints.length) throw new Error(`schema contract missing ${missingConstraints.length} constraint(s)`);

    const indexes = await client.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
    );
    const presentIndexes = new Set(indexes.rows.map((row) => row.indexname));
    const missingIndexes = expectedIndexes.filter((name) => !presentIndexes.has(name));
    if (missingIndexes.length) throw new Error(`schema contract missing ${missingIndexes.length} index(es)`);

    const invariantChecks = {
      duplicatePendingRequests: `
        SELECT COUNT(*)::int AS violations FROM (
          SELECT LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id)
          FROM connection_requests WHERE status = 'requested'
          GROUP BY 1, 2 HAVING COUNT(*) > 1
        ) duplicates`,
      duplicateConnections: `
        SELECT COUNT(*)::int AS violations FROM (
          SELECT LEAST(user1_id, user2_id), GREATEST(user1_id, user2_id)
          FROM connections GROUP BY 1, 2 HAVING COUNT(*) > 1
        ) duplicates`,
      duplicateBlocks: `
        SELECT COUNT(*)::int AS violations FROM (
          SELECT user_id, blocked_user_id FROM user_blocks
          GROUP BY 1, 2 HAVING COUNT(*) > 1
        ) duplicates`,
      duplicateDirectConversations: `
        SELECT COUNT(*)::int AS violations FROM (
          SELECT LEAST(user1_id, user2_id), GREATEST(user1_id, user2_id)
          FROM conversations WHERE COALESCE(is_group, false) = false
          GROUP BY 1, 2 HAVING COUNT(*) > 1
        ) duplicates`,
      duplicateNotifications: `
        SELECT COUNT(*)::int AS violations FROM (
          SELECT user_id, type, related_id FROM notifications
          GROUP BY 1, 2, 3 HAVING COUNT(*) > 1
        ) duplicates`,
      selfRelationships: `
        SELECT (
          (SELECT COUNT(*) FROM connection_requests WHERE sender_id = receiver_id) +
          (SELECT COUNT(*) FROM connections WHERE user1_id = user2_id) +
          (SELECT COUNT(*) FROM user_blocks WHERE user_id = blocked_user_id) +
          (SELECT COUNT(*) FROM conversations
            WHERE COALESCE(is_group, false) = false AND user1_id = user2_id)
        )::int AS violations`,
      invalidGenerationJobs: `
        SELECT COUNT(*)::int AS violations FROM match_generation_jobs
        WHERE status NOT IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'RETRYING', 'CANCELLED')
          OR retry_count < 0 OR max_retries < 0`,
      invalidGenerationMatches: `
        SELECT COUNT(*)::int AS violations FROM synergy_matches
        WHERE generation_status NOT IN ('PENDING', 'GENERATING', 'READY', 'FAILED')
          OR COALESCE(user_profile_version, 0) < 0
          OR COALESCE(matched_user_profile_version, 0) < 0
          OR (generation_status = 'READY' AND (description IS NULL OR user_profile_version IS NULL
              OR matched_user_profile_version IS NULL))`,
      orphanSnapshots: `
        SELECT (
          (SELECT COUNT(*) FROM match_generation_jobs j
            LEFT JOIN user_profile_snapshots s ON s.id = j.user_snapshot_id
            WHERE j.user_snapshot_id IS NOT NULL AND s.id IS NULL) +
          (SELECT COUNT(*) FROM match_generation_jobs j
            LEFT JOIN user_profile_snapshots s ON s.id = j.target_user_snapshot_id
            WHERE j.target_user_snapshot_id IS NOT NULL AND s.id IS NULL)
        )::int AS violations`,
      invalidMediaReferences: `
        SELECT COUNT(*)::int AS violations
        FROM (
          SELECT photo AS reference FROM users WHERE photo IS NOT NULL AND photo <> ''
          UNION ALL
          SELECT resume_url AS reference FROM users WHERE resume_url IS NOT NULL AND resume_url <> ''
          UNION ALL
          SELECT unnest(COALESCE(resume_preview_urls, ARRAY[]::text[])) AS reference
          FROM users
        ) media
        WHERE reference <> '/placeholder.jpg'
          AND reference NOT LIKE '/uploads/%'
          AND reference NOT LIKE '/api/media/%'`,
    };
    const checks = {};
    for (const [name, query] of Object.entries(invariantChecks)) {
      const result = await client.query(query);
      checks[name] = result.rows[0]?.violations ?? 0;
      if (checks[name] !== 0) throw new Error(`data invariant failed: ${name}`);
    }

    const aggregateTables = [
      'users',
      'connections',
      'connection_requests',
      'conversations',
      'messages',
      'notifications',
      'match_generation_jobs',
      'synergy_matches',
      'session',
    ];
    const aggregates = {};
    for (const table of aggregateTables) {
      if (!presentTables.has(table)) continue;
      const result = await client.query(`SELECT COUNT(*)::int AS count FROM "${table}"`);
      aggregates[table] = result.rows[0]?.count ?? 0;
    }

    const evidence = {
      verifierVersion,
      verifiedAt: new Date().toISOString(),
      migrationState: 'catalog contract matched',
      migrationManifestSha256: integrity.manifestSha256,
      tableCount: presentTables.size,
      aggregateCounts: aggregates,
      invariantChecks: checks,
      elapsedMs: Date.now() - startedAt,
    };
    await client.query('ROLLBACK');
    console.log(JSON.stringify(evidence));
    console.log('db:verify-restore passed: isolated read-only catalog and data invariants verified.');
  } catch (error) {
    await client?.query('ROLLBACK').catch(() => {});
    fail(error instanceof Error ? error.message : 'restore verification failed');
  } finally {
    client?.release();
    await pool.end();
  }
}