import { describe, expect, it } from 'vitest';

describe('migration integrity evidence', () => {
  it('verifies the checked-in SQL, journal, and checksum manifest without a database', async () => {
    const { verifyMigrationIntegrity } = await import('../migration-integrity.mjs');
    const result = await verifyMigrationIntegrity();

    expect(result.migrations.map((migration: { file: string }) => migration.file)).toEqual([
      '0000_calm_doctor_octopus.sql',
      '0001_violet_mad_thinker.sql',
      '0002_ws_ticket_sessions.sql',
      '0003_session_store.sql',
      '0004_match_generation_idempotency.sql',
      '0005_relational_consistency.sql',
      '0006_rate_limit_windows.sql',
    ]);
    expect(result.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
  });
});