import { Router } from 'express';
import { storage } from '../storage';
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

const router = Router();

// `hasRequiredFieldsForMatching` and `shouldQueueInitialMatchJobs` live in
// ../lib/profile-matching so they can be unit tested without importing this
// DB-connected route module (see server/lib/__tests__/profile-matching.test.ts).

// Get current user
router.get('/', requireAuthJWT, async (req, res) => {
  logger.debug("👤 [USER-ROUTE DEBUG] Handling /api/user GET request...", {
    timestamp: new Date().toISOString(),
    hasSession: !!req.session,
    isAuthenticated: req.isAuthenticated(),
    userAgent: req.get('User-Agent'),
    ip: req.ip
  });

  // SESSION PERSISTENCE VERIFICATION: Log detailed session information
  logger.debug("🔐 [SESSION-PERSISTENCE] Session details:", {
    hasCookieHeader: !!req.headers.cookie,
    cookieHeaderPresent: req.headers.cookie ? 'present (session cookie sent by browser)' : 'missing',
    isAuthenticated: req.isAuthenticated(),
    hasUser: !!req.user,
    userId: req.user?.id,
    cookieConfig: {
      secure: req.session?.cookie?.secure,
      sameSite: req.session?.cookie?.sameSite,
      maxAge: req.session?.cookie?.maxAge,
      maxAgeDays: req.session?.cookie?.maxAge ? Math.round(req.session.cookie.maxAge / (1000 * 60 * 60 * 24)) : 0,
      httpOnly: req.session?.cookie?.httpOnly,
      expires: req.session?.cookie?.expires
    },
    sessionResumed: req.session?.id && req.isAuthenticated() ? '✅ YES - Session restored from PostgreSQL database' : '❌ NO - New session or unauthenticated'
  });

  try {
    if (!req.user) {
      return res.status(401).json({ message: 'User not found' });
    }
    
    // Fetch fresh user data from database to ensure we have the latest
    const userId = req.user.id;
    logger.debug(`✅ [USER-ROUTE DEBUG] Authentication successful! Fetching user data for ID: ${userId}`, {
      requestTime: new Date().toISOString()
    });
    
    const user = await storage.getUser(userId);
    
    if (!user) {
      logger.error(`❌ [USER-ROUTE DEBUG] User ${userId} not found in database - this should not happen!`);
      return res.status(404).json({ message: "User not found" });
    }
    
    // Log important fields for debugging
    logger.debug(`[UserRoute] Retrieved user ${userId} data:`, {
      id: user.id,
      emailVerified: user.emailVerified,
      registrationCompleted: user.registrationCompleted,
      desiredLocations: Array.isArray(user.desiredLocations) ? user.desiredLocations : [],
      desiredCompanies: Array.isArray(user.desiredCompanies) ? user.desiredCompanies : [],
      interests: Array.isArray(user.interests) ? user.interests : [],
      professionalInterests: Array.isArray(user.professionalInterests) ? user.professionalInterests : []
    });
    
    // Return the fresh user data
    console.log(`✅ [USER-ROUTE DEBUG] Successfully returning user data for ID: ${userId}`, {
      hasRegistrationCompleted: user.registrationCompleted,
      hasEmailVerified: user.emailVerified,
      responseTime: new Date().toISOString()
    });
    return res.json(toSelfUserDto(user));
  } catch (error) {
    logger.error('💥 [USER-ROUTE DEBUG] Critical error fetching user data:', {
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
      userId: req.user?.id
    });
    return res.status(500).json({ message: "Failed to fetch user data" });
  }
});

