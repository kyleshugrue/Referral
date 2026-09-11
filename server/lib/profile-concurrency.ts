import type { User } from '@shared/schema';

export const MATCH_RELEVANT_PROFILE_FIELDS = [
  'currentCompany',
  'currentLocation',
  'industry',
  'desiredCompanies',
  'desiredLocations',
] as const;

type RequestWithProfileVersion = {
  headers: Record<string, unknown>;
  body?: unknown;
};

export function parseExpectedProfileVersion(
  req: RequestWithProfileVersion,
): number | undefined {
  const header = req.headers['if-match'];
  const bodyVersion = req.body && typeof req.body === 'object'
    ? (req.body as Record<string, unknown>).profileVersion
    : undefined;
  const rawValue = header ?? bodyVersion;
  if (Array.isArray(rawValue)) return undefined;
  const raw = typeof rawValue === 'string'
    ? rawValue.trim().replace(/^W\//i, '').replace(/^"|"$/g, '')
    : rawValue;
  const version = typeof raw === 'number' ? raw : Number(raw);
  return Number.isInteger(version) && version > 0 ? version : undefined;
}

function normalizedArray(value: unknown): unknown {
  return Array.isArray(value)
    ? [...value].sort((left, right) => String(left).localeCompare(String(right)))
    : value;
}

export function profileValueChanged(oldValue: unknown, newValue: unknown): boolean {
  if (newValue === undefined) return false;
  return JSON.stringify(normalizedArray(oldValue)) !== JSON.stringify(normalizedArray(newValue));
}

export function prepareProfileVersionedUpdate(
  existingUser: User,
  updateData: Record<string, unknown>,
  req: RequestWithProfileVersion,
): {
  updateData: Record<string, unknown>;
  changedMatchFields: string[];
  hasMatchRelevantChanges: boolean;
  expectedProfileVersion: number;
  nextProfileVersion: number;
} {
  const changedMatchFields = MATCH_RELEVANT_PROFILE_FIELDS.filter((field) =>
    profileValueChanged(existingUser[field], updateData[field]),
  );
  const hasMatchRelevantChanges = changedMatchFields.length > 0;
  const currentProfileVersion = existingUser.profileVersion || 1;
  const nextProfileVersion = hasMatchRelevantChanges
    ? currentProfileVersion + 1
    : currentProfileVersion;

  return {
    updateData: {
      ...updateData,
      ...(hasMatchRelevantChanges ? { profileVersion: nextProfileVersion } : {}),
    },
    changedMatchFields,
    hasMatchRelevantChanges,
    expectedProfileVersion: parseExpectedProfileVersion(req) ?? currentProfileVersion,
    nextProfileVersion,
  };
}