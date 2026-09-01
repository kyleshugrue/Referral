/**
 * Helper functions for managing the registration flow
 */

import { logger } from './logger';
import { auth } from './firebase';
import { toast } from '@/hooks/use-toast';
import type { User } from '@shared/schema';

const REGISTRATION_STORAGE_VERSION = 2;
const REGISTRATION_STORAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REGISTRATION_DATA_KEY = 'registrationData';
const PENDING_REGISTRATION_DATA_KEY = 'pendingRegistrationData';
const REGISTRATION_METADATA_KEYS = {
  registrationData: 'registrationDataMeta',
  pendingRegistrationData: 'pendingRegistrationDataMeta',
} as const;

const REGISTRATION_DATA_FIELDS = [
  'email', 'fullName', 'birthday', 'firebaseUid', 'emailVerified',
  'title', 'currentLocation', 'industry', 'currentCompany',
  'yearsOfExperience', 'matchingRadius', 'bio', 'photo', 'resumeUrl',
  'resumePreviewUrls', 'desiredLocations', 'desiredCompanies', 'interests',
  'professionalInterests', 'languages', 'institution', 'educationLevel',
  'profileVisible', 'emailNotifications', 'readReceipts',
] as const;

export interface RegistrationData {
  email?: string;
  fullName?: string;
  birthday?: string | null;
  firebaseUid?: string;
  emailVerified?: boolean;
  title?: string | null;
  currentLocation?: string | null;
  industry?: string | null;
  currentCompany?: string | null;
  yearsOfExperience?: number | null;
  matchingRadius?: number | null;
  bio?: string | null;
  photo?: string | null;
  resumeUrl?: string | null;
  resumePreviewUrls?: string[];
  desiredLocations?: string[];
  desiredCompanies?: string[];
  interests?: string[];
  professionalInterests?: string[];
  languages?: string[];
  institution?: string | null;
  educationLevel?: string | null;
  profileVisible?: boolean;
  emailNotifications?: boolean;
  readReceipts?: boolean;
  [key: string]: unknown;
}

interface RegistrationResponse extends RegistrationData {
  id?: number;
  success?: boolean;
}

/**
 * Only persist fields needed to resume profile setup. Firebase passwords and
 * password confirmation are intentionally not in this allowlist.
 */
export function sanitizeRegistrationData(data: unknown): RegistrationData {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return {};
  }

  const source = data as Record<string, unknown>;
  return Object.fromEntries(
    REGISTRATION_DATA_FIELDS
      .filter(field => source[field] !== undefined)
      .map(field => [field, source[field]]),
  );
}

function metadataKey(storageKey: string): string {
  return storageKey === REGISTRATION_DATA_KEY
    ? REGISTRATION_METADATA_KEYS.registrationData
    : REGISTRATION_METADATA_KEYS.pendingRegistrationData;
}

function writeRegistrationStorage(storageKey: string, data: unknown): void {
  const safeData = sanitizeRegistrationData(data);
  localStorage.setItem(storageKey, JSON.stringify(safeData));
  localStorage.setItem(metadataKey(storageKey), JSON.stringify({
    version: REGISTRATION_STORAGE_VERSION,
    savedAt: Date.now(),
  }));
}

function removeRegistrationStorage(storageKey: string): void {
  localStorage.removeItem(storageKey);
  localStorage.removeItem(metadataKey(storageKey));
}

