import { z } from 'zod';
import { educationLevels, PROFILE_INPUT_LIMITS } from '@shared/schema';

const registrationArray = z.union([
  z.array(z.string().trim().max(PROFILE_INPUT_LIMITS.arrayItemChars)).max(PROFILE_INPUT_LIMITS.arrayItems),
  z.string().trim().max(PROFILE_INPUT_LIMITS.aggregateBytes),
  z.null(),
]).optional();

/**
 * Registration clients have historically echoed identity fields while the
 * server derives them from Firebase. Keep those fields as explicit,
 * non-persisted compatibility inputs so every other unknown key fails closed.
 */
export const registrationInputSchema = z.object({
  email: z.string().trim().max(320).optional(),
  username: z.string().trim().max(PROFILE_INPUT_LIMITS.stringChars).optional(),
  firebaseUid: z.string().trim().max(PROFILE_INPUT_LIMITS.stringChars).optional(),
  emailVerified: z.boolean().optional(),

  fullName: z.string().trim().max(PROFILE_INPUT_LIMITS.stringChars).optional(),
  birthday: z.string().trim().max(PROFILE_INPUT_LIMITS.stringChars).nullable().optional(),
  title: z.string().trim().max(PROFILE_INPUT_LIMITS.stringChars).nullable().optional(),
  currentLocation: z.string().trim().max(PROFILE_INPUT_LIMITS.stringChars).nullable().optional(),
  industry: z.string().trim().max(PROFILE_INPUT_LIMITS.stringChars).nullable().optional(),
  currentCompany: z.string().trim().max(PROFILE_INPUT_LIMITS.stringChars).nullable().optional(),
  yearsOfExperience: z.coerce.number().int().min(0).nullable().optional(),
  matchingRadius: z.coerce.number().int().min(0).max(100).nullable().optional(),
  bio: z.string().trim().max(PROFILE_INPUT_LIMITS.bioChars).nullable().optional(),
  photo: z.string().trim().max(PROFILE_INPUT_LIMITS.urlChars).nullable().optional(),
  resumeUrl: z.string().trim().max(PROFILE_INPUT_LIMITS.urlChars).nullable().optional(),
  resumePreviewUrls: z.array(z.string().trim().max(PROFILE_INPUT_LIMITS.arrayItemChars)).max(PROFILE_INPUT_LIMITS.arrayItems).nullable().optional(),
  interests: registrationArray,
  professionalInterests: registrationArray,
  languages: registrationArray,
  desiredLocations: registrationArray,
  desiredCompanies: registrationArray,
  educationLevel: z.enum(educationLevels).nullable().optional(),
  institution: z.string().trim().max(PROFILE_INPUT_LIMITS.stringChars).nullable().optional(),
  profileVisible: z.boolean().optional(),
  emailNotifications: z.boolean().optional(),
  readReceipts: z.boolean().optional(),
}).strict().superRefine((value, ctx) => {
  if (JSON.stringify(value).length > PROFILE_INPUT_LIMITS.aggregateBytes) {
    ctx.addIssue({
      code: z.ZodIssueCode.too_big,
      type: 'string',
      maximum: PROFILE_INPUT_LIMITS.aggregateBytes,
      inclusive: true,
      message: 'Registration payload is too large',
    });
  }
});

export function normalizeStringArray(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean))];
}

export type RegistrationInput = z.infer<typeof registrationInputSchema>;

export function parseRegistrationInput(body: unknown): RegistrationInput {
  return registrationInputSchema.parse(body);
}