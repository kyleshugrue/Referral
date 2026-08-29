import { describe, it, expect } from 'vitest';
import {
  decidePostRegistrationFlow,
  type VerificationUiFlags,
} from '../verification-ui-state';

function flags(overrides: Partial<VerificationUiFlags> = {}): VerificationUiFlags {
  return {
    emailVerificationHandled: false,
    emailVerificationUiComplete: false,
    registrationRedirectReady: false,
    emailVerifiedFlag: false,
    forceNavigateToNetwork: false,
    ...overrides,
  };
}

describe('decidePostRegistrationFlow', () => {
  it('prompts for verification when email is unverified and nothing handled it', () => {
    expect(decidePostRegistrationFlow(false, flags())).toBe('verify-email');
  });

  it('proceeds when the email is already verified server-side', () => {
    expect(decidePostRegistrationFlow(true, flags())).toBe('proceed');
  });

  it('proceeds when verification status is unknown (no Firebase user)', () => {
    expect(decidePostRegistrationFlow(null, flags())).toBe('proceed');
  });

  it('proceeds when the registration redirect flag is set', () => {
    expect(
      decidePostRegistrationFlow(false, flags({ registrationRedirectReady: true })),
    ).toBe('proceed');
  });

  it('proceeds when force-navigate is set', () => {
    expect(
      decidePostRegistrationFlow(false, flags({ forceNavigateToNetwork: true })),
    ).toBe('proceed');
  });

  it('does not re-prompt when the verification step was already handled', () => {
    expect(
      decidePostRegistrationFlow(false, flags({ emailVerificationHandled: true })),
    ).toBe('proceed');
  });

  it('does not re-prompt when the in-app verification UI completed', () => {
    expect(
      decidePostRegistrationFlow(false, flags({ emailVerificationUiComplete: true })),
    ).toBe('proceed');
  });

  it('does not re-prompt when the legacy emailVerified hint is set', () => {
    expect(
      decidePostRegistrationFlow(false, flags({ emailVerifiedFlag: true })),
    ).toBe('proceed');
  });

  it('redirect flags win even when email is unverified and nothing else is set', () => {
    expect(
      decidePostRegistrationFlow(
        false,
        flags({ registrationRedirectReady: true, forceNavigateToNetwork: true }),
      ),
    ).toBe('proceed');
  });
});