function readRegistrationStorage(storageKey: string): RegistrationData | null {
  try {
    const rawData = localStorage.getItem(storageKey);
    if (!rawData) return null;

    let parsedData: unknown;
    try {
      parsedData = JSON.parse(rawData);
    } catch {
      removeRegistrationStorage(storageKey);
      return null;
    }

    const safeData = sanitizeRegistrationData(parsedData);
    const rawMetadata = localStorage.getItem(metadataKey(storageKey));
    let metadata: { version?: number; savedAt?: number } | null = null;
    try {
      metadata = rawMetadata ? JSON.parse(rawMetadata) : null;
    } catch {
      metadata = null;
    }

    // Migrate legacy raw objects in place. This strips a legacy password
    // before rewriting the value and adds version/expiry metadata.
    if (!metadata || metadata.version !== REGISTRATION_STORAGE_VERSION) {
      if (Object.keys(safeData).length === 0) {
        removeRegistrationStorage(storageKey);
        return null;
      }
      writeRegistrationStorage(storageKey, safeData);
      return safeData;
    }

    if (!metadata.savedAt || Date.now() - metadata.savedAt > REGISTRATION_STORAGE_TTL_MS) {
      removeRegistrationStorage(storageKey);
      return null;
    }

    // Also repair current-format values written by an older caller.
    if (JSON.stringify(parsedData) !== JSON.stringify(safeData)) {
      writeRegistrationStorage(storageKey, safeData);
    }
    return safeData;
  } catch (error) {
    logger.error('Error reading registration data from local storage:', error);
    return null;
  }
}

export function savePendingRegistrationData(data: unknown): void {
  try {
    writeRegistrationStorage(PENDING_REGISTRATION_DATA_KEY, data);
  } catch (error) {
    logger.error('Error saving pending registration data:', error);
  }
}

export function getPendingRegistrationData(): RegistrationData | null {
  return readRegistrationStorage(PENDING_REGISTRATION_DATA_KEY);
}

export function updatePendingRegistrationData(updates: RegistrationData): void {
  savePendingRegistrationData({
    ...(getPendingRegistrationData() || {}),
    ...updates,
  });
}

/**
 * Save registration data to server
 * This allows for saving progress to the database after each step
 */
export async function savePartialRegistrationToServer(data: RegistrationData, showToast = true): Promise<RegistrationResponse | null> {
  try {
    // Only proceed if there's a Firebase UID
    if (!data.firebaseUid) {
      logger.debug("Registration helper: No Firebase UID available, skipping server save");
      return null;
    }
    
    // The server verifies identity from a Firebase ID token, so a signed-in
    // Firebase user is required to save registration data
    const firebaseUser = auth?.currentUser;
    if (!firebaseUser) {
      logger.debug("Registration helper: No signed-in Firebase user, skipping server save");
      return null;
    }
    const idToken = await firebaseUser.getIdToken();
    
    // Show a "Saving..." toast if requested
    if (showToast) {
      toast({
        title: "Saving your data...",
        description: "Your information is being saved to your profile.",
        duration: 2000
      });
    }
    
    logger.debug("Registration helper: Saving registration data to server");
    
    // Create a formatted data object to send to server
    const formattedData: RegistrationData = { ...data };

    // Process array fields to ensure they're always properly formatted arrays
    const arrayFields = [
      "interests", 
      "professionalInterests", 
      "languages", 
      "desiredLocations", 
      "desiredCompanies"
    ];
    
    // Process each array field with special handling
    arrayFields.forEach(field => {
      // Only process if the field exists in the data (even if null/undefined)
      if (field in data) {
        const value = data[field];
        
        // Handle null/undefined -> empty array
        if (value === null || value === undefined) {
          formattedData[field] = [];
          return;
        }
        
        // Handle string that could be JSON
        if (typeof value === 'string') {
          // If it looks like a JSON array, try to parse it
          if (value.trim().startsWith('[') && value.trim().endsWith(']')) {
            try {
              const parsed = JSON.parse(value);
              formattedData[field] = Array.isArray(parsed) ? parsed : [value];
            } catch {
              // If parsing fails, treat as regular string
              formattedData[field] = [value];
            }
          } else if (value.trim() === '') {
            // Empty string becomes empty array
            formattedData[field] = [];
          } else {
            // Non-empty string becomes single-item array
            formattedData[field] = [value];
          }
          return;
        }
        
        // If it's already an array, keep it
        if (Array.isArray(value)) {
          formattedData[field] = value;
          return;
        }
        
        // For any other type, wrap in array (should be rare)
        formattedData[field] = [value];
      }
    });
    
    // Debug arrays to make sure they're properly formatted
    logger.debug("Registration helper: Formatted arrays for server storage:", {
      interests: formattedData.interests, 
      professionalInterests: formattedData.professionalInterests,
      languages: formattedData.languages,
      desiredLocations: formattedData.desiredLocations,
      desiredCompanies: formattedData.desiredCompanies
    });
    
    // Use the partial registration endpoint
    const response = await fetch('/api/register/partial', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
      },
      body: JSON.stringify(formattedData),
      credentials: 'include', // Include cookies for session authentication
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      logger.error("Registration helper: Error from partial registration endpoint:", errorText);
      
      // Show error toast if requested
      if (showToast) {
        toast({
          variant: "destructive",
          title: "Save failed",
          description: "There was an error saving your data. You can still continue and we'll try again later.",
          duration: 3000
        });
      }
      
      throw new Error(errorText || 'Failed to save partial registration data to server');
    }
    
    try {
      const savedData = await response.json() as RegistrationResponse;
      logger.debug("Registration helper: Data saved to server successfully", savedData.id);
      
      // Show success toast if requested
      if (showToast) {
        toast({
          title: "Data saved successfully",
          description: "Your information has been saved to your profile.",
          duration: 2000
        });
      }
      
      // After saving, also sync with the user API to ensure profile data is up to date
      if (savedData.id) {
        try {
          // Force a user data refresh from server to update any cached data
          const userResponse = await fetch('/api/user', {
            credentials: 'include',
            cache: 'no-cache', // Bypass cache
            headers: {
              'Pragma': 'no-cache', // Legacy HTTP/1.0 directive
              'Cache-Control': 'no-cache, no-store, must-revalidate', // HTTP/1.1 directives
            }
          });
          
          if (userResponse.ok) {
            const userData = await userResponse.json();
            logger.debug("Registration helper: User data refreshed from server", userData?.id);
          }
        } catch (refreshError) {
          logger.error("Registration helper: Error refreshing user data after save:", refreshError);
          // Continue even if refresh fails, as the data was already saved
        }
      }
      
      return savedData;
    } catch (parseError) {
      logger.error("Registration helper: Error parsing server response:", parseError);
      // If we got a response but can't parse it, something odd is happening
      // Return a minimal object to indicate success but with no data
      return { success: true };
    }
  } catch (e) {
    logger.error("Registration helper: Error saving registration data to server:", e);
    
    // Show error toast if requested and not already shown
    try {
      if (showToast) {
        toast({
          variant: "destructive",
          title: "Save failed",
          description: "There was an error saving your data. You can still continue and we'll try again later.",
          duration: 3000
        });
      }
    } catch (toastError) {
      logger.error("Error showing toast:", toastError);
    }
    
    return null;
  }
}

