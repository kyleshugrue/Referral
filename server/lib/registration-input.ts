import { z } from 'zod';
import { educationLevels } from '@shared/schema';

const registrationArray = z.union([
  z.array(z.string()),
  z.string(),
  z.null(),
]).optional();

/**
 * Registration clients have historically echoed identity fields while the
 * server derives them from Firebase. Keep those fields as explicit,
 * non-persisted compatibility inputs so every other unknown key fails closed.
 */
export const registrationInputSchema = z.object({
  email: z.string().optional(),
  username: z.string().optional(),
  firebaseUid: z.string().optional(),
  emailVerified: z.boolean().optional(),

  fullName: z.string().optional(),
  birthday: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  currentLocation: z.string().nullable().optional(),
  industry: z.string().nullable().optional(),
  currentCompany: z.string().nullable().optional(),
  yearsOfExperience: z.coerce.number().int().min(0).nullable().optional(),
  matchingRadius: z.coerce.number().int().min(0).max(100).nullable().optional(),
  bio: z.string().nullable().optional(),
  photo: z.string().nullable().optional(),
  resumeUrl: z.string().nullable().optional(),
  resumePreviewUrls: z.array(z.string()).nullable().optional(),
  interests: registrationArray,
  professionalInterests: registrationArray,
  languages: registrationArray,
  desiredLocations: registrationArray,
  desiredCompanies: registrationArray,
  educationLevel: z.enum(educationLevels).nullable().optional(),
  institution: z.string().nullable().optional(),
  profileVisible: z.boolean().optional(),
  emailNotifications: z.boolean().optional(),
  readReceipts: z.boolean().optional(),
}).strict();

export type RegistrationInput = z.infer<typeof registrationInputSchema>;

export function parseRegistrationInput(body: unknown): RegistrationInput {
  return registrationInputSchema.parse(body);
}