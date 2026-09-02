import { and, eq } from 'drizzle-orm';
import { users } from '@shared/schema';
import type { User } from '@shared/schema';

/**
 * Version the server-side contract so runtime evidence and clients can be
 * compared without relying on deployment timestamps.
 */
export const DISCOVERABILITY_POLICY_VERSION = '1';

export type DiscoverabilityState =
  | 'eligible'
  | 'profile_hidden'
  | 'email_unverified'
  | 'registration_incomplete';

export type MatchEligibilityState = DiscoverabilityState | 'match_data_incomplete';
export type MatchGenerationState =
  | 'eligible'
  | 'email_unverified'
  | 'registration_incomplete'
  | 'match_data_incomplete';

export type DiscoverabilityProfile = Pick<
  User,
  'profileVisible' | 'emailVerified' | 'registrationCompleted' | 'hasMinimumMatchData'
>;

/**
 * Peer discovery is deliberately stricter than merely having a user row.
 * Keep this pure so it can be used by route tests, reconciliation tooling, and
 * future clients without opening a database connection.
 */
export function getDiscoverabilityState(user: DiscoverabilityProfile): DiscoverabilityState {
  if (user.profileVisible !== true) return 'profile_hidden';
  if (user.emailVerified !== true) return 'email_unverified';
  if (user.registrationCompleted !== true) return 'registration_incomplete';
  return 'eligible';
}

export function isDiscoverableProfile(user: DiscoverabilityProfile): boolean {
  return getDiscoverabilityState(user) === 'eligible';
}

export function getMatchEligibilityState(user: DiscoverabilityProfile): MatchEligibilityState {
  const discoverabilityState = getDiscoverabilityState(user);
  if (discoverabilityState !== 'eligible') return discoverabilityState;
  if (user.hasMinimumMatchData !== true) return 'match_data_incomplete';
  return 'eligible';
}

export function isMatchEligibleProfile(user: DiscoverabilityProfile): boolean {
  return getMatchEligibilityState(user) === 'eligible';
}

/**
 * The owner may still browse their own Network page while their profile is
 * hidden. Hidden controls peer discovery, not access to the owner's account.
 */
export function getMatchGenerationState(user: DiscoverabilityProfile): MatchGenerationState {
  if (user.emailVerified !== true) return 'email_unverified';
  if (user.registrationCompleted !== true) return 'registration_incomplete';
  if (user.hasMinimumMatchData !== true) return 'match_data_incomplete';
  return 'eligible';
}

/**
 * SQL equivalent of getDiscoverabilityState(...)=eligible for the shared
 * users table. SQL filtering is required before selecting a peer row so an
 * in-memory post-filter can never accidentally serialize an ineligible user.
 */
export function discoverableUserCondition() {
  return and(
    eq(users.profileVisible, true),
    eq(users.registrationCompleted, true),
    eq(users.emailVerified, true),
  );
}

export function matchableUserCondition() {
  return and(
    discoverableUserCondition(),
    eq(users.hasMinimumMatchData, true),
  );
}

export function getDiscoverabilityAction(state: DiscoverabilityState | 'match_data_incomplete'): string | undefined {
  switch (state) {
    case 'email_unverified':
      return 'verify_email';
    case 'registration_incomplete':
    case 'match_data_incomplete':
      return 'complete_profile';
    case 'profile_hidden':
      return 'make_profile_visible';
    case 'eligible':
      return undefined;
  }
}