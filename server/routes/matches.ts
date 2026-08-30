import { Router } from "express";
import { storage } from "../storage";
import { backgroundJobQueue } from "../services/background-job-queue";
import { simpleMatchJobHelper } from "../services/simple-match-job-helper";
import { requireAuthJWT } from '../auth';
import { requireCompleteRegistration } from '../middleware/require-complete-registration';
import { toMatchDto } from '../lib/privacy-dto';

const router = Router();

// Chain both middlewares: auth first, then registration check
router.use(requireAuthJWT);
router.use(requireCompleteRegistration);



// Get synergy matches for current user
router.get("/synergy/:profileVersion?", async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'User not found' });
    }
    
    console.log(`[Matches Route] Getting synergy matches for user ${req.user.id}`);
    
    // Get the current user
    const user = await storage.getUser(req.user.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    
    // Get current READY matches from storage (database already filters for current profile versions)
    const queryStart = Date.now();
    const matches = await storage.getMatchingSynergies(req.user.id);
    const queryTime = Date.now() - queryStart;
    console.log(`[PERF] Match query completed in ${queryTime}ms, returned ${matches.length} matches`);
    console.log(`[Matches Route] Found ${matches.length} current READY synergy matches`);
    
    // Check if there are any GENERATING matches (not yet complete)
    const hasGenerating = await storage.hasGeneratingMatches(req.user.id);
    console.log(`[Matches Route] hasGeneratingMatches check: ${hasGenerating} for user ${req.user.id}`);
    
    // Check if there's a pending or processing job for this user
    const hasPendingJob = await storage.checkPendingMatchJob(req.user.id);
    console.log(`[Matches Route] checkPendingMatchJob check: ${hasPendingJob} for user ${req.user.id}`);
    
    // Return 202 with pending status if matches are still being generated
    // This ensures ALL matches load together, not incrementally
    if (hasGenerating || hasPendingJob) {
      console.log(`[Matches Route] ⚠️ Match generation in progress - hasGenerating: ${hasGenerating}, hasPendingJob: ${hasPendingJob}`);
      console.log(`[Matches Route] ⏳ Waiting for ALL matches to complete before serving (currently have ${matches.length} READY)`);
      return res.status(202)
        .header('Cache-Control', 'no-store')
        .json({
          pending: true,
          reason: 'generation_in_progress',
          message: 'Generating your Synergy AI matches...'
        });
    }
    
    console.log(`[Matches Route] ✅ No generation in progress, serving ${matches.length} READY matches`);
    
    // CRITICAL FIX: Differentiate between "never generated" vs "generated with 0 results"
    if (matches.length === 0) {
      console.log('[Matches Route] No current READY matches found, no pending jobs or generating matches');
      
      // Check if user has ever had a completed match generation job
      const hasEverCompleted = await storage.hasCompletedMatchGeneration(req.user.id);
      
      if (!hasEverCompleted) {
        // User has NEVER had matches generated - use the fast path with seed job + prioritized jobs
        // The seed job (without targetUserId) tells Worker VM to mark matches as GENERATING
        // Then the prioritized per-target jobs complete quickly
        console.log('[Matches Route] User has never had matches generated, using seed + prioritized jobs (fast path)');
        
        try {
          // STEP 1: Queue the "seed" job first (same structure CMDCC uses)
          // Worker VM recognizes mode: 'SUMMARY_STUB' as the signal to create GENERATING rows
          const userProfileVersion = user.profileVersion;
          await backgroundJobQueue.queueJob(req.user.id, 'MATCH_DESCRIPTION', {
            userId: req.user.id,
            userProfileVersion: userProfileVersion,
            priority: 1,
            profileUpdated: false,
            mode: 'SUMMARY_STUB'
          }, 1);
          console.log('[Matches Route] Queued seed job for first-time user (mode: SUMMARY_STUB)');
          
          // STEP 2: Queue prioritized per-target jobs for each potential match
          // These will process quickly after Worker VM sets up GENERATING rows
          const result = await simpleMatchJobHelper.queuePrioritizedMatchJobs(req.user.id);
          console.log(`[Matches Route] Queued ${result.highPriorityJobs} high-priority + ${result.lowPriorityJobs} low-priority per-target jobs for ${result.potentialMatches} potential matches (first-time user fast path)`);
          
          // If no potential matches found, this is a legitimate "no matches" scenario
          if (result.potentialMatches === 0) {
            console.log('[Matches Route] No potential matches found for first-time user - returning empty array');
            return res.json({
              matches: [],
              apiConnectionIssue: false
            });
          }
        } catch (error) {
          console.error('[Matches Route] Error using fast path for first-time user:', error);
          // Fallback to legacy job if fast path fails
          console.log('[Matches Route] Falling back to legacy job queueing');
          await backgroundJobQueue.queueJob(req.user.id, 'MATCH_DESCRIPTION', {
            userId: req.user.id,
            profileUpdated: false
          });
        }
        
        console.log('[Matches Route] First-time user match generation started');
        
        return res.status(202)
          .header('Cache-Control', 'no-store')
          .json({
            pending: true,
            reason: 'generation_in_progress',
            message: 'Generating your Synergy AI matches...'
          });
      } else {
        // User HAS had matches generated before, but legitimately has 0 matches
        // Return empty array so frontend shows "No matches found" message
        console.log('[Matches Route] User has completed match generation before but has 0 legitimate matches - returning empty array');
        return res.json({
          matches: [],
          apiConnectionIssue: false
        });
      }
    }
    
    // Return matches with descriptions exactly as generated by Worker VM
    console.log(`[Matches Route] Serving ${matches.length} current READY matches - descriptions preserved as generated`);
    
    const cleanedMatches = matches.map(match => {
      let cleanDescription = match.matchDescription || `Professional with complementary interests in ${match.industry || 'your industry'}`;
      
      // Only remove AI metadata prefixes - preserve all actual content exactly as Worker VM generated it
      cleanDescription = cleanDescription
        .replace(/^\[AI_GENERATED\]\s*/gi, '')
        .replace(/^\[FALLBACK\]\s*/gi, '')
        .replace(/^DESCRIPTION_[12]:\s*/gi, '')
        .replace(/^\[What .+? sees about .+?\]\s*/gi, '')
        .replace(/\s*\(\d+\s*characters?(?:\s+excluding\s+spaces)?\)\s*$/gi, '')
        .trim();
      
      return toMatchDto({ ...match, matchDescription: cleanDescription });
    });

    return res.json({
      matches: cleanedMatches,
      apiConnectionIssue: false
    });
  } catch (error) {
    console.error("[Matches Route] Error getting synergy matches:", error);
    return res.status(500).json({ 
      message: "Failed to get synergy matches",
      apiConnectionIssue: true
    });
  }
});

