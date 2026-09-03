import { describe, expect, it, vi } from 'vitest';
import {
  assertDisposableDatabaseUrl,
  checkDatabaseReadiness,
  requiredSchemaColumnsForTables,
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
          { table_name: 'account_erasure_jobs' },
          { table_name: 'fcm_tokens' },
          { table_name: 'match_generation_jobs' },
          { table_name: 'session' },
          { table_name: 'users' },
          { table_name: 'websocket_tickets' },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { table_name: 'users', column_name: 'account_status' },
          { table_name: 'users', column_name: 'deletion_requested_at' },
          { table_name: 'users', column_name: 'deletion_completed_at' },
          { table_name: 'callback_notification_queue', column_name: 'dedupe_key' },
          { table_name: 'delivery_obligations', column_name: 'id' },
          { table_name: 'delivery_obligations', column_name: 'user_id' },
          { table_name: 'delivery_obligations', column_name: 'event_type' },
          { table_name: 'delivery_obligations', column_name: 'payload' },
          { table_name: 'delivery_obligations', column_name: 'dedupe_key' },
          { table_name: 'delivery_obligations', column_name: 'expires_at' },
          { table_name: 'delivery_obligations', column_name: 'status' },
          { table_name: 'delivery_obligations', column_name: 'created_at' },
          { table_name: 'delivery_obligations', column_name: 'completed_at' },
          { table_name: 'account_erasure_jobs', column_name: 'id' },
          { table_name: 'account_erasure_jobs', column_name: 'user_id' },
          { table_name: 'account_erasure_jobs', column_name: 'status' },
          { table_name: 'account_erasure_jobs', column_name: 'attempt_count' },
          { table_name: 'account_erasure_jobs', column_name: 'next_attempt_at' },
          { table_name: 'account_erasure_jobs', column_name: 'last_error_code' },
          { table_name: 'account_erasure_jobs', column_name: 'requested_at' },
          { table_name: 'account_erasure_jobs', column_name: 'started_at' },
          { table_name: 'account_erasure_jobs', column_name: 'completed_at' },
          ...[
            'id',
            'email',
            'full_name',
            'birthday',
            'title',
            'current_location',
            'current_location_lat',
            'current_location_lng',
            'firebase_uid',
            'desired_locations',
            'desired_location_coords',
            'industry',
            'current_company',
            'desired_companies',
            'matching_radius',
            'years_of_experience',
            'bio',
            'photo',
            'resume_url',
            'resume_preview_urls',
            'interests',
            'professional_interests',
            'languages',
            'education_level',
            'institution',
            'profile_visible',
            'email_notifications',
            'read_receipts',
            'email_verification_started',
            'email_verified',
            'registration_completed',
            'has_minimum_match_data',
            'profile_version',
            'current_snapshot_id',
            'initial_match_jobs_queued',
            'initial_match_jobs_queued_at',
          ].map((column_name) => ({ table_name: 'users', column_name })),
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { indexname: 'callback_notification_queue_dedupe_key_idx' },
          { indexname: 'delivery_obligations_pending_idx' },
          { indexname: 'account_erasure_jobs_user_id_idx' },
          { indexname: 'account_erasure_jobs_status_attempt_idx' },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { table_name: 'users', constraint_type: 'PRIMARY KEY', column_names: ['id'], foreign_table_name: null },
          { table_name: 'delivery_obligations', constraint_type: 'PRIMARY KEY', column_names: ['id'], foreign_table_name: null },
          { table_name: 'delivery_obligations', constraint_type: 'UNIQUE', column_names: ['dedupe_key'], foreign_table_name: null },
          { table_name: 'delivery_obligations', constraint_type: 'FOREIGN KEY', column_names: ['user_id'], foreign_table_name: 'users' },
          { table_name: 'account_erasure_jobs', constraint_type: 'PRIMARY KEY', column_names: ['id'], foreign_table_name: null },
        ],
      });
    await expect(checkDatabaseReadiness({ query })).resolves.toEqual({
      ready: true,
      missingTables: [],
      missingColumns: [],
      invalidColumns: [],
      missingIndexes: [],
      missingConstraints: [],
    });
  });

  it('distinguishes unavailable and incomplete databases', async () => {
    await expect(checkDatabaseReadiness({ query: vi.fn().mockRejectedValue(new Error('offline')) }))
      .resolves.toMatchObject({ ready: false, reason: 'database-unavailable', missingColumns: expect.any(Array) });
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [{ table_name: 'session' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(checkDatabaseReadiness({ query })).resolves.toMatchObject({
      ready: false,
      reason: 'schema-incomplete',
       missingTables: [
         'callback_notification_queue',
         'delivery_obligations',
         'account_erasure_jobs',
         'fcm_tokens',
         'match_generation_jobs',
         'users',
         'websocket_tickets',
       ],
       missingColumns: expect.arrayContaining(['users.account_status']),
       invalidColumns: expect.any(Array),
    });
  });

  it('reports missing columns independently from missing tables', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({
        rows: [
          ...new Set([
            ...requiredSchemaTablesForMode('memory'),
          ]),
        ].map((table_name) => ({ table_name })),
      })
      .mockResolvedValueOnce({
        rows: [{ table_name: 'users', column_name: 'account_status' }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await checkDatabaseReadiness({ query });
    expect(result.ready).toBe(false);
    expect(result.reason).toBe('schema-incomplete');
    expect(result.missingTables).toEqual([]);
    expect(result.missingColumns).toContain('users.deletion_requested_at');
    expect(result.missingColumns).toContain('delivery_obligations.id');
  });

  it('supports a targeted table check without column inspection', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [{ table_name: 'delivery_obligations' }] });

    await expect(checkDatabaseReadiness(
      { query },
      ['delivery_obligations'],
      [],
      [],
      [],
    )).resolves.toEqual({
      ready: true,
      missingTables: [],
      missingColumns: [],
      invalidColumns: [],
      missingIndexes: [],
      missingConstraints: [],
    });
    expect(requiredSchemaColumnsForTables(['delivery_obligations'])).not.toHaveLength(0);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('reports wrong types, nullability, and missing defaults', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [{ table_name: 'users' }] })
      .mockResolvedValueOnce({
        rows: [{
          table_name: 'users',
          column_name: 'account_status',
          data_type: 'character varying',
          is_nullable: 'YES',
          column_default: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await checkDatabaseReadiness(
      { query },
      ['users'],
      [{ tableName: 'users', columnName: 'account_status' }],
      [],
    );
    expect(result.ready).toBe(false);
    expect(result.missingColumns).toEqual([]);
    expect(result.invalidColumns).toEqual([
      'users.account_status:type',
      'users.account_status:nullable',
      'users.account_status:default',
    ]);
  });

  it('reports missing required indexes and constraints', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [{ table_name: 'delivery_obligations' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await checkDatabaseReadiness(
      { query },
      ['delivery_obligations'],
      [],
      [{ tableName: 'delivery_obligations', indexName: 'delivery_obligations_pending_idx' }],
      [{ tableName: 'delivery_obligations', constraintType: 'PRIMARY KEY', columns: ['id'] }],
    );

    expect(result.ready).toBe(false);
    expect(result.missingIndexes).toEqual(['delivery_obligations_pending_idx']);
    expect(result.missingConstraints).toEqual(['delivery_obligations:PRIMARY KEY:id']);
  });
});