// Update current user
router.patch('/', requireAuthJWT, async (req, res) => {
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
      if (!existingUser.hasMinimumMatchData) {
        console.log(`[UserRoute] SECURITY: BLOCKING registrationCompleted=true for user ${userId} - hasMinimumMatchData is false`);
        console.log(`[UserRoute] SECURITY: User must complete minimum registration fields before marking complete`);
        delete updateData.registrationCompleted;
      } else {
        // User has minimum data, allow completion
        console.log(`[UserRoute] SECURITY: Allowing registrationCompleted=true for user ${userId} (has minimum match data)`);
      }
    }
    
    // Preserve existing critical fields when empty values are sent from other registration steps
    const finalUpdateData = {
      ...updateData
    };
    
    // Preserve scalar fields ONLY if they were NOT explicitly sent in the request
    // If a field was explicitly sent (even as empty string), allow clearing it
    if (!explicitlySentFields.has('fullName') && existingUser.fullName) {
      logger.debug(`[UserRoute] Preserving existing fullName for user ${userId}`);
      finalUpdateData.fullName = existingUser.fullName;
    } else if (explicitlySentFields.has('fullName') && (updateData.fullName === '' || updateData.fullName === undefined)) {
      console.log(`[UserRoute] Intentionally clearing fullName (explicitly sent as empty)`);
    }
    
    if (!explicitlySentFields.has('birthday') && existingUser.birthday) {
      console.log(`[UserRoute] Preserving existing birthday: "${existingUser.birthday}" (field not sent in request)`);
      finalUpdateData.birthday = existingUser.birthday;
    } else if (explicitlySentFields.has('birthday') && (updateData.birthday === '' || updateData.birthday === undefined)) {
      console.log(`[UserRoute] Intentionally clearing birthday (explicitly sent as empty)`);
    }
    
    if (!explicitlySentFields.has('title') && existingUser.title) {
      console.log(`[UserRoute] Preserving existing title (field not sent in request)`);
      finalUpdateData.title = existingUser.title;
    } else if (explicitlySentFields.has('title') && (updateData.title === '' || updateData.title === undefined)) {
      console.log(`[UserRoute] Intentionally clearing title (explicitly sent as empty)`);
    }
    
    if (!explicitlySentFields.has('currentLocation') && existingUser.currentLocation) {
      logger.debug(`[UserRoute] Preserving existing currentLocation for user ${userId}`);
      finalUpdateData.currentLocation = existingUser.currentLocation;
    } else if (explicitlySentFields.has('currentLocation') && (updateData.currentLocation === '' || updateData.currentLocation === undefined)) {
      console.log(`[UserRoute] Intentionally clearing currentLocation (explicitly sent as empty)`);
    }
    
    if (!explicitlySentFields.has('industry') && existingUser.industry) {
      console.log(`[UserRoute] Preserving existing industry (field not sent in request)`);
      finalUpdateData.industry = existingUser.industry;
    } else if (explicitlySentFields.has('industry') && (updateData.industry === '' || updateData.industry === undefined)) {
      console.log(`[UserRoute] Intentionally clearing industry (explicitly sent as empty)`);
    }
    
    if (!explicitlySentFields.has('currentCompany') && existingUser.currentCompany) {
      console.log(`[UserRoute] Preserving existing currentCompany (field not sent in request)`);
      finalUpdateData.currentCompany = existingUser.currentCompany;
    } else if (explicitlySentFields.has('currentCompany') && (updateData.currentCompany === '' || updateData.currentCompany === undefined)) {
      console.log(`[UserRoute] Intentionally clearing currentCompany (explicitly sent as empty)`);
    }
    
    // CRITICAL: Always preserve registrationCompleted unless explicitly being updated
    // This prevents users from losing access when updating other profile fields like photo
    if (updateData.registrationCompleted === undefined && existingUser.registrationCompleted !== undefined) {
      console.log(`[UserRoute] Preserving existing registrationCompleted: ${existingUser.registrationCompleted}`);
      finalUpdateData.registrationCompleted = existingUser.registrationCompleted;
    }
    
    // Preserve array fields ONLY if they were NOT explicitly sent in the request
    // If a field was explicitly sent (even as empty array), allow clearing it
    if (!explicitlySentFields.has('desiredLocations') && existingUser.desiredLocations && existingUser.desiredLocations.length > 0) {
      logger.debug(`[UserRoute] Preserving existing desiredLocations for user ${userId}`);
      finalUpdateData.desiredLocations = existingUser.desiredLocations;
    } else if (explicitlySentFields.has('desiredLocations') && Array.isArray(updateData.desiredLocations) && updateData.desiredLocations.length === 0) {
      console.log(`[UserRoute] Intentionally clearing desiredLocations (explicitly sent as empty array)`);
    }
    
    if (!explicitlySentFields.has('desiredCompanies') && existingUser.desiredCompanies && existingUser.desiredCompanies.length > 0) {
      console.log(`[UserRoute] Preserving existing desiredCompanies (field not sent in request)`);
      finalUpdateData.desiredCompanies = existingUser.desiredCompanies;
    } else if (explicitlySentFields.has('desiredCompanies') && Array.isArray(updateData.desiredCompanies) && updateData.desiredCompanies.length === 0) {
      console.log(`[UserRoute] Intentionally clearing desiredCompanies (explicitly sent as empty array)`);
    }
    
    if (!explicitlySentFields.has('interests') && existingUser.interests && existingUser.interests.length > 0) {
      console.log(`[UserRoute] Preserving existing interests (field not sent in request)`);
      finalUpdateData.interests = existingUser.interests;
    } else if (explicitlySentFields.has('interests') && Array.isArray(updateData.interests) && updateData.interests.length === 0) {
      console.log(`[UserRoute] Intentionally clearing interests (explicitly sent as empty array)`);
    }
    
    if (!explicitlySentFields.has('professionalInterests') && existingUser.professionalInterests && existingUser.professionalInterests.length > 0) {
      console.log(`[UserRoute] Preserving existing professionalInterests (field not sent in request)`);
      finalUpdateData.professionalInterests = existingUser.professionalInterests;
    } else if (explicitlySentFields.has('professionalInterests') && Array.isArray(updateData.professionalInterests) && updateData.professionalInterests.length === 0) {
      console.log(`[UserRoute] Intentionally clearing professionalInterests (explicitly sent as empty array)`);
    }
    
    if (!explicitlySentFields.has('languages') && existingUser.languages && existingUser.languages.length > 0) {
      console.log(`[UserRoute] Preserving existing languages (field not sent in request)`);
      finalUpdateData.languages = existingUser.languages;
    } else if (explicitlySentFields.has('languages') && Array.isArray(updateData.languages) && updateData.languages.length === 0) {
      console.log(`[UserRoute] Intentionally clearing languages (explicitly sent as empty array)`);
    }
    
    console.log(`[UserRoute] Preserving AI matching preferences:`, {
      desiredLocations: finalUpdateData.desiredLocations,
      desiredCompanies: finalUpdateData.desiredCompanies
    });

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
    const updatedUser = await storage.updateUser(userId, finalUpdateData);
    console.log(`[UserRoute] User ${userId} updated successfully`);

    // ═══════════════════════════════════════════════════════════════════════════
    // IMMEDIATE MATCH JOB QUEUEING: Queue jobs as soon as required fields are present
    // ═══════════════════════════════════════════════════════════════════════════
    // This section runs on EVERY profile update to catch the moment when all
    // required fields become available (typically during Step 3 of registration)
    const matchJobStatus = shouldQueueInitialMatchJobs(updatedUser);
    
    if (matchJobStatus.shouldQueue) {
      console.log(`[UserRoute] 🎯 IMMEDIATE MATCH QUEUEING: User ${userId} ready for initial match jobs!`);
      console.log(`[UserRoute] Reason: ${matchJobStatus.reason}`);
      
      try {
        // STEP 1: Atomically mark jobs as queued BEFORE queueing to prevent race conditions
        // CRITICAL: Use conditional UPDATE to prevent duplicate job creation from concurrent requests
        // Only set the flag if it's currently false (prevents race condition)
        const timestamp = new Date().toISOString();
        const updateResult = await db.update(users)
          .set({ 
            initialMatchJobsQueued: true,
            initialMatchJobsQueuedAt: timestamp
          })
          .where(and(
            eq(users.id, userId),
            eq(users.initialMatchJobsQueued, false) // CRITICAL: Only update if not already queued
          ))
          .returning({ id: users.id });
        
        // Check if we won the race - if no rows affected, another request already queued the jobs
        if (!updateResult || updateResult.length === 0) {
          console.log(`[UserRoute] ⚠️ Race condition detected: Another request already queued initial match jobs for user ${userId}`);
          console.log(`[UserRoute] Refreshing user data to reflect queued status set by competing request`);
          
          // CRITICAL: Refresh user from database to get accurate queued status
          // This ensures the API response reflects the true database state
          const refreshedUser = await storage.getUser(userId);
          if (refreshedUser) {
            Object.assign(updatedUser, refreshedUser);
            console.log(`[UserRoute] ✅ User data refreshed - initialMatchJobsQueued: ${refreshedUser.initialMatchJobsQueued}`);
          }
        } else {
        
        console.log(`[UserRoute] ✅ Atomically set initialMatchJobsQueued=true for user ${userId} (won race condition check)`);
        
        // STEP 2: Ensure geocoding is complete before queuing jobs
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
        
        // STEP 3: Queue prioritized AI match jobs
        console.log(`[UserRoute] 🚀 Queueing prioritized AI match jobs for user ${userId}...`);
        
        const matchJobResult = await simpleMatchJobHelper.queuePrioritizedMatchJobs(userId);
        
        console.log(`[UserRoute] ✅ SUCCESS: Queued initial match jobs for user ${userId}:`, {
          highPriorityJobs: matchJobResult.highPriorityJobs,
          lowPriorityJobs: matchJobResult.lowPriorityJobs,
          potentialMatches: matchJobResult.potentialMatches,
          totalJobs: matchJobResult.highPriorityJobs + matchJobResult.lowPriorityJobs,
          queuedAt: timestamp
        });
        
        console.log(`[UserRoute] 📡 PostgreSQL NOTIFY sent - Worker VM will process jobs automatically`);
        
        // Update the local user object to reflect the queued status
        updatedUser.initialMatchJobsQueued = true;
        updatedUser.initialMatchJobsQueuedAt = timestamp;
        }
        
      } catch (matchJobError) {
        console.error(`[UserRoute] ❌ ERROR queueing initial match jobs for user ${userId}:`, matchJobError);
        
        // ROLLBACK: Reset the flag so jobs can be retried on next update
        try {
          await db.update(users)
            .set({ 
              initialMatchJobsQueued: false,
              initialMatchJobsQueuedAt: null
            })
            .where(eq(users.id, userId));
          
          console.log(`[UserRoute] 🔄 Rolled back initialMatchJobsQueued flag for user ${userId} to allow retry`);
        } catch (rollbackError) {
          console.error(`[UserRoute] ❌ Failed to rollback initialMatchJobsQueued flag:`, rollbackError);
        }
        
        // Don't fail the update - user can still use the app
        // Jobs will be retried on next profile update or registration completion
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

    if (isCompletingRegistration) {
      logger.debug(`[UserRoute] 🎉 FALLBACK: User ${userId} completed registration!`);
      
      // Check if initial match jobs were already queued by the immediate section above
      if (updatedUser.initialMatchJobsQueued) {
        console.log(`[UserRoute] ✅ Initial match jobs already queued at ${updatedUser.initialMatchJobsQueuedAt} - skipping fallback`);
      } else if (hasRequiredFieldsForMatching(updatedUser)) {
        // FALLBACK: Only queue if not already done
        console.log(`[UserRoute] ⚠️ FALLBACK: Jobs not queued yet, attempting to queue now...`);
        
        try {
          // Mark as queued atomically with race condition protection
          const timestamp = new Date().toISOString();
          const updateResult = await db.update(users)
            .set({ 
              initialMatchJobsQueued: true,
              initialMatchJobsQueuedAt: timestamp
            })
            .where(and(
              eq(users.id, userId),
              eq(users.initialMatchJobsQueued, false) // Only update if not already queued
            ))
            .returning({ id: users.id });
          
          // Check if we won the race
          if (!updateResult || updateResult.length === 0) {
            console.log(`[UserRoute] ⚠️ FALLBACK: Race condition - jobs already queued by another request`);
            return res.json(toSelfUserDto(updatedUser)); // Exit early
          }
          
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
          
          // Queue jobs
          const matchJobResult = await simpleMatchJobHelper.queuePrioritizedMatchJobs(userId);
          
          console.log(`[UserRoute] ✅ FALLBACK SUCCESS: Queued match jobs for user ${userId}:`, {
            highPriorityJobs: matchJobResult.highPriorityJobs,
            lowPriorityJobs: matchJobResult.lowPriorityJobs,
            potentialMatches: matchJobResult.potentialMatches,
            totalJobs: matchJobResult.highPriorityJobs + matchJobResult.lowPriorityJobs
          });
          
          updatedUser.initialMatchJobsQueued = true;
          updatedUser.initialMatchJobsQueuedAt = timestamp;
          
        } catch (matchJobError) {
          console.error(`[UserRoute] ❌ FALLBACK ERROR queuing jobs for user ${userId}:`, matchJobError);
          
          // Rollback flag
          try {
            await db.update(users)
              .set({ initialMatchJobsQueued: false, initialMatchJobsQueuedAt: null })
              .where(eq(users.id, userId));
          } catch (rollbackError) {
            console.error(`[UserRoute] ❌ Failed to rollback:`, rollbackError);
          }
        }
      } else {
        logger.debug(`[UserRoute] ⚠️ User ${userId} completed registration but missing required fields for AI matching`);
      }
    }

    // CRITICAL: Create immutable snapshot after profile update
    if (hasMatchRelevantChanges) {
      try {
        const profileData: ProfileData = {
          bio: updatedUser.bio,
          title: updatedUser.title,
          currentLocation: updatedUser.currentLocation,
          currentLocationLat: updatedUser.currentLocationLat,
          currentLocationLng: updatedUser.currentLocationLng,
          industry: updatedUser.industry,
          currentCompany: updatedUser.currentCompany,
          desiredLocations: updatedUser.desiredLocations,
          desiredCompanies: updatedUser.desiredCompanies,
          interests: updatedUser.interests,
          professionalInterests: updatedUser.professionalInterests,
          languages: updatedUser.languages,
          matchingRadius: updatedUser.matchingRadius,
          yearsOfExperience: updatedUser.yearsOfExperience,
          educationLevel: updatedUser.educationLevel,
          institution: updatedUser.institution,
        };

        const snapshot = await snapshotService.createSnapshot(userId, profileData);
        
        // Update user's current snapshot pointer
        await db.update(users)
          .set({ currentSnapshotId: snapshot.id })
          .where(eq(users.id, userId));
        
        logger.debug(`[UserRoute] Created snapshot ${snapshot.id} for user ${userId} after profile update`);
      } catch (error) {
        console.error(`[UserRoute] Error creating snapshot for user ${userId}:`, error);
        // Don't fail the update, just log the error
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