import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';
import { verifyMigrationIntegrity } from './migration-integrity.mjs';

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required for disposable migration setup.');
}

const parsed = new URL(connectionString);
const localHost = ['localhost', '127.0.0.1', '::1', '[::1]', 'helium'].includes(parsed.hostname.toLowerCase());
const databaseName = parsed.pathname.replace(/^\/+/, '').toLowerCase();
const disposableName = /^(postgres|test|ci|disposable|tmp|scratch)([-_a-z0-9]*)$/.test(databaseName);
if (parsed.protocol !== 'postgres:' || !localHost || !disposableName) {
  throw new Error('Refusing migration: DATABASE_URL must be a disposable local PostgreSQL database.');
}

// This runs before creating a Pool so integrity failures can never contact a database.
const integrity = await verifyMigrationIntegrity();
const pool = new Pool({ connectionString });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  const migrationDirectory = path.resolve('migrations');
  const migrationFiles = integrity.migrations.map(({ file }) => file);

  for (const file of migrationFiles) {
    const source = await fs.readFile(path.join(migrationDirectory, file), 'utf8');
    const statements = source
      .split(/-->\s*statement-breakpoint/)
      .map((statement) => statement.trim())
      .filter(Boolean);
    for (const statement of statements) {
      await client.query(statement);
    }
    console.log(`Applied ${file}`);
  }

  const required = ['callback_notification_queue', 'delivery_obligations', 'fcm_tokens', 'match_generation_jobs', 'rate_limit_windows', 'session', 'websocket_tickets'];
  const result = await client.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [required],
  );
  const present = new Set(result.rows.map((row) => row.table_name));
  const missing = required.filter((table) => !present.has(table));
  if (missing.length) throw new Error(`Migration completed with missing required tables: ${missing.join(', ')}`);
  await client.query('COMMIT');
  console.log(`Disposable database ready (${required.length} required tables verified).`);
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}