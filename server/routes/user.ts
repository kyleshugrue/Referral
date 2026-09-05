import { Router } from 'express';
import { ProfileVersionConflictError, storage } from '../storage';
import { locationCacheService } from '../services/location-cache';
import { db } from '../db';
import { users, editableProfileSchema } from '@shared/schema';
import type { User } from '@shared/schema';
import { eq, and } from 'drizzle-orm';
import { simpleMatchJobHelper } from '../services/simple-match-job-helper';
import { centralizedMatchDescriptionCommandCenter } from '../services/centralized-match-description-command-center';
import { snapshotService } from '../services/profile-snapshot-service';
import type { ProfileData } from '../services/profile-snapshot-service';
import { requireAuthJWT } from '../auth';
import { requireCompleteRegistration } from '../middleware/require-complete-registration';
import { requireAdmin } from '../middleware/require-admin';
import { logger } from '../lib/logger';
import { hasRequiredFieldsForMatching, shouldQueueInitialMatchJobs } from '../lib/profile-matching';
import { toSelfUserDto } from '../lib/privacy-dto';
import { profileMutationLimiter } from '../lib/rate-limits';
import { normalizeStringArray } from '../lib/registration-input';

const router = Router();

function parseExpectedProfileVersion(req: { headers: Record<string, unknown>; body?: unknown }): number | undefined {
  const header = req.headers['if-match'];
  const bodyVersion = req.body && typeof req.body === 'object'
    ? (req.body as Record<string, unknown>).profileVersion
    : undefined;
  const rawValue = header ?? bodyVersion;
  if (Array.isArray(rawValue)) return undefined;
  const raw = typeof rawValue === 'string'
    ? rawValue.replace(/^W\/"?|"?$/g, '')
    : rawValue;
  const version = typeof raw === 'number' ? raw : Number(raw);
  return Number.isInteger(version) && version > 0 ? version : undefined;
}

async function createCurrentProfileSnapshot(user: User): Promise<{ id: number; contentHash: string }> {
  const profileData: ProfileData = {
    bio: user.bio,
    title: user.title,
    currentLocation: user.currentLocation,
    currentLocationLat: user.currentLocationLat,
    currentLocationLng: user.currentLocationLng,
    industry: user.industry,
    currentCompany: user.currentCompany,
    desiredLocations: user.desiredLocations,
    desiredCompanies: user.desiredCompanies,
    interests: user.interests,
    professionalInterests: user.professionalInterests,
    languages: user.languages,
    matchingRadius: user.matchingRadius,
    yearsOfExperience: user.yearsOfExperience,
    educationLevel: user.educationLevel,
    institution: user.institution,
  };
  const snapshot = await snapshotService.createSnapshot(user.id, profileData);
  await db.update(users)
    .set({ currentSnapshotId: snapshot.id })
    .where(eq(users.id, user.id));
  return snapshot;
}

// Keep legacy diagnostics on the bounded logger boundary. These call sites
// historically passed profile fields and Error objects to console directly;
// the route now emits only fixed operational markers from those calls.
const console = {
  log: (...args: unknown[]) => { void args; logger.debug('[UserRoute] operation'); },
  info: (...args: unknown[]) => { void args; logger.debug('[UserRoute] operation'); },
  warn: (...args: unknown[]) => { void args; logger.debug('[UserRoute] warning'); },
  error: (...args: unknown[]) => { void args; logger.error('[UserRoute] operation failed'); },
};

// `hasRequiredFieldsForMatching` and `shouldQueueInitialMatchJobs` live in
// ../lib/profile-matching so they can be unit tested without importing this
// DB-connected route module (see server/lib/__tests__/profile-matching.test.ts).

