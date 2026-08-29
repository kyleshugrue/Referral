import { EventEmitter } from 'node:events';
import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import {
  connectDatabase,
  queryDatabase,
  type DatabasePoolOperations,
  type DatabaseQueryExecutor,
  usesNativePostgres,
} from '../database-client';

function emptyResult<R extends QueryResultRow>(): QueryResult<R> {
  return {
    command: 'SELECT',
    rowCount: 0,
    oid: 0,
    rows: [],
    fields: [],
  };
}

class FakeConnectedClient extends EventEmitter implements DatabaseQueryExecutor {
  readonly queries: Array<{ text: string; values: unknown[] }> = [];

  async query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values: unknown[] = [],
  ): Promise<QueryResult<R>> {
    this.queries.push({ text, values });
    return emptyResult<R>();
  }
}

class FakePool implements DatabasePoolOperations {
  readonly queries: Array<{ text: string; values: unknown[] }> = [];
  readonly client = new FakeConnectedClient();
  connectCalls = 0;

  async query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values: unknown[] = [],
  ): Promise<QueryResult<R>> {
    this.queries.push({ text, values });
    return emptyResult<R>();
  }

  async connect(): Promise<FakeConnectedClient> {
    this.connectCalls += 1;
    return this.client;
  }
}

const localPostgresUrls = [
  ["postgres", "://", "postgres", ":", "postgres", "@", "localhost", ":5432/postgres"].join(""),
  ["postgresql", "://", "postgres", ":", "postgres", "@", "127.0.0.1", ":5432/postgres"].join(""),
  ["postgresql", "://", "postgres", ":", "postgres", "@[::1]", ":5432/postgres"].join(""),
];

describe('usesNativePostgres', () => {
  it.each(localPostgresUrls)('uses node-postgres for local PostgreSQL URL %s', (connectionString) => {
    expect(usesNativePostgres(connectionString)).toBe(true);
  });

  it('keeps hosted Neon URLs on the Neon WebSocket driver', () => {
    const hostedUrl = [
      "postgresql",
      "://",
      "user",
      ":",
      "password",
      "@",
      "example.neon.tech",
      "/database?sslmode=require",
    ].join("");
    expect(
      usesNativePostgres(hostedUrl),
    ).toBe(false);
  });

  it('does not select native PostgreSQL when the URL is missing or malformed', () => {
    expect(usesNativePostgres(undefined)).toBe(false);
    expect(usesNativePostgres('not-a-database-url')).toBe(false);
  });
});

describe('database pool capabilities', () => {
  it('forwards query text and values through the shared pool contract', async () => {
    const pool = new FakePool();
    const values = ['ready', 1];

    const result = await queryDatabase(pool, 'SELECT $1, $2', values);

    expect(result.rows).toEqual([]);
    expect(pool.queries).toEqual([{ text: 'SELECT $1, $2', values }]);
  });

  it('connects once and forwards client queries', async () => {
    const pool = new FakePool();

    const client = await connectDatabase(pool);
    await client.query('LISTEN job_queued');

    expect(pool.connectCalls).toBe(1);
    expect(pool.client.queries).toEqual([{ text: 'LISTEN job_queued', values: [] }]);
  });

  it('registers notification and error listeners on the connected client', async () => {
    const pool = new FakePool();
    const notificationListener = vi.fn();
    const errorListener = vi.fn();

    const client = await connectDatabase(pool);
    client.onNotification(notificationListener);
    client.onError(errorListener);

    const notification = { channel: 'job_queued', payload: '42' };
    const error = new Error('connection lost');
    pool.client.emit('notification', notification);
    pool.client.emit('error', error);

    expect(notificationListener).toHaveBeenCalledWith(notification);
    expect(errorListener).toHaveBeenCalledWith(error);
  });
});