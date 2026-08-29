/**
 * Client-side email verification UI state.
 *
 * These localStorage flags are UX hints only — they suppress redundant
 * verification prompts and redirects while a user moves through the
 * registration flow. They are NOT a security boundary: the server enforces
 * all real email verification and authorization, and never trusts these
 * values.
 */

export const VERIFICATION_UI_KEYS = {
  /** The user already handled the email-verification step in this flow. */
  emailVerificationHandled: 'emailVerificationHandled',
  /** The in-app verification UI (code entry) was completed. */
  emailVerificationUiComplete: 'emailVerificationUiComplete',
  /** Registration finished; the app should redirect to the network page. */
  registrationRedirectReady: 'registrationRedirectReady',
} as const;

export interface VerificationUiFlags {
  emailVerificationHandled: boolean;
  emailVerificationUiComplete: boolean;
  registrationRedirectReady: boolean;
  /** Legacy 'emailVerified' localStorage hint. */
  emailVerifiedFlag: boolean;
  forceNavigateToNetwork: boolean;
}

export type PostRegistrationDecision = 'proceed' | 'verify-email';

/**
 * Decide where the UI should send a user right after registration.
 *
 * @param serverEmailVerified - the authoritative verification status from
 *   Firebase (`currentUser.emailVerified`), or `null` when no Firebase user
 *   is available to consult.
 * @param flags - client-side UX hint flags (see above; never trusted for
 *   security, only used to avoid re-prompting).
 */
export function decidePostRegistrationFlow(
  serverEmailVerified: boolean | null,
  flags: VerificationUiFlags,
): PostRegistrationDecision {
  // Explicit redirect flags take priority: the flow already finished.
  if (flags.forceNavigateToNetwork || flags.registrationRedirectReady) {
    return 'proceed';
  }

  // Only prompt for verification when we positively know the email is
  // unverified AND no part of the flow has already handled it.
  if (
    serverEmailVerified === false &&
    !flags.emailVerificationHandled &&
    !flags.emailVerifiedFlag &&
    !flags.emailVerificationUiComplete
  ) {
    return 'verify-email';
  }

  return 'proceed';
}
