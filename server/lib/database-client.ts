import { Pool as NeonPool, neonConfig } from '@neondatabase/serverless';
import {
  Pool as PostgresPool,
  type QueryResult,
  type QueryResultRow,
} from 'pg';
import ws from 'ws';

// Neon uses a WebSocket transport, while GitHub Actions' disposable
// PostgreSQL service exposes the standard PostgreSQL TCP protocol. Keep the
// hosted Neon path unchanged and use node-postgres for native local/CI URLs.
// Passing the standard ws constructor preserves its default certificate
// verification behavior. Never replace it with an accept-all TLS client.
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;

export type DatabasePool = NeonPool | PostgresPool;
export interface DatabaseNotification {
  channel: string;
  payload?: string;
}

export interface DatabaseQueryExecutor {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
}

interface DatabaseConnectedClient extends DatabaseQueryExecutor {
  on(event: 'notification', listener: (notification: DatabaseNotification) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

export interface DatabasePoolOperations extends DatabaseQueryExecutor {
  connect(): Promise<DatabaseConnectedClient>;
}

export interface DatabaseClient extends DatabaseQueryExecutor {
  onNotification(listener: (notification: DatabaseNotification) => void): void;
  onError(listener: (error: Error) => void): void;
}

export function usesNativePostgres(connectionString = process.env.DATABASE_URL): boolean {
  if (!connectionString) {
    return false;
  }

  try {
    const hostname = new URL(connectionString).hostname.toLowerCase();
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '[::1]'
    );
  } catch {
    return false;
  }
}

export function createDatabasePool(options: ConstructorParameters<typeof NeonPool>[0]): DatabasePool {
  if (usesNativePostgres(options?.connectionString)) {
    return new PostgresPool(options);
  }

  return new NeonPool(options);
}

export async function queryDatabase<R extends QueryResultRow = QueryResultRow>(
  pool: DatabaseQueryExecutor,
  text: string,
  values: unknown[] = [],
): Promise<QueryResult<R>> {
  // NeonPool extends pg.Pool in Neon's declarations. Narrowing this union with
  // instanceof PostgresPool can therefore make the fallback branch `never`
  // under a clean dependency install. Both drivers intentionally expose this
  // shared query contract, so call the capability directly.
  return pool.query<R>(text, values);
}

export async function connectDatabase(pool: DatabasePoolOperations): Promise<DatabaseClient> {
  const client = await pool.connect();
  return {
    query: (text, values = []) => client.query(text, values),
    onNotification: (listener) => client.on('notification', listener),
    onError: (listener) => client.on('error', listener),
  };
}

export function assertSessionStorePoolCompatible(
  pool: DatabasePool,
): asserts pool is DatabasePool & PostgresPool {
  const requiredMethods = ['connect', 'query', 'end', 'on'] as const;
  for (const method of requiredMethods) {
    if (typeof pool[method] !== 'function') {
      throw new TypeError(`Database pool is missing required session-store method: ${method}`);
    }
  }
}