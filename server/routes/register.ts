import { Router, type Request, type Response } from 'express';
import { storage } from '../storage';
import { User, educationLevels } from '@shared/schema';
import { simpleMatchJobHelper } from '../services/simple-match-job-helper';
import { requireVerifiedFirebaseUser, getRegistrant } from '../lib/register-auth';
import { firebaseStorageService } from '../services/firebase-storage';
import { toSelfUserDto } from '../lib/privacy-dto';

const router = Router();

type RegistrationArray = string[] | string | null | undefined;
type RegistrationBody = Omit<Partial<User>, 'interests' | 'professionalInterests' | 'languages' | 'desiredLocations' | 'desiredCompanies'> & {
  interests?: RegistrationArray;
  professionalInterests?: RegistrationArray;
  languages?: RegistrationArray;
  desiredLocations?: RegistrationArray;
  desiredCompanies?: RegistrationArray;
} & Record<string, unknown>;
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

function normalizeRegistrationMediaReferences(body: RegistrationBody): RegistrationBody {
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
  body: RegistrationBody,
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

/**
 * Strip identity/authorization fields the client must never control.
 * Identity comes exclusively from the verified Firebase ID token.
 */
export function stripUntrustedFields(body: RegistrationBody): RegistrationBody {
  const {
    id: _id,
    firebaseUid: _firebaseUid,
    email: _email,
    emailVerified: _emailVerified,
    registrationCompleted: _registrationCompleted,
    initialMatchJobsQueued: _initialMatchJobsQueued,
    initialMatchJobsQueuedAt: _initialMatchJobsQueuedAt,
    ...rest
  } = body || {};
  void _id;
  void _firebaseUid;
  void _email;
  void _emailVerified;
  void _registrationCompleted;
  void _initialMatchJobsQueued;
  void _initialMatchJobsQueuedAt;
  return rest as RegistrationBody;
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
      stripUntrustedFields(req.body as RegistrationBody),
    );
    if (!await validateRegistrationMediaReferences(userData, firebaseUid)) {
      return res.status(400).json({ message: 'Invalid media reference' });
    }

    const email = registrant.email;
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    // Idempotency: if this Firebase account already has a user, return it
    try {
      const usersByUid = await storage.getUsersByFirebaseUid(firebaseUid);
      if (usersByUid && usersByUid.length > 0) {
        return respondWithRegisteredUser(res, usersByUid[0], 200);
      }
    } catch {
      // Continue — user lookup failure falls through to creation path
    }

    // Account linking: only via the email inside the verified token, and
    // only when that email is verified (prevents claiming someone else's
    // account with an unverified Firebase signup using their address).
    if (registrant.email) {
      const existingUser = await storage.getUserByEmail(registrant.email);
      if (existingUser) {
        if (existingUser.firebaseUid && existingUser.firebaseUid !== firebaseUid) {
          return res.status(409).json({ message: 'An account with this email already exists' });
        }
        if (!existingUser.firebaseUid && !registrant.emailVerified) {
          return res.status(409).json({ message: 'An account with this email already exists. Verify your email to continue.' });
        }
        const linkedUser = await storage.linkUserToFirebaseUid(
          existingUser.id,
          firebaseUid,
          registrant.emailVerified,
        );
        return respondWithRegisteredUser(res, linkedUser, 200);
      }
    }

    // Create new user in database with properly formatted data
    const processedUserData = {
      ...userData,
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
      yearsOfExperience: userData.yearsOfExperience !== undefined ? userData.yearsOfExperience : 0,
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
      // Remove password from database storage (Firebase handles auth)
      password: undefined,
    };

    const newUser = await storage.createUser(processedUserData);
    return respondWithRegisteredUser(res, newUser, 201);
  } catch (error) {
    console.error('Registration error:', error instanceof Error ? error.name : 'unknown');
    return res.status(500).json({
      message: 'Registration failed'
    });
  }
}

router.post('/', requireVerifiedFirebaseUser, registerFirebaseUser);

// Partial registration endpoint to save data during the multi-step process.
// Same auth model: identity comes from the verified Firebase ID token.
router.post('/partial', requireVerifiedFirebaseUser, async (req, res) => {
  try {
    const registrant = getRegistrant(req);
    const firebaseUid = registrant.uid;
    const userData = normalizeRegistrationMediaReferences(
      stripUntrustedFields(req.body as RegistrationBody),
    );
    if (!await validateRegistrationMediaReferences(userData, firebaseUid)) {
      return res.status(400).json({ message: 'Invalid media reference' });
    }

    // Check if a user with this Firebase UID already exists in our database
    let existingUser: User | undefined;
    try {
      const users = await storage.getUsersByFirebaseUid(firebaseUid);
      existingUser = users?.[0];

      // Fallback lookup only by the token's email — never client input
      if (!existingUser && registrant.email) {
        const byEmail = await storage.getUserByEmail(registrant.email);
        if (byEmail) {
          if (byEmail.firebaseUid && byEmail.firebaseUid !== firebaseUid) {
            return res.status(409).json({ message: 'An account with this email already exists' });
          }
          existingUser = byEmail;
        }
      }
    } catch {
      // If user not found, continue with creation
    }

    if (existingUser) {
      // Process user data to ensure fields are properly formatted
      const processedData = {
        ...userData,
        // Ensure the row is linked to the authenticated Firebase account
        firebaseUid,
        // Always use the most recent user input without defaults, but preserve existing data when empty strings are sent
         title: (userData.title !== undefined && userData.title !== null && userData.title !== '') ? userData.title : existingUser.title ?? undefined,
         currentLocation: (userData.currentLocation !== undefined && userData.currentLocation !== null && userData.currentLocation !== '') ? userData.currentLocation : existingUser.currentLocation ?? undefined,
         industry: (userData.industry !== undefined && userData.industry !== null && userData.industry !== '') ? userData.industry : existingUser.industry ?? undefined,
         currentCompany: (userData.currentCompany !== undefined && userData.currentCompany !== null && userData.currentCompany !== '') ? userData.currentCompany : existingUser.currentCompany ?? undefined,
        yearsOfExperience: userData.yearsOfExperience !== undefined ? userData.yearsOfExperience : (existingUser.yearsOfExperience || 0),
        // Education fields
         educationLevel: (userData.educationLevel !== undefined && userData.educationLevel !== null && userData.educationLevel !== '')
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
         resumePreviewUrls: userData.resumePreviewUrls ?? existingUser.resumePreviewUrls ?? undefined
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
        ...userData,
        firebaseUid,
        // Prefer the token's email; fall back to client input, then a temp placeholder
        email: registrant.email || userData.email || `temp_${firebaseUid}@example.com`,
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
        yearsOfExperience: userData.yearsOfExperience !== undefined ? userData.yearsOfExperience : 0,
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
        // Verification status comes from the verified token only
        emailVerified: registrant.emailVerified
      };

      const newUser = await storage.createUser(userDataWithDefaults);

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
    console.error('[Partial Registration] Error:', error);
    return res.status(500).json({ message: 'Partial registration failed' });
  }
});

export default router;