// Get current user
router.get('/', requireAuthJWT, async (req, res) => {
  logger.debug("👤 [USER-ROUTE DEBUG] Handling /api/user GET request", {
    hasSession: !!req.session,
    isAuthenticated: req.isAuthenticated(),
    hasUser: Boolean(req.user),
  });

  // SESSION PERSISTENCE VERIFICATION: Keep only bounded state metadata.
  logger.debug("🔐 [SESSION-PERSISTENCE] Session state", {
    hasCookieHeader: !!req.headers.cookie,
    isAuthenticated: req.isAuthenticated(),
    hasUser: !!req.user,
    hasSessionCookie: Boolean(req.session?.cookie),
  });

  try {
    if (!req.user) {
      return res.status(401).json({ message: 'User not found' });
    }
    
    // Fetch fresh user data from database to ensure we have the latest
    const userId = req.user.id;
    logger.debug('✅ [USER-ROUTE DEBUG] Authentication successful; fetching user data');
    
    const user = await storage.getUser(userId);
    
    if (!user) {
      logger.error('❌ [USER-ROUTE DEBUG] Authenticated user not found in database');
      return res.status(404).json({ message: "User not found" });
    }
    
    logger.debug('[UserRoute] Retrieved authenticated user', {
      hasRegistrationCompleted: Boolean(user.registrationCompleted),
      hasEmailVerified: Boolean(user.emailVerified),
    });
    
    // Return the fresh user data
    console.log('✅ [USER-ROUTE DEBUG] Successfully returning user data', {
      hasRegistrationCompleted: user.registrationCompleted,
      hasEmailVerified: user.emailVerified,
    });
    return res.json(toSelfUserDto(user));
  } catch (error) {
    logger.error('💥 [USER-ROUTE DEBUG] Critical error fetching user data:', {
      errorClass: error instanceof Error ? error.name : 'UnknownError',
      userId: req.user?.id
    });
    return res.status(500).json({ message: "Failed to fetch user data" });
  }
});