/**
 * Check if the user should be forced through the registration flow
 * This is important in the production environment to ensure profile completion
 */
export function shouldForceRegistration(): boolean {
  try {
    // For new users with no localStorage flags, we should force registration
    const registrationComplete = localStorage.getItem('registrationComplete') === 'true';
    const forceRegistrationFlow = localStorage.getItem('forceRegistrationFlow') !== 'false';
    
    // If registration is explicitly marked as complete, don't force registration
    if (registrationComplete) {
      logger.debug("Registration helper: Registration is marked as complete");
      return false;
    }
    
    // CRASH RECOVERY: Check for corrupted localStorage state
    const hasCorruptedState = checkForCorruptedRegistrationState();
    if (hasCorruptedState) {
      logger.warn("Registration helper: Detected corrupted state, forcing registration for safety");
      return true;
    }
    
    // Otherwise check the forceRegistrationFlow flag (defaults to true)
    logger.debug("Registration helper: Registration force check:", {
      forceRegistrationFlow,
      registrationComplete
    });
    
    return forceRegistrationFlow;
  } catch (e) {
    logger.error("Error checking registration flags:", e);
    // By default, force registration to be safe
    return true;
  }
}

// CRASH RECOVERY: Helper function to detect corrupted registration state
function checkForCorruptedRegistrationState(): boolean {
  try {
    // Check for contradictory states that indicate corruption
    const registrationComplete = localStorage.getItem('registrationComplete') === 'true';
    const forceRegistrationFlow = localStorage.getItem('forceRegistrationFlow') !== 'false';
    const registrationData = localStorage.getItem('registrationData');
    const pendingData = localStorage.getItem('pendingRegistrationData');
    
    // Detect potential corruption scenarios
    const hasConflictingFlags = registrationComplete && forceRegistrationFlow;
    const hasInvalidDataStructure = registrationData && !isValidJSONString(registrationData);
    const hasPendingDataStructure = pendingData && !isValidJSONString(pendingData);
    
    if (hasConflictingFlags) {
      logger.warn("Registration helper: Detected conflicting localStorage flags");
      return true;
    }
    
    if (hasInvalidDataStructure || hasPendingDataStructure) {
      logger.warn("Registration helper: Detected invalid data structures in localStorage");
      return true;
    }
    
    return false;
  } catch (e) {
    logger.error("Error checking for corrupted state:", e);
    return true; // Assume corruption if we can't check
  }
}

