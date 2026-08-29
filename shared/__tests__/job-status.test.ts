import { describe, it, expect } from 'vitest';
import { JOB_STATUSES, insertMatchGenerationJobSchema } from '../schema';

describe('job status contract', () => {
  it('defines the canonical set of statuses', () => {
    expect(JOB_STATUSES).toEqual([
      'PENDING',
      'PROCESSING',
      'COMPLETED',
      'FAILED',
      'RETRYING',
      'CANCELLED',
    ]);
  });

  it('accepts every canonical status in the insert schema', () => {
    for (const status of JOB_STATUSES) {
      const parsed = insertMatchGenerationJobSchema.safeParse({
        userId: 1,
        jobType: 'MATCH_DESCRIPTION',
        idempotencyKey: 'test-job-key',
        status,
      });
      expect(parsed.success, `status ${status} should be valid`).toBe(true);
    }
  });

  it('rejects legacy/unknown statuses', () => {
    for (const status of ['IN_PROGRESS', 'pending', 'DONE', '']) {
      const parsed = insertMatchGenerationJobSchema.safeParse({
        userId: 1,
        jobType: 'MATCH_DESCRIPTION',
        status,
      });
      expect(parsed.success, `status ${status} should be invalid`).toBe(false);
    }
  });

  it('defaults to PENDING', () => {
    const parsed = insertMatchGenerationJobSchema.parse({
      userId: 1,
      jobType: 'MATCH_DESCRIPTION',
      idempotencyKey: 'test-job-key',
    });
    expect(parsed.status).toBe('PENDING');
  });
});
