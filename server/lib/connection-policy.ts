/**
 * Pure decision logic for creating a connection request.
 *
 * Intentionally free of DB/network access so it can be unit tested directly.
 * `storage.createConnectionRequest` calls this after looking up any existing
 * request between the two users, then acts on the decision.
 */

export interface ConnectionRequestDecision {
  allowed: boolean;
  reason?: string;
}

/**
 * Decide whether a new connection request may be created, given how many
 * existing requests already exist between the two users (in either
 * direction). Mirrors the long-standing duplicate-request guard.
 */
export function decideConnectionRequestCreation(
  existingRequestCount: number
): ConnectionRequestDecision {
  if (existingRequestCount > 0) {
    return { allowed: false, reason: 'Connection request already exists' };
  }
  return { allowed: true };
}