// Helper function to validate JSON strings
function isValidJSONString(str: string): boolean {
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
}

/**
 * Save registration data to local storage
 * This allows for persistence between registration steps
 */
export function saveRegistrationData(data: RegistrationData): void {
  try {
    writeRegistrationStorage(REGISTRATION_DATA_KEY, data);
    logger.debug("Registration helper: Saved registration fields", Object.keys(sanitizeRegistrationData(data)));
  } catch (e) {
    logger.error("Error saving registration data:", e);
  }
}

/**
 * Get saved registration data from local storage
 */
export function getRegistrationData(): RegistrationData | null {
  return readRegistrationStorage(REGISTRATION_DATA_KEY);
}

/**
 * Clear saved registration data from local storage
 */
export function clearRegistrationData(): void {
  try {
    logger.debug("Registration helper: Clearing registration data");
    removeRegistrationStorage(REGISTRATION_DATA_KEY);
    removeRegistrationStorage(PENDING_REGISTRATION_DATA_KEY);
  } catch (e) {
    logger.error("Error clearing registration data:", e);
  }
}

/**
 * Mark registration as complete
 * This prevents users from being redirected back to the registration flow
 */
export function markRegistrationComplete(): void {
  try {
    logger.debug("Registration helper: Marking registration as complete");
    localStorage.setItem('registrationComplete', 'true');
    localStorage.setItem('forceRegistrationFlow', 'false');
    
    // Save the current URL to redirect back to after registration
    // This is important for keeping track of the user's intended destination
    localStorage.setItem('registrationRedirectUrl', window.location.pathname);
  } catch (e) {
    logger.error("Error setting registration complete flags:", e);
  }
}

/**
 * Get the URL to redirect to after registration
 * This is useful for redirecting users back to their intended destination
 */
export function getRedirectUrlAfterRegistration(): string {
  try {
    const redirectUrl = localStorage.getItem('registrationRedirectUrl');
    
    // Clear the redirect URL to prevent future redirects
    localStorage.removeItem('registrationRedirectUrl');
    
    // Default to network page if no redirect URL is set
    return redirectUrl || '/';
  } catch (e) {
    logger.error("Error getting redirect URL:", e);
    return '/';
  }
}

/**
 * Reset registration status
 * This is useful for debugging or if we need to force a user through registration again
 */
export function resetRegistrationStatus(): void {
  try {
    logger.debug("Registration helper: Resetting registration status");
    localStorage.removeItem('registrationComplete');
    localStorage.removeItem('forceRegistrationFlow');
  } catch (e) {
    logger.error("Error resetting registration status:", e);
  }
}

/**
 * Clean up temporary image URLs created during registration
 * This prevents memory leaks by revoking object URLs
 * @param urls Array of URLs to be revoked
 */
export function cleanupTempImageUrls(urls: string[]): void {
  try {
    logger.debug("Registration helper: Cleaning up temporary image URLs");
    urls.forEach(url => {
      // Only revoke URLs that are object URLs (blob:)
      if (url && url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
      }
    });
  } catch (e) {
    logger.error("Error cleaning up temporary image URLs:", e);
  }
}

/**
 * Save current registration step to localStorage
 * This allows us to track where verified users left off in registration
 */
