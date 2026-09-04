import { Router, type Request, type Response } from 'express';
import { storage, FirebaseIdentityConflictError } from '../storage';
import { User, educationLevels } from '@shared/schema';
import { simpleMatchJobHelper } from '../services/simple-match-job-helper';
import { requireVerifiedFirebaseUser, getRegistrant } from '../lib/register-auth';
import { firebaseStorageService } from '../services/firebase-storage';
import { toSelfUserDto } from '../lib/privacy-dto';
import { parseRegistrationInput, type RegistrationInput } from '../lib/registration-input';
import { ZodError } from 'zod';

const router = Router();

type RegistrationArray = RegistrationInput[keyof Pick<
  RegistrationInput,
  'interests' | 'professionalInterests' | 'languages' | 'desiredLocations' | 'desiredCompanies'
>];
type RegistrationSuccessResponder = (user: User, status: 200 | 201) => Promise<unknown> | unknown;
type RegistrationResponse = Response & { registrationSuccessResponder?: RegistrationSuccessResponder };

function normalizeStringArray(value: RegistrationArray): string[] {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function hasRegistrationValues(value: RegistrationArray): boolean {
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

function normalizeEducationLevel(value: string | null | undefined): typeof educationLevels[number] | undefined {
  if (typeof value !== 'string') return undefined;
  return (educationLevels as readonly string[]).includes(value)
    ? value as typeof educationLevels[number]
    : undefined;
}

function normalizeRegistrationMediaReferences(body: RegistrationInput): RegistrationInput {
  const previewInput = body.resumePreviewUrls;
  if (Array.isArray(previewInput) && previewInput.some((url) => typeof url !== 'string')) {
    throw new Error('Invalid media reference');
  }
  for (const value of [body.photo, body.resumeUrl]) {
    if (value !== undefined && value !== null && typeof value !== 'string') {
      throw new Error('Invalid media reference');
    }
  }
  const previewUrls = Array.isArray(body.resumePreviewUrls)
    ? body.resumePreviewUrls.map((url) => firebaseStorageService.normalizeMediaReference(url) || url)
    : body.resumePreviewUrls;
  return {
    ...body,
    photo: firebaseStorageService.normalizeMediaReference(body.photo) || body.photo,
    resumeUrl: firebaseStorageService.normalizeMediaReference(body.resumeUrl) || body.resumeUrl,
    resumePreviewUrls: previewUrls,
  };
}

async function registrationMediaBelongsTo(
  reference: unknown,
  firebaseUid: string,
  allowPlaceholder = false,
): Promise<boolean> {
  if (reference === undefined || reference === null || reference === '') return true;
  if (allowPlaceholder && reference === '/placeholder.jpg') return true;
  if (typeof reference !== 'string' || !reference.startsWith('/api/media/')) return false;

  if (await firebaseStorageService.isMediaReferenceOwnedByFirebaseUid(reference, firebaseUid)) {
    return true;
  }

  const existingOwner = await storage.getUserByMediaReference(reference);
  return existingOwner?.firebaseUid === firebaseUid;
}

async function validateRegistrationMediaReferences(
  body: RegistrationInput,
  firebaseUid: string,
): Promise<boolean> {
  if (!await registrationMediaBelongsTo(body.photo, firebaseUid, true)) return false;
  if (!await registrationMediaBelongsTo(body.resumeUrl, firebaseUid)) return false;
  if (Array.isArray(body.resumePreviewUrls)) {
    for (const reference of body.resumePreviewUrls) {
      if (!await registrationMediaBelongsTo(reference, firebaseUid)) return false;
    }
  } else if (body.resumePreviewUrls !== undefined && body.resumePreviewUrls !== null) {
    return false;
  }
  return true;
}

// Register a new user account using Firebase Auth and store user data.
// Requires a valid Firebase ID token; identity (uid/email/emailVerified)
// is taken from the verified token, never from the request body.
async function respondWithRegisteredUser(
  res: RegistrationResponse,
  user: User,
  status: 200 | 201,
) {
  if (res.registrationSuccessResponder) {
    return res.registrationSuccessResponder(user, status);
  }
  return status === 201 ? res.status(201).json(toSelfUserDto(user)) : res.json(toSelfUserDto(user));
}

export async function registerFirebaseUser(req: Request, res: RegistrationResponse) {
  try {
    const registrant = getRegistrant(req);
    const firebaseUid = registrant.uid;
    const userData = normalizeRegistrationMediaReferences(
      parseRegistrationInput(req.body),
    );
    if (!await validateRegistrationMediaReferences(userData, firebaseUid)) {
      return res.status(400).json({ message: 'Invalid media reference' });
    }

    const email = registrant.email;
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    // Resolve an existing identity and any email link in one transaction.
    // Database failures must not fall through to account creation.
    const existingUser = await storage.resolveUserForFirebaseIdentity(
      firebaseUid,
      email,
      registrant.emailVerified,
    );
    if (existingUser) {
      return respondWithRegisteredUser(res, existingUser, 200);
    }

    // Create new user in database with properly formatted data
    const processedUserData = {
      firebaseUid,
      email,
      // Verification status comes from the verified token only
      emailVerified: registrant.emailVerified,
      fullName: userData.fullName || "",
       birthday: userData.birthday ?? undefined,
       resumeUrl: userData.resumeUrl ?? undefined,
       resumePreviewUrls: userData.resumePreviewUrls ?? undefined,
      title: userData.title || "",
      currentLocation: userData.currentLocation || "",
      industry: userData.industry || "",
      currentCompany: userData.currentCompany || "",
      yearsOfExperience: userData.yearsOfExperience ?? 0,
      matchingRadius: userData.matchingRadius ?? 0,
      // Format array fields properly
       interests: normalizeStringArray(userData.interests),
       professionalInterests: normalizeStringArray(userData.professionalInterests),
       languages: normalizeStringArray(userData.languages),
       desiredLocations: normalizeStringArray(userData.desiredLocations),
       desiredCompanies: normalizeStringArray(userData.desiredCompanies),
      // Education fields
       educationLevel: normalizeEducationLevel(userData.educationLevel),
      institution: userData.institution || "",
      // Other fields
      bio: userData.bio || "",
      photo: userData.photo || "/placeholder.jpg",
      profileVisible: userData.profileVisible !== undefined ? userData.profileVisible : true,
      emailNotifications: userData.emailNotifications !== undefined ? userData.emailNotifications : true,
      readReceipts: userData.readReceipts !== undefined ? userData.readReceipts : true,
    };

    try {
      const newUser = await storage.createUser(processedUserData);
      return respondWithRegisteredUser(res, newUser, 201);
    } catch (error) {
      // A concurrent registration may win the unique UID/email constraint.
      // Only that expected conflict may re-resolve the identity; all other
      // database failures remain errors and do not trigger account fallback.
      if (isUniqueConstraintViolation(error)) {
        const concurrentUser = await storage.resolveUserForFirebaseIdentity(
          firebaseUid,
          email,
          registrant.emailVerified,
        );
        if (concurrentUser) {
          return respondWithRegisteredUser(res, concurrentUser, 200);
        }
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(400).json({ message: 'Invalid registration data' });
    }
    if (error instanceof FirebaseIdentityConflictError) {
      return res.status(409).json({ message: error.message });
    }
    console.error('Registration error:', error instanceof Error ? error.name : 'unknown');
    return res.status(500).json({
      message: 'Registration failed'
    });
  }
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505',
  );
}

router.post('/', requireVerifiedFirebaseUser, registerFirebaseUser);

// Partial registration endpoint to save data during the multi-step process.
// Same auth model: identity comes from the verified Firebase ID token.
export async function partialRegisterFirebaseUser(req: Request, res: Response) {
  try {
    const registrant = getRegistrant(req);
    const firebaseUid = registrant.uid;
    const userData = normalizeRegistrationMediaReferences(
      parseRegistrationInput(req.body),
    );
    if (!await validateRegistrationMediaReferences(userData, firebaseUid)) {
      return res.status(400).json({ message: 'Invalid media reference' });
    }

    // Resolve identity and email linking transactionally. A database failure
    // must not fall through to creating a second account.
    let existingUser: User | undefined;
    try {
      existingUser = await storage.resolveUserForFirebaseIdentity(
        firebaseUid,
        registrant.email,
        registrant.emailVerified,
      );
    } catch (error) {
      if (error instanceof FirebaseIdentityConflictError) {
        return res.status(409).json({ message: error.message });
      }
      throw error;
    }

    if (existingUser) {
      if (existingUser.accountStatus !== 'active') {
        return res.status(403).json({ message: 'Account is not active' });
      }

      // Process user data to ensure fields are properly formatted
      const processedData = {
        // Always use the most recent user input without defaults, but preserve existing data when empty strings are sent
         title: (userData.title !== undefined && userData.title !== null && userData.title !== '') ? userData.title : existingUser.title ?? undefined,
         currentLocation: (userData.currentLocation !== undefined && userData.currentLocation !== null && userData.currentLocation !== '') ? userData.currentLocation : existingUser.currentLocation ?? undefined,
         industry: (userData.industry !== undefined && userData.industry !== null && userData.industry !== '') ? userData.industry : existingUser.industry ?? undefined,
         currentCompany: (userData.currentCompany !== undefined && userData.currentCompany !== null && userData.currentCompany !== '') ? userData.currentCompany : existingUser.currentCompany ?? undefined,
        yearsOfExperience: userData.yearsOfExperience ?? (existingUser.yearsOfExperience || 0),
        // Education fields
         educationLevel: (userData.educationLevel !== undefined && userData.educationLevel !== null)
           ? normalizeEducationLevel(userData.educationLevel)
           : normalizeEducationLevel(existingUser.educationLevel),
         institution: (userData.institution !== undefined && userData.institution !== null && userData.institution !== '') ? userData.institution : existingUser.institution ?? undefined,
        // Don't update email/password during partial updates, but DO update fullName/birthday if they have values
        email: undefined,
        password: undefined,
        // Verification status: only upgrade based on the verified token; never downgrade
        emailVerified: registrant.emailVerified ? true : existingUser.emailVerified,
        // CRITICAL FIX: Use new registration data for fullName/birthday, fallback to existing only if both are empty
        fullName: (userData.fullName !== undefined && userData.fullName !== '') ? userData.fullName :
                 (existingUser.fullName && existingUser.fullName !== '') ? existingUser.fullName : userData.fullName || '',
         birthday: (userData.birthday !== undefined && userData.birthday !== null && userData.birthday !== '') ? userData.birthday :
                  (existingUser.birthday && existingUser.birthday !== '') ? existingUser.birthday : userData.birthday ?? undefined,
        // Ensure arrays are properly formatted - preserve existing data when empty arrays are sent
         interests: hasRegistrationValues(userData.interests) ?
           normalizeStringArray(userData.interests) :
          existingUser.interests,
         professionalInterests: hasRegistrationValues(userData.professionalInterests) ?
           normalizeStringArray(userData.professionalInterests) :
          existingUser.professionalInterests,
         languages: hasRegistrationValues(userData.languages) ?
           normalizeStringArray(userData.languages) :
          existingUser.languages,
         desiredLocations: hasRegistrationValues(userData.desiredLocations) ?
           normalizeStringArray(userData.desiredLocations) :
          existingUser.desiredLocations ?? [],
         desiredCompanies: hasRegistrationValues(userData.desiredCompanies) ?
           normalizeStringArray(userData.desiredCompanies) :
          existingUser.desiredCompanies ?? [],
        // Other fields
         bio: userData.bio !== undefined && userData.bio !== null ? userData.bio : existingUser.bio ?? undefined,
         photo: userData.photo || existingUser.photo,
         resumeUrl: userData.resumeUrl ?? existingUser.resumeUrl ?? undefined,
        resumePreviewUrls: userData.resumePreviewUrls ?? existingUser.resumePreviewUrls ?? undefined,
        profileVisible: userData.profileVisible !== undefined ? userData.profileVisible : existingUser.profileVisible,
        emailNotifications: userData.emailNotifications !== undefined ? userData.emailNotifications : existingUser.emailNotifications,
        readReceipts: userData.readReceipts !== undefined ? userData.readReceipts : existingUser.readReceipts,
      };

      // Update existing user with processed data
      await storage.linkUserToFirebaseUid(
        existingUser.id,
        firebaseUid,
        registrant.emailVerified,
      );
      const completedUser = await storage.updateUser(existingUser.id, processedData);

      // Check if user now has minimum match data and queue initial AI match jobs
      // This happens automatically when Step 3 is completed (fullName, currentCompany, currentLocation, industry, desiredCompanies, desiredLocations)
      if (completedUser.hasMinimumMatchData && !completedUser.initialMatchJobsQueued && completedUser.emailVerified) {
        try {
          const timestamp = new Date().toISOString();

          // Queue prioritized AI match jobs (same logic as PATCH /api/user)
          await simpleMatchJobHelper.queuePrioritizedMatchJobs(completedUser.id);

          // Mark that initial match jobs have been queued
          await storage.updateUser(completedUser.id, {
            initialMatchJobsQueued: true,
            initialMatchJobsQueuedAt: timestamp
          });

          // Update the user object to reflect the change
          completedUser.initialMatchJobsQueued = true;
          completedUser.initialMatchJobsQueuedAt = timestamp;
        } catch {
          // Don't fail the entire request - match jobs will queue on next update
        }
      }

      return res.json(toSelfUserDto(completedUser));
    } else {
      // Create a temporary user with the partial data

      // Set required fields with properly formatted values for registration
      const userDataWithDefaults = {
        firebaseUid,
        // Prefer the token's email; use a deterministic placeholder only for
        // the partial-registration path where Firebase has no email claim.
        email: registrant.email || `temp_${firebaseUid}@example.com`,
        // Required fields - use provided values only, don't use defaults unless absolutely necessary
        fullName: userData.fullName || "",
         birthday: userData.birthday ?? undefined,
         resumeUrl: userData.resumeUrl ?? undefined,
         resumePreviewUrls: userData.resumePreviewUrls ?? undefined,
        // Always use the provided values for these fields, don't substitute with defaults
        title: userData.title || "",
        currentLocation: userData.currentLocation || "",
        industry: userData.industry || "",
        currentCompany: userData.currentCompany || "",
        yearsOfExperience: userData.yearsOfExperience ?? 0,
        matchingRadius: userData.matchingRadius ?? 0,
        // Education fields
         educationLevel: normalizeEducationLevel(userData.educationLevel),
        institution: userData.institution || "",
        // Process array fields properly
         interests: normalizeStringArray(userData.interests),
         professionalInterests: normalizeStringArray(userData.professionalInterests),
         languages: normalizeStringArray(userData.languages),
         desiredLocations: normalizeStringArray(userData.desiredLocations),
         desiredCompanies: normalizeStringArray(userData.desiredCompanies),
        // Include any other optional fields provided
        bio: userData.bio || "",
        photo: userData.photo || "/placeholder.jpg",
        profileVisible: userData.profileVisible !== undefined ? userData.profileVisible : true,
        emailNotifications: userData.emailNotifications !== undefined ? userData.emailNotifications : true,
        readReceipts: userData.readReceipts !== undefined ? userData.readReceipts : true,
        // Verification status comes from the verified token only
        emailVerified: registrant.emailVerified
      };

      let newUser: User;
      try {
        newUser = await storage.createUser(userDataWithDefaults);
      } catch (error) {
        if (isUniqueConstraintViolation(error)) {
          const concurrentUser = await storage.resolveUserForFirebaseIdentity(
            firebaseUid,
            registrant.email,
            registrant.emailVerified,
          );
          if (concurrentUser) {
            newUser = concurrentUser;
          } else {
            throw error;
          }
        } else {
          throw error;
        }
      }

      // Check if user now has minimum match data and queue initial AI match jobs
      if (newUser.hasMinimumMatchData && !newUser.initialMatchJobsQueued && newUser.emailVerified) {
        try {
          const timestamp = new Date().toISOString();

          // Queue prioritized AI match jobs (same logic as PATCH /api/user)
          await simpleMatchJobHelper.queuePrioritizedMatchJobs(newUser.id);

          // Mark that initial match jobs have been queued
          await storage.updateUser(newUser.id, {
            initialMatchJobsQueued: true,
            initialMatchJobsQueuedAt: timestamp
          });

          // Update the user object to reflect the change
          newUser.initialMatchJobsQueued = true;
          newUser.initialMatchJobsQueuedAt = timestamp;
        } catch {
          // Don't fail the entire request - match jobs will queue on next update
        }
      }

      return res.status(201).json(toSelfUserDto(newUser));
    }
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(400).json({ message: 'Invalid registration data' });
    }
    if (error instanceof FirebaseIdentityConflictError) {
      return res.status(409).json({ message: error.message });
    }
    console.error('[Partial Registration] Error:', error);
    return res.status(500).json({ message: 'Partial registration failed' });
  }
}

router.post('/partial', requireVerifiedFirebaseUser, partialRegisterFirebaseUser);

export default router;
