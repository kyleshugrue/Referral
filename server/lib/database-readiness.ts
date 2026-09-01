import { URL } from 'node:url';

export const REQUIRED_SCHEMA_TABLES = [
  'callback_notification_queue',
  'fcm_tokens',
  'match_generation_jobs',
  'rate_limit_windows',
  'session',
  'websocket_tickets',
] as const;

export interface ReadinessQuery {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
}

export interface DatabaseReadinessResult {
  ready: boolean;
  missingTables: string[];
  reason?: 'database-unavailable' | 'schema-incomplete';
}

export function isDisposableDatabaseUrl(connectionString: string): boolean {
  try {
    const url = new URL(connectionString);
    const hostname = url.hostname.toLowerCase();
    const databaseName = url.pathname.replace(/^\/+/, '').toLowerCase();
    const localHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]' || hostname === 'helium';
    const disposableName = /^(postgres|test|ci|disposable|tmp|scratch)([-_a-z0-9]*)$/.test(databaseName);
    return url.protocol === 'postgres:' && localHost && disposableName;
  } catch {
    return false;
  }
}

export function assertDisposableDatabaseUrl(connectionString: string): void {
  if (!isDisposableDatabaseUrl(connectionString)) {
    throw new Error('Refusing schema-changing operation: DATABASE_URL must point to a disposable local PostgreSQL database.');
  }
}

export async function checkDatabaseReadiness(
  database: ReadinessQuery,
  requiredTables: readonly string[] = REQUIRED_SCHEMA_TABLES,
): Promise<DatabaseReadinessResult> {
  try {
    await database.query('SELECT 1');
    const result = await database.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [requiredTables],
    );
    const present = new Set(result.rows.map((row) => row.table_name));
    const missingTables = requiredTables.filter((table) => !present.has(table));
    return missingTables.length === 0
      ? { ready: true, missingTables: [] }
      : { ready: false, missingTables, reason: 'schema-incomplete' };
  } catch {
    return { ready: false, missingTables: [...requiredTables], reason: 'database-unavailable' };
  }
}