// Trigger synergy match generation (for registration flow)
router.post("/synergy/trigger", async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'User not found' });
    }
    
    console.log(`[Matches Route] Triggering synergy match generation for user ${req.user.id}`);
    
    // Get the current user
    const user = await storage.getUser(req.user.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    
    // Check if user has minimum required data for matching
    if (!user.industry || !user.desiredCompanies || user.desiredCompanies.length === 0 || 
        !user.desiredLocations || user.desiredLocations.length === 0 || 
        !user.title || !user.currentCompany || !user.currentLocation) {
      console.log(`[Matches Route] User ${req.user.id} missing required data for matching`);
      return res.status(400).json({ 
        message: "Missing required profile data for matching",
        requiredFields: ['industry', 'desiredCompanies', 'desiredLocations', 'title', 'currentCompany', 'currentLocation']
      });
    }
    
    // Check if there's already a pending or processing job for this user
    const hasPendingJob = await storage.checkPendingMatchJob(req.user.id);
    if (hasPendingJob) {
      console.log(`[Matches Route] Match generation already in progress for user ${req.user.id}`);
      return res.json({
        success: true,
        message: 'Match generation already in progress'
      });
    }
    
    // Use seed job + prioritized job queueing for fast match generation
    console.log('[Matches Route] Using seed + prioritized job queueing for triggered match generation');
    try {
      // STEP 1: Queue the seed job first (Worker VM recognizes mode: 'SUMMARY_STUB')
      const userProfileVersion = user.profileVersion;
      await backgroundJobQueue.queueJob(req.user.id, 'MATCH_DESCRIPTION', {
        userId: req.user.id,
        userProfileVersion: userProfileVersion,
        priority: 1,
        profileUpdated: false,
        mode: 'SUMMARY_STUB'
      }, 1);
      console.log('[Matches Route] Queued seed job for triggered generation (mode: SUMMARY_STUB)');
      
      // STEP 2: Queue prioritized per-target jobs
      const result = await simpleMatchJobHelper.queuePrioritizedMatchJobs(req.user.id);
      console.log(`[Matches Route] Queued ${result.highPriorityJobs} high-priority + ${result.lowPriorityJobs} low-priority jobs for ${result.potentialMatches} potential matches`);
      
      if (result.potentialMatches === 0) {
        return res.json({
          success: true,
          message: 'No potential matches found',
          matchCount: 0
        });
      }
    } catch (error) {
      console.error('[Matches Route] Error using fast path:', error);
      // Fallback to legacy job if fast path fails
      console.log('[Matches Route] Falling back to legacy job queueing');
      await backgroundJobQueue.queueJob(req.user.id, 'MATCH_DESCRIPTION', {
        userId: req.user.id,
        profileUpdated: false
      });
    }
    
    console.log('[Matches Route] Successfully started match generation for user');
    
    return res.json({
      success: true,
      message: 'Match generation started'
    });
  } catch (error) {
    console.error("[Matches Route] Error triggering synergy match generation:", error instanceof Error ? error.name : 'unknown');
    return res.status(500).json({ 
      message: "Failed to trigger synergy match generation",
    });
  }
});

