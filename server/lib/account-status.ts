/**
 * Accounts created before account_status was introduced may have an absent
 * value in old fixtures/data. Only that legacy absence and the explicit active
 * state are admitted to normal application flows.
 */
export function isActiveAccountStatus(status: string | null | undefined): boolean {
  return status == null || status === 'active';
}

export function isActiveAccount(
  user: { accountStatus?: string | null } | null | undefined,
): boolean {
  return user != null && isActiveAccountStatus(user.accountStatus);
}