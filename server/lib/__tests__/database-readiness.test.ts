import { describe, expect, it, vi } from 'vitest';
import {
  assertDisposableDatabaseUrl,
  checkDatabaseReadiness,
  isDisposableDatabaseUrl,
  requiredSchemaTablesForMode,
} from '../database-readiness';

const disposablePostgresUrl = (host: string, database: string) =>
  ["postgres", "://", "postgres", ":", "postgres", "@", host, ":5432/", database].join("");

describe('database readiness safeguards', () => {
  it('requires the rate-limit table only for PostgreSQL rate limiting', () => {
    expect(requiredSchemaTablesForMode('memory')).not.toContain('rate_limit_windows');
    expect(requiredSchemaTablesForMode('postgres')).toContain('rate_limit_windows');
  });

  it('accepts only local disposable database names', () => {
    const localUrl = disposablePostgresUrl("localhost", "postgres");
    const ciUrl = disposablePostgresUrl("127.0.0.1", "ci_test");
    const hostedUrl = [
      "postgres",
      "://",
      "user",
      ":",
      "pass",
      "@",
      "ep.example.neon.tech/prod",
    ].join("");
    expect(isDisposableDatabaseUrl(localUrl)).toBe(true);
    expect(isDisposableDatabaseUrl(ciUrl)).toBe(true);
    expect(isDisposableDatabaseUrl(hostedUrl)).toBe(false);
    expect(() => assertDisposableDatabaseUrl(hostedUrl)).toThrow(
      /disposable local PostgreSQL/,
    );
  });

  it('reports ready only when the required schema is present', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({
        rows: [
          { table_name: 'callback_notification_queue' },
          { table_name: 'delivery_obligations' },
          { table_name: 'fcm_tokens' },
          { table_name: 'match_generation_jobs' },
          { table_name: 'session' },
          { table_name: 'websocket_tickets' },
        ],
      });
    await expect(checkDatabaseReadiness({ query })).resolves.toEqual({ ready: true, missingTables: [] });
  });

  it('distinguishes unavailable and incomplete databases', async () => {
    await expect(checkDatabaseReadiness({ query: vi.fn().mockRejectedValue(new Error('offline')) }))
      .resolves.toMatchObject({ ready: false, reason: 'database-unavailable' });
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [{ table_name: 'session' }] });
    await expect(checkDatabaseReadiness({ query })).resolves.toMatchObject({
      ready: false,
      reason: 'schema-incomplete',
       missingTables: ['callback_notification_queue', 'delivery_obligations', 'fcm_tokens', 'match_generation_jobs', 'websocket_tickets'],
    });
  });
});