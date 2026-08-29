export type MatchGenerationScope =
  | 'TARGETLESS_SEED'
  | 'DIRECTED_MATCH'
  | 'BATCH_PROFILES'
  | 'PROFILE_UPDATE';

export interface MatchGenerationIdentity {
  jobType: string;
  userId: number;
  targetUserId?: number | null;
  userProfileVersion?: number | null;
  targetUserProfileVersion?: number | null;
  generationScope: MatchGenerationScope;
  regenerationEpoch?: number | null;
}

export function getMatchGenerationScope(
  jobType: string,
  targetUserId: number | null | undefined,
  mode?: string,
): MatchGenerationScope {
  if (targetUserId == null && mode === 'SUMMARY_STUB') return 'TARGETLESS_SEED';
  if (jobType === 'BATCH_PROFILES') return 'BATCH_PROFILES';
  if (jobType === 'USER_PROFILE_UPDATE') return 'PROFILE_UPDATE';
  return targetUserId == null ? 'TARGETLESS_SEED' : 'DIRECTED_MATCH';
}

export function buildMatchGenerationIdempotencyKey(identity: MatchGenerationIdentity): string {
  const target = identity.targetUserId == null ? 'SEED' : String(identity.targetUserId);
  const sourceVersion = identity.userProfileVersion == null
    ? 'UNKNOWN'
    : String(identity.userProfileVersion);
  const targetVersion = identity.targetUserProfileVersion == null
    ? 'UNKNOWN'
    : String(identity.targetUserProfileVersion);
  const epoch = identity.regenerationEpoch == null ? '0' : String(identity.regenerationEpoch);

  return [
    'match-generation-v1',
    identity.jobType,
    identity.generationScope,
    identity.userId,
    target,
    sourceVersion,
    targetVersion,
    epoch,
  ].join(':');
}