export function saveRegistrationStep(step: number): void {
  try {
    logger.debug("Registration helper: Saving current step:", step);
    localStorage.setItem('registrationCurrentStep', step.toString());
  } catch (e) {
    logger.error("Error saving registration step:", e);
  }
}

/**
 * Get saved registration step from localStorage
 * Returns the step number or null if not found
 */
export function getRegistrationStep(): number | null {
  try {
    const step = localStorage.getItem('registrationCurrentStep');
    if (step) {
      const parsedStep = parseInt(step, 10);
      return isNaN(parsedStep) ? null : parsedStep;
    }
    return null;
  } catch (e) {
    logger.error("Error getting registration step:", e);
    return null;
  }
}

/**
 * Clear saved registration step from localStorage
 */
export function clearRegistrationStep(): void {
  try {
    logger.debug("Registration helper: Clearing registration step");
    localStorage.removeItem('registrationCurrentStep');
  } catch (e) {
    logger.error("Error clearing registration step:", e);
  }
}

/**
 * Determine the appropriate starting step for a verified user based on their profile data
 * Step 0: AI Matching Preferences 1 (desiredCompanies, industry)
 * Step 1: AI Matching Preferences 2 (desiredLocations, matchingRadius)
 * Step 2: Professional Information (title, currentCompany, currentLocation, yearsOfExperience)
 * Step 3: Personal Information (bio, professionalInterests, languages, interests)
 * Step 4: Profile Photo & Resume (photo, resumeUrl)
 */
export function determineStartingStepForVerifiedUser(userData: Partial<User> | null | undefined): number {
  try {
    logger.debug("Registration helper: Determining starting step for verified user with data:", userData);
    
    // CRITICAL: Never auto-complete based on localStorage flags
    // ProtectedRoute handles the registrationComplete check - this function only determines step progression
    logger.debug("Registration helper: Determining step based on data completeness only");
    
    // Start from step 0 (AI Matching Preferences 1) for verified users
    // Check Step 0: AI Matching Preferences 1 (desiredCompanies, industry)
    const desiredCompanies = userData?.desiredCompanies;
    const hasStep0Data = Array.isArray(desiredCompanies) && desiredCompanies.length > 0 && userData?.industry &&
                         // Reject system default values
                         userData.industry !== "Technology";
    if (!hasStep0Data) {
      logger.debug("Registration helper: Starting from Step 0 - AI Matching Preferences 1");
      return 0;
    }
    
    // Check Step 1: AI Matching Preferences 2 (desiredLocations, matchingRadius)
    const desiredLocations = userData?.desiredLocations;
    const hasStep1Data = Array.isArray(desiredLocations) && desiredLocations.length > 0;
    if (!hasStep1Data) {
      logger.debug("Registration helper: Starting from Step 1 - AI Matching Preferences 2");
      return 1;
    }
    
    // Check Step 2: Professional Information
    // CRITICAL: Validate that data is real user input, not system defaults
    const hasStep2Data = userData?.title && userData?.currentCompany && userData?.currentLocation && 
                         userData?.yearsOfExperience !== undefined &&
                         // Reject system default values - these indicate incomplete registration
                         userData.title !== "Professional" &&
                         userData.currentCompany !== "Not Specified" &&
                         userData.currentLocation !== "Remote";
    if (!hasStep2Data) {
      logger.debug("Registration helper: Starting from Step 2 - Professional Information");
      return 2;
    }
    
    // Check Step 3: Personal Information
    const hasStep3Data = userData?.bio; // Bio is the main required field, others are optional
    if (!hasStep3Data) {
      logger.debug("Registration helper: Starting from Step 3 - Personal Information");
      return 3;
    }
    
    // CRITICAL: Always direct users to Step 4 (Profile Photo & Resume) 
    // Registration is NEVER auto-complete - users MUST press "Complete Registration" button
    logger.debug("Registration helper: Bio exists, but directing to Step 4 - user must explicitly complete registration");
    return 4;
    
  } catch (e) {
    logger.error("Error determining starting step:", e);
    // Default to step 0 (AI Matching Preferences 1) for verified users
    return 0;
  }
}