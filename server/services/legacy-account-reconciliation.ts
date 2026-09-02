import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { matchGenerationJobs, users, type User } from '@shared/schema';
import { hasRequiredFieldsForMatching } from '../lib/profile-matching';
import { evaluateFirebaseProviderEvidence } from '../lib/firebase-admin';
import { backgroundJobQueue } from './background-job-queue';
import {
  buildMatchGenerationIdempotencyKey,
  getMatchGenerationScope,
} from '@shared/match-generation-contract';

export const LEGACY_RECONCILIATION_POLICY_VERSION = '1';

export interface ApprovedLegacyAccountRepair {
  userId: number;
  expectedFirebaseUid: string;
  expectedEmail: string;
  legacyEvidence: string;
  completionEvidence: string;
  approvedBy: string;
  approvedAt: string;
}

export interface ProviderEvidenceInput {
  uid: string;
  email?: string | null;
  emailVerified: boolean;
}

export interface SafeAccountState {
  profileVisible: boolean;
  emailVerified: boolean;
  registrationCompleted: boolean;
  hasMinimumMatchData: boolean;
  initialMatchJobsQueued: boolean;
  profileVersion: number;
}

export interface ReconciliationResult {
  status: 'applied' | 'already-reconciled' | 'unchanged';
  reason?: string;
  before?: SafeAccountState;
  after?: SafeAccountState;
  queue?: {
    status: 'queued' | 'reused';
    jobId: number;
    idempotencyKey: string;
    initialMatchJobsQueued: boolean;
  };
}

function safeAccountState(user: User): SafeAccountState {
  return {
    profileVisible: user.profileVisible,
    emailVerified: user.emailVerified,
    registrationCompleted: user.registrationCompleted,
    hasMinimumMatchData: user.hasMinimumMatchData,
    initialMatchJobsQueued: user.initialMatchJobsQueued,
    profileVersion: user.profileVersion,
  };
}

export function validateApprovedLegacyAccountRepair(
  approval: ApprovedLegacyAccountRepair,
): void {
  if (!Number.isSafeInteger(approval.userId) || approval.userId < 1) {
    throw new Error('Approved account userId must be a positive integer');
  }
  for (const [field, value] of Object.entries({
    expectedFirebaseUid: approval.expectedFirebaseUid,
    expectedEmail: approval.expectedEmail,
    legacyEvidence: approval.legacyEvidence,
    completionEvidence: approval.completionEvidence,
    approvedBy: approval.approvedBy,
    approvedAt: approval.approvedAt,
  })) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`Approved account ${field} is required`);
    }
  }
  if (!Number.isNaN(Date.parse(approval.approvedAt))) return;
  throw new Error('Approved account approvedAt must be an ISO date');
}

export function providerEvidencePasses(
  approval: ApprovedLegacyAccountRepair,
  providerUser: ProviderEvidenceInput,
): boolean {
  return evaluateFirebaseProviderEvidence(
    approval.expectedFirebaseUid,
    approval.expectedEmail,
    providerUser,
  ).allGatesPass;
}

/**
 * Apply one explicitly approved repair. Provider evidence is checked by the
 * caller immediately before this method and the identity is checked again
 * while the database row is locked. This method never changes visibility or
 * profile data.
 */
export async function applyApprovedLegacyAccountRepair(
  approval: ApprovedLegacyAccountRepair,
  providerUser: ProviderEvidenceInput,
): Promise<ReconciliationResult> {
  validateApprovedLegacyAccountRepair(approval);
  if (!providerEvidencePasses(approval, providerUser)) {
    return {
      status: 'unchanged',
      reason: 'provider-identity-gates-failed',
    };
  }

  const transition = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(users)
      .where(eq(users.id, approval.userId))
      .for('update');

    if (!current) {
      return { status: 'unchanged' as const, reason: 'account-not-found' };
    }

    const identity = evaluateFirebaseProviderEvidence(
      approval.expectedFirebaseUid,
      approval.expectedEmail,
      {
        uid: current.firebaseUid ?? '',
        email: current.email,
        emailVerified: providerUser.emailVerified,
      },
    );
    if (
      !identity.uidMatches ||
      !identity.emailMatches ||
      !providerUser.emailVerified
    ) {
      return {
        status: 'unchanged' as const,
        reason: 'database-identity-gates-failed',
        before: safeAccountState(current),
        after: safeAccountState(current),
      };
    }

    const before = safeAccountState(current);
    if (!hasRequiredFieldsForMatching(current)) {
      return {
        status: 'unchanged' as const,
        reason: 'minimum-profile-data-not-satisfied',
        before,
        after: before,
      };
    }

    if (
      current.emailVerified &&
      current.registrationCompleted &&
      current.hasMinimumMatchData
    ) {
      return {
        status: 'already-reconciled' as const,
        before,
        after: before,
      };
    }

    const [updated] = await tx
      .update(users)
      .set({
        emailVerified: true,
        registrationCompleted: true,
        hasMinimumMatchData: true,
      })
      .where(
        and(
          eq(users.id, approval.userId),
          eq(users.firebaseUid, approval.expectedFirebaseUid),
        ),
      )
      .returning();

    if (!updated) {
      return {
        status: 'unchanged' as const,
        reason: 'identity-changed-before-update',
        before,
        after: before,
      };
    }

    return {
      status: 'applied' as const,
      before,
      after: safeAccountState(updated),
    };
  });

  if (
    transition.status !== 'applied' &&
    transition.status !== 'already-reconciled'
  ) {
    return transition;
  }

  const profileVersion = transition.after?.profileVersion;
  if (profileVersion == null) {
    return {
      status: 'unchanged',
      reason: 'profile-version-unavailable',
      before: transition.before,
      after: transition.after,
    };
  }
  const generationScope = getMatchGenerationScope(
    'MATCH_DESCRIPTION',
    undefined,
    undefined,
  );
  const idempotencyKey = buildMatchGenerationIdempotencyKey({
    jobType: 'MATCH_DESCRIPTION',
    userId: approval.userId,
    userProfileVersion: profileVersion,
    targetUserId: undefined,
    targetUserProfileVersion: undefined,
    generationScope,
  });
  const [existingSeed] = await db
    .select({ id: matchGenerationJobs.id })
    .from(matchGenerationJobs)
    .where(eq(matchGenerationJobs.idempotencyKey, idempotencyKey))
    .limit(1);

  const queuedJob = await backgroundJobQueue.queueJob(
    approval.userId,
    'MATCH_DESCRIPTION',
    {
      userId: approval.userId,
      updateType: 'fallback_full',
    },
    1,
    5,
  );

  const [marked] = await db
    .update(users)
    .set({
      initialMatchJobsQueued: true,
      initialMatchJobsQueuedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(users.id, approval.userId),
        eq(users.emailVerified, true),
        eq(users.registrationCompleted, true),
        eq(users.hasMinimumMatchData, true),
        eq(users.initialMatchJobsQueued, false),
      ),
    )
    .returning({
      initialMatchJobsQueued: users.initialMatchJobsQueued,
    });

  const initialMatchJobsQueued =
    marked?.initialMatchJobsQueued === true ||
    transition.after?.initialMatchJobsQueued === true;
  const after = transition.after;
  const safeAfter = after
    ? { ...after, initialMatchJobsQueued }
    : undefined;
  return {
    ...transition,
    after: safeAfter,
    queue: {
      status: existingSeed ? 'reused' : 'queued',
      jobId: queuedJob.id,
      idempotencyKey: queuedJob.idempotencyKey,
      initialMatchJobsQueued,
    },
  };
}
