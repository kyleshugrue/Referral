import type {
  ClientRateLimitInfo,
  IncrementResponse,
  Options,
  Store,
} from 'express-rate-limit';
import { createHmac } from 'node:crypto';
import { pool } from '../db';
import { queryDatabase } from './database-client';
import { logger } from './logger';

type RateLimitRow = {
  total_hits: number;
  reset_time: string;
};

/**
 * A small atomic PostgreSQL store for express-rate-limit.
 *
 * The counter update and window rollover happen in one INSERT ... ON CONFLICT
 * statement, so concurrent application instances cannot lose increments. Keys
 * are already pseudonymous before reaching this store.
 */
export class PostgresRateLimitStore implements Store {
  private windowMs = 60_000;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(private readonly scope: string) {}

  init(options: Options): void {
    this.windowMs = options.windowMs;
    this.cleanupTimer = setInterval(() => {
      void this.cleanup().catch((error) => {
        logger.warn('[RateLimit] bounded cleanup failed', error);
      });
    }, Math.max(this.windowMs, 5 * 60_000));
    this.cleanupTimer.unref?.();
  }

  async increment(key: string): Promise<IncrementResponse> {
    const storageKey = `${this.scope}:${key}`;
    const result = await queryDatabase<RateLimitRow>(
      pool,
      `
        INSERT INTO rate_limit_windows (key, window_started_at, hits, updated_at)
        VALUES ($1, now(), 1, now())
        ON CONFLICT (key) DO UPDATE
        SET
          window_started_at = CASE
            WHEN rate_limit_windows.window_started_at <= now() - ($2 * interval '1 millisecond')
              THEN now()
            ELSE rate_limit_windows.window_started_at
          END,
          hits = CASE
            WHEN rate_limit_windows.window_started_at <= now() - ($2 * interval '1 millisecond')
              THEN 1
            ELSE rate_limit_windows.hits + 1
          END,
          updated_at = now()
        RETURNING
          hits AS total_hits,
          window_started_at + ($2 * interval '1 millisecond') AS reset_time
      `,
      [storageKey, this.windowMs],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Rate-limit store returned no counter row.');
    return {
      totalHits: Number(row.total_hits),
      resetTime: new Date(row.reset_time),
    };
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    const storageKey = `${this.scope}:${key}`;
    const result = await queryDatabase<RateLimitRow>(
      pool,
      `
        SELECT
          hits AS total_hits,
          window_started_at + ($2 * interval '1 millisecond') AS reset_time
        FROM rate_limit_windows
        WHERE key = $1
      `,
      [storageKey, this.windowMs],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    if (new Date(row.reset_time).getTime() <= Date.now()) return undefined;
    return {
      totalHits: Number(row.total_hits),
      resetTime: new Date(row.reset_time),
    };
  }

  async decrement(key: string): Promise<void> {
    await queryDatabase(pool, 'UPDATE rate_limit_windows SET hits = GREATEST(hits - 1, 0), updated_at = now() WHERE key = $1', [`${this.scope}:${key}`]);
  }

  async resetKey(key: string): Promise<void> {
    await queryDatabase(pool, 'DELETE FROM rate_limit_windows WHERE key = $1', [`${this.scope}:${key}`]);
  }

  async resetAll(): Promise<void> {
    await queryDatabase(pool, 'DELETE FROM rate_limit_windows WHERE key LIKE $1', [`${this.scope}:%`]);
  }

  async shutdown(): Promise<void> {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  private async cleanup(): Promise<void> {
    await queryDatabase(
      pool,
      `
        DELETE FROM rate_limit_windows
        WHERE key IN (
          SELECT key
          FROM rate_limit_windows
          WHERE updated_at < now() - interval '1 day'
          ORDER BY updated_at
          LIMIT 1000
        )
      `,
    );
  }
}

/** Stable, non-reversible request key for shared limiter storage. */
export function pseudonymousRateLimitKey(scope: string, value: string, secret = process.env.SESSION_SECRET || process.env.JWT_SECRET || 'development-rate-limit-key'): string {
  return `${scope}:${createHmac('sha256', secret).update(value).digest('hex')}`;
}