// Check job status for match generation
router.get("/job-status/:userId", async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ message: 'User not found' });
  }
  
  const userId = parseInt(req.params.userId);
  
  // Ensure user can only check their own job status (or allow admins in the future)
  if (req.user.id !== userId) {
    return res.status(403).json({ message: "Forbidden - can only check your own job status" });
  }

  try {
    // Check if there's a pending or processing job for this user
    const hasPendingJob = await storage.checkPendingMatchJob(userId);
    
    if (hasPendingJob) {
      return res.json({
        status: 'processing',
        message: 'Match generation is in progress'
      });
    }
    
    // Check if user has completed matches
    const matches = await storage.getMatchingSynergies(userId);
    
    if (matches.length > 0) {
      return res.json({
        status: 'completed',
        matchCount: matches.length,
        message: 'Matches are ready'
      });
    }
    
    // No job and no matches
    return res.json({
      status: 'idle',
      message: 'No active job or matches'
    });
  } catch (error) {
    console.error("[Matches Route] Error checking job status:", error instanceof Error ? error.name : 'unknown');
    return res.status(500).json({ 
      message: "Failed to check job status",
    });
  }
});

// Force regenerate synergy matches
router.post("/synergy/regenerate", async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'User not found' });
    }
    
    console.log(`[Matches Route] Regenerating synergy matches for user ${req.user.id}`);
    
    // Clear existing matches first
    await storage.clearSynergyMatchesForUser(req.user.id);
    console.log(`[Matches Route] Cleared existing synergy matches for user ${req.user.id}`);
    
    // Get the current user 
    const user = await storage.getUser(req.user.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    console.log(`[Matches Route] Found user ${req.user.id}, forcing regeneration of matches`);
    
    // Queue a job to regenerate matches in background
    await backgroundJobQueue.queueJob(req.user.id, 'MATCH_DESCRIPTION', {
      userId: req.user.id,
      profileUpdated: true,
      userProfileVersion: user.profileVersion,
      regenerationEpoch: Date.now(),
      priority: 1
    }, 1);
    console.log('[Matches Route] Queued match regeneration job for user');

    res.status(202).json({ 
      success: true, 
      message: 'Match regeneration queued - your fresh matches will appear shortly',
      pending: true
    });
  } catch (error) {
    console.error("[Matches Route] Error regenerating synergy matches:", error instanceof Error ? error.name : 'unknown');
    res.status(500).json({ 
      success: false,
      message: "Failed to regenerate synergy matches",
    });
  }
});

// Clear all synergy matches for a user
router.delete("/synergy", async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'User not found' });
    }
    
    console.log(`[Matches Route] Clearing all synergy matches for user ${req.user.id}`);
    await storage.clearSynergyMatchesForUser(req.user.id);
    console.log(`[Matches Route] Successfully cleared all synergy matches for user ${req.user.id}`);

    res.json({ 
      success: true, 
      message: "Successfully cleared all synergy matches" 
    });
  } catch (error) {
    console.error("[Matches Route] Error clearing synergy matches:", error instanceof Error ? error.name : 'unknown');
    res.status(500).json({ 
      success: false,
      message: "Failed to clear synergy matches",
    });
  }
});

// Check if user has pending match generation job
router.get("/pending-job", async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'User not found' });
    }
    
    const userId = req.user.id;
    const hasPendingJob = await storage.checkPendingMatchJob(userId);
    
    res.json({ pending: hasPendingJob });
  } catch (error) {
    console.error("[Matches Route] Error checking pending job:", error);
    res.status(500).json({ 
      error: "Failed to check pending job status",
      pending: false 
    });
  }
});

export default router;
