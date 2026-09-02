import { describe, expect, it } from 'vitest';
import {
  DISCOVERABILITY_POLICY_VERSION,
  getDiscoverabilityAction,
  getMatchGenerationState,
  getMatchEligibilityState,
  getDiscoverabilityState,
  isDiscoverableProfile,
  isMatchEligibleProfile,
} from '../discoverability-policy';

const eligible = {
  profileVisible: true,
  emailVerified: true,
  registrationCompleted: true,
  hasMinimumMatchData: true,
};

describe('discoverability policy', () => {
  it('has a versioned eligible state only when every peer boundary is true', () => {
    expect(DISCOVERABILITY_POLICY_VERSION).toBe('1');
    expect(getDiscoverabilityState(eligible)).toBe('eligible');
    expect(isDiscoverableProfile(eligible)).toBe(true);
  });

  it.each([
    ['profileVisible', 'profile_hidden', 'make_profile_visible'],
    ['emailVerified', 'email_unverified', 'verify_email'],
    ['registrationCompleted', 'registration_incomplete', 'complete_profile'],
  ] as const)('classifies %s as %s with action %s', (field, state, action) => {
    expect(getDiscoverabilityState({ ...eligible, [field]: false })).toBe(state);
    expect(getDiscoverabilityAction(state)).toBe(action);
    expect(isDiscoverableProfile({ ...eligible, [field]: false })).toBe(false);
  });

  it('keeps match readiness separate from peer profile visibility', () => {
    const incompleteMatchData = { ...eligible, hasMinimumMatchData: false };
    expect(getDiscoverabilityState(incompleteMatchData)).toBe('eligible');
    expect(isDiscoverableProfile(incompleteMatchData)).toBe(true);
    expect(getMatchEligibilityState(incompleteMatchData)).toBe('match_data_incomplete');
    expect(isMatchEligibleProfile(incompleteMatchData)).toBe(false);
    expect(getDiscoverabilityAction('registration_incomplete')).toBe('complete_profile');
    expect(getMatchGenerationState(incompleteMatchData)).toBe('match_data_incomplete');
    expect(getMatchGenerationState({ ...incompleteMatchData, profileVisible: false })).toBe('match_data_incomplete');
  });

  it('checks the most restrictive missing state first', () => {
    expect(getDiscoverabilityState({
      profileVisible: false,
      emailVerified: false,
      registrationCompleted: false,
      hasMinimumMatchData: false,
    })).toBe('profile_hidden');
  });
});