// Update current user
router.patch('/', requireAuthJWT, profileMutationLimiter, async (req, res) => {
  // PRODUCTION-GRADE: Extract operation ID from client for end-to-end tracing
  const operationId = req.headers['x-operation-id'] as string || `server_${Date.now()}`;
  const startTime = Date.now();
  
  console.log(`[UserRoute][${operationId}] 📥 PATCH /api/user request received`, {
    timestamp: new Date().toISOString(),
    userId: req.user?.id,
  });
  
  try {
    if (!req.user) {
      console.log(`[UserRoute][${operationId}] ❌ Unauthorized - no user in request`);
      return res.status(401).json({ message: 'User not found' });
    }
    
    const userId = req.user.id;

    const sanitizedBody = { ...req.body };
    if (sanitizedBody.educationLevel === '') {
      delete sanitizedBody.educationLevel;
    }

    // Validate request body with Zod schema
    const parseResult = editableProfileSchema.safeParse(sanitizedBody);
    if (!parseResult.success) {
      console.error(`[UserRoute][${operationId}] ❌ Validation error for user ${req.user?.id}:`, parseResult.error.flatten());
      return res.status(422).json({
        message: 'Invalid profile data',
        errors: parseResult.error.flatten().fieldErrors
      });
    }

    // Use validated data instead of raw req.body
    // Cast to Record type to allow dynamic property access needed by existing code patterns
    const updateData = parseResult.data as Record<string, unknown>;

    // CRITICAL: Track which fields were explicitly sent in the request body
    // This allows distinguishing between "field not sent" (undefined) vs "field intentionally cleared" (empty string/array)
    const explicitlySentFields = new Set(Object.keys(req.body));
    console.log(`[UserRoute][${operationId}] Explicitly sent fields:`, Array.from(explicitlySentFields));

    console.log(`[UserRoute] Updating user ${userId} with data:`, {
      ...updateData,
      desiredLocations: updateData.desiredLocations ? JSON.stringify(updateData.desiredLocations) : undefined,
      desiredCompanies: updateData.desiredCompanies ? JSON.stringify(updateData.desiredCompanies) : undefined,
      interests: updateData.interests ? JSON.stringify(updateData.interests) : undefined,
      professionalInterests: updateData.professionalInterests ? JSON.stringify(updateData.professionalInterests) : undefined
    });
    
    // SECURITY: Prevent client-controlled emailVerified flag manipulation
    // Only Firebase Admin verification should set emailVerified=true
    if (updateData.emailVerified === true) {
      logger.debug(`[UserRoute] SECURITY: Rejecting client-controlled emailVerified=true for user ${userId}`);
      delete updateData.emailVerified;
    }
    
    // SECURITY: Prevent client-controlled hasMinimumMatchData manipulation
    // This flag is ONLY set server-side in storage.ts when minimum fields are validated
    if (updateData.hasMinimumMatchData !== undefined) {
      logger.debug(`[UserRoute] SECURITY: Rejecting client-controlled hasMinimumMatchData for user ${userId}`);
      delete updateData.hasMinimumMatchData;
    }
    
    // SECURITY: Prevent client-controlled initialMatchJobsQueued manipulation
    // This flag controls job creation and must only be set server-side
    if (updateData.initialMatchJobsQueued !== undefined) {
      logger.debug(`[UserRoute] SECURITY: Rejecting client-controlled initialMatchJobsQueued for user ${userId}`);
      delete updateData.initialMatchJobsQueued;
    }
    
    // SECURITY: Prevent unauthorized registrationCompleted bypass
    // Never allow setting back to false - this would be a security breach
    if (updateData.registrationCompleted === false) {
      logger.debug(`[UserRoute] SECURITY: Rejecting attempt to set registrationCompleted=false for user ${userId}`);
      delete updateData.registrationCompleted;
    }
    // Note: Validation for registrationCompleted=true happens later after we fetch existingUser
    
    // Remove platform indicator if present (not a database field)
    delete updateData.isNativeIOSApp;

    // Ensure array fields are properly formatted before sending to storage
    const arrayFields = [
      'desiredLocations', 
      'desiredCompanies',
      'interests',
      'professionalInterests',
      'languages',
      'resumePreviewUrls'
    ];
    
    // Process arrays to ensure they're formatted correctly
    // SECURITY: Use type-safe accessor functions to prevent prototype pollution
    const getFieldValue = (data: Record<string, unknown>, field: string): unknown => {
      if (!Object.prototype.hasOwnProperty.call(data, field)) return undefined;
      return data[field];
    };
    
    const setFieldValue = (data: Record<string, unknown>, field: string, value: unknown): void => {
      if (arrayFields.includes(field)) {
        data[field] = value;
      }
    };
    
    const deleteField = (data: Record<string, unknown>, field: string): void => {
      if (arrayFields.includes(field) && Object.prototype.hasOwnProperty.call(data, field)) {
        delete data[field];
      }
    };
    
    arrayFields.forEach(field => {
      const fieldValue = getFieldValue(updateData, field);
      if (fieldValue !== undefined) {
        // If the field exists but isn't an array, try to convert it
        if (!Array.isArray(fieldValue)) {
          console.warn(`[UserRoute] Field ${field} is not an array, attempting to convert:`, fieldValue);
          
          if (typeof fieldValue === 'string' && fieldValue.startsWith('[')) {
            // If it's a JSON string, parse it
            try {
              const parsed = JSON.parse(fieldValue);
              setFieldValue(updateData, field, parsed);
              console.log(`[UserRoute] Successfully parsed ${field} as JSON:`, parsed);
            } catch (e) {
              console.error(`[UserRoute] Failed to parse ${field} JSON:`, e);
              // Don't default to empty array - remove field if parsing fails
              deleteField(updateData, field);
            }
          } else if (fieldValue === null || fieldValue === '') {
            // If null or empty string and field was explicitly sent, set to empty array (intentional clear)
            // If field was not explicitly sent, remove it (preserve existing value)
            if (explicitlySentFields.has(field)) {
              setFieldValue(updateData, field, []);
              console.log(`[UserRoute] Field ${field} intentionally cleared to empty array`);
            } else {
              deleteField(updateData, field);
            }
          } else if (fieldValue) {
            // If any other non-empty value, wrap in array
            setFieldValue(updateData, field, [fieldValue]);
          } else {
            // For undefined or other falsy values, remove field
            deleteField(updateData, field);
          }
        }
        if (Array.isArray(getFieldValue(updateData, field))) {
          setFieldValue(updateData, field, normalizeStringArray(getFieldValue(updateData, field)));
        }
        
        console.log(`[UserRoute] Final ${field} value:`, getFieldValue(updateData, field));
      }
    });

    // Get existing user data to preserve AI matching preferences when undefined values are sent
    const existingUser = await storage.getUser(userId);
    if (!existingUser) {
      return res.status(404).json({ message: "User not found" });
    }
    
    // SECURITY: Validate registrationCompleted=true requires hasMinimumMatchData
    // This prevents bypass by calling PATCH with registrationCompleted=true
    if (updateData.registrationCompleted === true) {
      const candidateUser = {
        ...existingUser,
        ...updateData,
      } as User;
      if (!hasRequiredFieldsForMatching(candidateUser)) {
        console.log(`[UserRoute] SECURITY: BLOCKING registrationCompleted=true for user ${userId} - hasMinimumMatchData is false`);
        console.log(`[UserRoute] SECURITY: User must complete minimum registration fields before marking complete`);
        delete updateData.registrationCompleted;
      } else {
        // User has minimum data, allow completion
        console.log(`[UserRoute] SECURITY: Allowing registrationCompleted=true for user ${userId} (has minimum match data)`);
      }
    }
    
    // A PATCH is a true explicit-field update. Never copy values from the
    // preflight read into the write set: doing so would overwrite a concurrent
    // edit to a field that this request did not send.
    const finalUpdateData = { ...updateData };

    // Check if location fields are being updated to trigger automatic geocoding
    const isCurrentLocationUpdated = finalUpdateData.currentLocation && 
      finalUpdateData.currentLocation !== existingUser.currentLocation;
    const isDesiredLocationsUpdated = finalUpdateData.desiredLocations && 
      JSON.stringify(finalUpdateData.desiredLocations) !== JSON.stringify(existingUser.desiredLocations);

    // Check if match-relevant fields are being updated to trigger synergy match refresh
    // CRITICAL: Only these 5 fields should trigger match regeneration
    const matchRelevantFields = [
      'currentCompany',
      'currentLocation',
      'industry',
      'desiredCompanies',
      'desiredLocations'
    ];

    const hasMatchRelevantChanges = matchRelevantFields.some(field => {
      const newValue = (finalUpdateData as Record<string, unknown>)[field];
      const oldValue = (existingUser as Record<string, unknown>)[field];
      
      // Handle array fields
      if (Array.isArray(newValue) || Array.isArray(oldValue)) {
        return JSON.stringify(newValue) !== JSON.stringify(oldValue);
      }
      
      // Handle string fields
      return newValue !== undefined && newValue !== oldValue;
    });

    console.log(`[UserRoute] Match-relevant changes detected: ${hasMatchRelevantChanges}`);
    if (hasMatchRelevantChanges) {
      console.log(`[UserRoute] Fields being updated that affect matching:`, 
        matchRelevantFields.filter(field => {
          const newValue = (finalUpdateData as Record<string, unknown>)[field];
          const oldValue = (existingUser as Record<string, unknown>)[field];
          if (Array.isArray(newValue) || Array.isArray(oldValue)) {
            return JSON.stringify(newValue) !== JSON.stringify(oldValue);
          }
          return newValue !== undefined && newValue !== oldValue;
        })
      );
    }

    // If match-relevant fields changed, increment profile version and cancel stale jobs
    let newProfileVersion = existingUser.profileVersion || 1;
    if (hasMatchRelevantChanges) {
      newProfileVersion = (existingUser.profileVersion || 1) + 1;
      finalUpdateData.profileVersion = newProfileVersion;
      logger.debug(`[UserRoute] Incrementing profile version to ${newProfileVersion} for user ${userId}`);
    }

    // Update user in database first
    const updatedUser = await storage.updateUser(userId, finalUpdateData, {
      expectedProfileVersion: parseExpectedProfileVersion(req) ?? existingUser.profileVersion,
    });
    console.log(`[UserRoute] User ${userId} updated successfully`);
    let profileSnapshotCreated = false;

    const ensureCurrentProfileSnapshot = async (): Promise<void> => {
      if (profileSnapshotCreated) return;
      const snapshot = await createCurrentProfileSnapshot(updatedUser);
      profileSnapshotCreated = true;
      logger.debug(`[UserRoute] Created snapshot ${snapshot.id} for user ${userId}`);
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // IMMEDIATE MATCH JOB QUEUEING: Queue jobs as soon as required fields are present
    // ═══════════════════════════════════════════════════════════════════════════
    // This section runs on EVERY profile update to catch the moment when all
    // required fields become available (typically during Step 3 of registration)
    const matchJobStatus = shouldQueueInitialMatchJobs(updatedUser);
    let initialMatchQueueAttempted = false;
    
    if (matchJobStatus.shouldQueue) {
      initialMatchQueueAttempted = true;
      console.log(`[UserRoute] 🎯 IMMEDIATE MATCH QUEUEING: User ${userId} ready for initial match jobs!`);
      console.log(`[UserRoute] Reason: ${matchJobStatus.reason}`);
      
      try {
        const timestamp = new Date().toISOString();
        // Ensure geocoding is complete before queueing jobs. The completion flag
        // is persisted only after every required direction is represented.
        // Coordinates are REQUIRED for location-based matching
        let needsGeocodingFix = false;
        let geocodingSuccess = true;
        
        // Check current location coordinates
        if (!updatedUser.currentLocationLat || !updatedUser.currentLocationLng) {
          logger.debug(`[UserRoute] Current location coordinates missing for user ${userId}`);
          needsGeocodingFix = true;
          try {
            await locationCacheService.updateUserCurrentLocation(userId, updatedUser.currentLocation!);
            console.log(`[UserRoute] ✅ Geocoded current location for user ${userId}`);
          } catch (geocodeError) {
            console.error(`[UserRoute] ❌ Failed to geocode current location:`, geocodeError);
            geocodingSuccess = false;
          }
        }
        
        // Check desired location coordinates
        if (!updatedUser.desiredLocationCoords || 
            updatedUser.desiredLocationCoords.length !== updatedUser.desiredLocations?.length) {
          logger.debug(`[UserRoute] Desired location coordinates missing for user ${userId}`);
          needsGeocodingFix = true;
          try {
            await locationCacheService.updateUserDesiredLocations(userId, updatedUser.desiredLocations!);
            console.log(`[UserRoute] ✅ Geocoded desired locations for user ${userId}`);
          } catch (geocodeError) {
            console.error(`[UserRoute] ❌ Failed to geocode desired locations:`, geocodeError);
            geocodingSuccess = false;
          }
        }
        
        // If we geocoded anything, refresh user data to get updated coordinates
        if (needsGeocodingFix && geocodingSuccess) {
          const refreshedUser = await storage.getUser(userId);
          if (refreshedUser) {
            Object.assign(updatedUser, refreshedUser);
            console.log(`[UserRoute] 🔄 Refreshed user data after geocoding`);
          }
        }

          await ensureCurrentProfileSnapshot();
        
        // STEP 3: Queue prioritized AI match jobs
        console.log(`[UserRoute] 🚀 Queueing prioritized AI match jobs for user ${userId}...`);
        
        const matchJobResult = await simpleMatchJobHelper.queuePrioritizedMatchJobs(userId);
        
        console.log(`[UserRoute] Initial match fan-out result for user ${userId}:`, {
          highPriorityJobs: matchJobResult.highPriorityJobs,
          lowPriorityJobs: matchJobResult.lowPriorityJobs,
          potentialMatches: matchJobResult.potentialMatches,
          requiredDirections: matchJobResult.requiredDirections,
          representedDirections: matchJobResult.representedDirections,
          failedDirections: matchJobResult.failedDirections.length,
          totalJobs: matchJobResult.highPriorityJobs + matchJobResult.lowPriorityJobs,
          queuedAt: timestamp
        });
        
        if (matchJobResult.complete) {
          const updateResult = await db.update(users)
            .set({
              initialMatchJobsQueued: true,
              initialMatchJobsQueuedAt: timestamp
            })
            .where(and(
              eq(users.id, userId),
              eq(users.initialMatchJobsQueued, false)
            ))
            .returning({ id: users.id });

          if (updateResult.length > 0) {
            updatedUser.initialMatchJobsQueued = true;
            updatedUser.initialMatchJobsQueuedAt = timestamp;
          } else {
            const refreshedUser = await storage.getUser(userId);
            if (refreshedUser) Object.assign(updatedUser, refreshedUser);
          }
        } else {
          logger.warn(`[UserRoute] Initial match fan-out remains incomplete for user ${userId}`, {
            failedDirections: matchJobResult.failedDirections.length,
            requiredDirections: matchJobResult.requiredDirections,
          });
          updatedUser.initialMatchJobsQueued = false;
          updatedUser.initialMatchJobsQueuedAt = null;
        }
        
      } catch (matchJobError) {
        console.error(`[UserRoute] ❌ ERROR queueing initial match jobs for user ${userId}:`, matchJobError);
        updatedUser.initialMatchJobsQueued = false;
        updatedUser.initialMatchJobsQueuedAt = null;
      }
    } else {
      console.log(`[UserRoute] ⏸️ Not queueing initial match jobs for user ${userId}: ${matchJobStatus.reason}`);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // REGISTRATION COMPLETION: Fallback for edge cases
    // ═══════════════════════════════════════════════════════════════════════════
    // This section is kept as a FALLBACK for edge cases where the immediate
    // queueing above didn't trigger (e.g., user completed registration before
    // this feature was deployed, or jobs failed and need retry)
    const isCompletingRegistration = 
      existingUser.registrationCompleted === false && 
      updatedUser.registrationCompleted === true;

    if (isCompletingRegistration && !initialMatchQueueAttempted) {
      logger.debug(`[UserRoute] 🎉 FALLBACK: User ${userId} completed registration!`);
      
      // Check if initial match jobs were already queued by the immediate section above
      if (updatedUser.initialMatchJobsQueued) {
        console.log(`[UserRoute] ✅ Initial match jobs already queued at ${updatedUser.initialMatchJobsQueuedAt} - skipping fallback`);
      } else if (hasRequiredFieldsForMatching(updatedUser)) {
        // FALLBACK: Only queue if not already done
        console.log(`[UserRoute] ⚠️ FALLBACK: Jobs not queued yet, attempting to queue now...`);
        
        try {
          const timestamp = new Date().toISOString();
          // Ensure geocoding complete
          let needsGeocodingFix = false;
          
          if (!updatedUser.currentLocationLat || !updatedUser.currentLocationLng) {
            logger.debug(`[UserRoute] Current location coordinates missing for user ${userId}`);
            needsGeocodingFix = true;
            try {
              await locationCacheService.updateUserCurrentLocation(userId, updatedUser.currentLocation!);
            } catch (geocodeError) {
              console.error(`[UserRoute] ❌ Failed to geocode current location:`, geocodeError);
            }
          }
          
          if (!updatedUser.desiredLocationCoords || 
              updatedUser.desiredLocationCoords.length !== updatedUser.desiredLocations?.length) {
            logger.debug(`[UserRoute] Desired location coordinates missing for user ${userId}`);
            needsGeocodingFix = true;
            try {
              await locationCacheService.updateUserDesiredLocations(userId, updatedUser.desiredLocations!);
            } catch (geocodeError) {
              console.error(`[UserRoute] ❌ Failed to geocode desired locations:`, geocodeError);
            }
          }
          
          if (needsGeocodingFix) {
            const refreshedUser = await storage.getUser(userId);
            if (refreshedUser) {
              Object.assign(updatedUser, refreshedUser);
            }
          }

          await ensureCurrentProfileSnapshot();
          
          // Queue jobs
          const matchJobResult = await simpleMatchJobHelper.queuePrioritizedMatchJobs(userId);
          
          console.log(`[UserRoute] FALLBACK match fan-out result for user ${userId}:`, {
            highPriorityJobs: matchJobResult.highPriorityJobs,
            lowPriorityJobs: matchJobResult.lowPriorityJobs,
            potentialMatches: matchJobResult.potentialMatches,
            requiredDirections: matchJobResult.requiredDirections,
            representedDirections: matchJobResult.representedDirections,
            failedDirections: matchJobResult.failedDirections.length,
            totalJobs: matchJobResult.highPriorityJobs + matchJobResult.lowPriorityJobs
          });
          
          if (matchJobResult.complete) {
            await db.update(users)
              .set({
                initialMatchJobsQueued: true,
                initialMatchJobsQueuedAt: timestamp
              })
              .where(and(
                eq(users.id, userId),
                eq(users.initialMatchJobsQueued, false)
              ));
            updatedUser.initialMatchJobsQueued = true;
            updatedUser.initialMatchJobsQueuedAt = timestamp;
          } else {
            logger.warn(`[UserRoute] FALLBACK match fan-out remains incomplete for user ${userId}`, {
              failedDirections: matchJobResult.failedDirections.length,
              requiredDirections: matchJobResult.requiredDirections,
            });
            updatedUser.initialMatchJobsQueued = false;
            updatedUser.initialMatchJobsQueuedAt = null;
          }
          
        } catch (matchJobError) {
          console.error(`[UserRoute] ❌ FALLBACK ERROR queuing jobs for user ${userId}:`, matchJobError);
          updatedUser.initialMatchJobsQueued = false;
          updatedUser.initialMatchJobsQueuedAt = null;
        }
      } else {
        logger.debug(`[UserRoute] ⚠️ User ${userId} completed registration but missing required fields for AI matching`);
      }
    }

    // Ensure incremental match jobs use an immutable profile snapshot.
    if (hasMatchRelevantChanges && !profileSnapshotCreated) {
      try {
        await ensureCurrentProfileSnapshot();
      } catch (error) {
        console.error(`[UserRoute] Error creating snapshot for user ${userId}:`, error);
      }
    }

    // Cancel stale background jobs if profile version changed
    if (hasMatchRelevantChanges) {
      try {
        const { backgroundJobQueue } = await import('../services/background-job-queue');
        const cancelledJobs = await backgroundJobQueue.cancelStaleJobsForUser(userId, newProfileVersion);
        console.log(`[UserRoute] Cancelled ${cancelledJobs} stale background jobs for user ${userId}`);
      } catch (error) {
        console.error(`[UserRoute] Error cancelling stale jobs for user ${userId}:`, error);
        // Don't fail the update, just log the error
      }
    }

    // Automatically geocode coordinates after successful user update
    if (isCurrentLocationUpdated) {
      const currentLocation = finalUpdateData.currentLocation as string;
      logger.debug(`[UserRoute] Current location changed for user ${userId}`);
      try {
        await locationCacheService.updateUserCurrentLocation(userId, currentLocation);
        console.log(`[UserRoute] Successfully geocoded current location for user ${userId}`);
      } catch (error) {
        console.error(`[UserRoute] Failed to geocode current location for user ${userId}:`, error);
        // Don't fail the update, just log the error
      }
    }

    if (isDesiredLocationsUpdated && finalUpdateData.desiredLocations) {
      const desiredLocations = finalUpdateData.desiredLocations as string[];
      logger.debug(`[UserRoute] Desired locations changed for user ${userId}`);
      try {
        await locationCacheService.updateUserDesiredLocations(userId, desiredLocations);
        console.log(`[UserRoute] Successfully geocoded desired locations for user ${userId}`);
      } catch (error) {
        console.error(`[UserRoute] Failed to geocode desired locations for user ${userId}:`, error);
        // Don't fail the update, just log the error
      }
    }

    // Use incremental match updates if match-relevant fields changed
    let queuedJobId: number | undefined;
    if (hasMatchRelevantChanges) {
      console.log(`[UserRoute] Using incremental match updates for user ${userId}`);
      try {
        // Use the new incremental update method from CMDCC
        // This will analyze which matches are stale and preserve valid ones
        const result = await centralizedMatchDescriptionCommandCenter.handleIncrementalProfileUpdate(
          userId,
          existingUser, // Old profile (captured before update)
          updatedUser  // New profile (after update)
        );
        
        queuedJobId = result.queuedJobId || undefined;
        
        if (result.queuedJobId) {
          logger.debug(`[UserRoute] Incremental update queued job ${result.queuedJobId} for user ${userId}`);
        } else {
          console.log(`[UserRoute] Incremental update completed with no jobs queued for user ${userId}`);
        }

      } catch (error) {
        console.error(`[UserRoute] Error in incremental match update for user ${userId}:`, error);
        // Don't fail the profile update, just log the error
      }
    }

    // Return updated user with job information
    const duration = Date.now() - startTime;
    console.log(`[UserRoute][${operationId}] ✅ PATCH SUCCESS - returning updated user data`, {
      userId,
      duration: `${duration}ms`,
      matchRefreshQueued: hasMatchRelevantChanges,
    });
    
    return res.json({
      ...toSelfUserDto(updatedUser),
      matchRefreshQueued: hasMatchRelevantChanges,
      queuedJobId
    });
  } catch (error) {
    if (error instanceof ProfileVersionConflictError) {
      return res.status(409).json({
        message: 'Profile changed before this update was saved. Refresh and retry with the latest profile.',
        code: 'PROFILE_VERSION_CONFLICT',
        profileVersion: error.actualProfileVersion,
      });
    }
    console.error(`[UserRoute][${operationId}] ❌ Error updating user:`, error);
    return res.status(500).json({ message: "Failed to update user" });
  }
});

// Admin route to fix missing coordinates for all users in the database
router.post('/fix-all-coordinates', requireAuthJWT, requireCompleteRegistration, requireAdmin, async (req, res) => {
  try {
    console.log(`[UserRoute] Fixing missing coordinates for all users...`);

    // Get all users with missing coordinates
    const allUsers: User[] = await db.select().from(users);
    const usersNeedingFix = allUsers.filter((user: User) => 
      (user.currentLocation && (!user.currentLocationLat || !user.currentLocationLng)) ||
      (user.desiredLocations?.length && (!user.desiredLocationCoords?.length || user.desiredLocationCoords.length !== user.desiredLocations.length))
    );

    console.log(`[UserRoute] Found ${usersNeedingFix.length} users needing coordinate fixes out of ${allUsers.length} total users`);

    let fixedCurrent = 0;
    let fixedDesired = 0;
    const errors: string[] = [];

    for (const user of usersNeedingFix) {
      try {
        // Fix current location coordinates
        if (user.currentLocation && (!user.currentLocationLat || !user.currentLocationLng)) {
          logger.debug(`[UserRoute] Fixing current location coordinates for user ${user.id}`);
          await locationCacheService.updateUserCurrentLocation(user.id, user.currentLocation);
          fixedCurrent++;
        }

        // Fix desired location coordinates
        if (user.desiredLocations?.length && (!user.desiredLocationCoords?.length || user.desiredLocationCoords.length !== user.desiredLocations.length)) {
          logger.debug(`[UserRoute] Fixing desired location coordinates for user ${user.id}`);
          await locationCacheService.updateUserDesiredLocations(user.id, user.desiredLocations);
          fixedDesired++;
        }
      } catch (error) {
        const errorMsg = `User ${user.id}: ${error instanceof Error ? error.message : String(error)}`;
        errors.push(errorMsg);
        console.error(`[UserRoute] Error fixing coordinates for user ${user.id}:`, error);
      }
    }

    return res.json({
      success: true,
      message: `Fixed coordinates for ${usersNeedingFix.length} users`,
      details: {
        usersProcessed: usersNeedingFix.length,
        currentLocationsFixed: fixedCurrent,
        desiredLocationsFixed: fixedDesired,
        errors: errors.length > 0 ? errors : undefined
      }
    });
  } catch (error) {
    console.error('[UserRoute] Error fixing all coordinates:', error);
    return res.status(500).json({ 
      message: error instanceof Error ? error.message : "Failed to fix coordinates"
    });
  }
});

// Utility route to ensure all users have geocoded coordinates
router.post('/ensure-coordinates', requireAuthJWT, requireCompleteRegistration, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'User not found' });
    }
    
    const userId = req.user.id;
    console.log(`[UserRoute] Ensuring coordinates are available for user ${userId}`);

    // Get current user data
    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    let coordinatesUpdated = false;

    // Check if current location needs geocoding
    if (user.currentLocation && (!user.currentLocationLat || !user.currentLocationLng)) {
      logger.debug(`[UserRoute] Geocoding missing current location coordinates for user ${userId}`);
      try {
        await locationCacheService.updateUserCurrentLocation(userId, user.currentLocation);
        coordinatesUpdated = true;
        console.log(`[UserRoute] Successfully geocoded current location for user ${userId}`);
      } catch (error) {
        console.error(`[UserRoute] Failed to geocode current location for user ${userId}:`, error);
      }
    }

    // Check if desired locations need geocoding
    if (user.desiredLocations?.length && (!user.desiredLocationCoords?.length || user.desiredLocationCoords.length !== user.desiredLocations.length)) {
      logger.debug(`[UserRoute] Geocoding missing desired location coordinates for user ${userId}`);
      try {
        await locationCacheService.updateUserDesiredLocations(userId, user.desiredLocations);
        coordinatesUpdated = true;
        console.log(`[UserRoute] Successfully geocoded desired locations for user ${userId}`);
      } catch (error) {
        console.error(`[UserRoute] Failed to geocode desired locations for user ${userId}:`, error);
      }
    }

    return res.json({ 
      success: true, 
      coordinatesUpdated,
      message: coordinatesUpdated ? "Coordinates updated successfully" : "All coordinates already available"
    });
  } catch (error) {
    console.error('[UserRoute] Error ensuring coordinates:', error);
    return res.status(500).json({ 
      message: error instanceof Error ? error.message : "Failed to ensure coordinates"
    });
  }
});

export default router;