import type { Express } from "express";
import express from "express";
import { storage } from "./storage";
import { pool } from "./db";
import { User } from "@shared/schema";
import { editableProfileSchema } from "@shared/schema";
import { uploadResume, uploadPhoto, processResumeUpload, verifyUploadedFile } from "./upload";
import locationRouter from "./routes/locations";
import messagesRouter from "./routes/messages";
import matchesRouter from "./routes/matches";
import notificationsRouter from "./routes/notifications";
import passwordResetRouter from "./routes/password-reset";
import registerRouter from "./routes/register";
import firebaseAuthRouter from "./routes/firebase-auth";
import iosNativeVerifyRouter from "./routes/ios-native-verify";
import authTokensRouter from "./routes/auth-tokens";
import userRouter from "./routes/user";
import apiProxyRouter from "./routes/api-proxy";
import costAnalysisRouter from "./routes/cost-analysis";
import { zipAnalysisRoutes } from "./routes/zip-analysis";
import hybridLocationsRouter from "./routes/hybrid-locations";
import pushNotificationsRouter from "./routes/push-notifications";
import adminRouter from "./routes/admin";
import { centralizedMatchDescriptionCommandCenter } from "./services/centralized-match-description-command-center";
import type { UserMatchValidationResult } from "./services/centralized-match-description-command-center";
import path from "path";
import fs from "fs";
import { logger } from "./lib/logger";
import { verifyInternalAuth } from "./lib/internal-auth";
import { operationalMetricsSnapshot } from "./lib/operational-metrics";
import {
  authLimiter,
  tokenRefreshLimiter,
  registerLimiter,
  passwordResetLimiter,
  uploadLimiter,
  internalLimiter,
  publicLookupLimiter,
  expensiveRequestLimiter,
} from "./lib/rate-limits";
import { requireCompleteRegistration } from "./middleware/require-complete-registration";
import { requireAuthJWT } from "./auth";
import { authenticateUploadPrincipal } from "./middleware/auth-jwt";
import { requireTrustedOriginForSessionMutation } from "./lib/http-security";
import { requireVerifiedFirebaseUser, getRegistrant } from "./lib/register-auth";
import { notifyConnectionRequestRejected } from "./websocket-utils";
import {
  toConnectionDto,
  toConnectionRequestDto,
  toConversationDto,
  toAuthorizedPeerProfileDto,
  toPublicProfileDto,
  toSelfUserDto,
} from "./lib/privacy-dto";
import guidesRouter from "./seo/guides-router";
import { parseBoundedIntegerQuery, parseStrictPositiveInteger, boundedString } from "./lib/request-validation";
import { parseServerEnvironment } from "./lib/env";
import { queryDatabase } from "./lib/database-client";
import {
  DISCOVERABILITY_POLICY_VERSION,
  getDiscoverabilityState,
} from "./lib/discoverability-policy";

const PRIVACY_LAST_MODIFIED = process.env.PRIVACY_LAST_MODIFIED?.trim() || null;
const PRIVACY_LAST_MODIFIED_DISPLAY = PRIVACY_LAST_MODIFIED
  ? new Date(`${PRIVACY_LAST_MODIFIED}T00:00:00Z`).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    })
  : "not currently published";
const PRIVACY_DATE_METADATA = PRIVACY_LAST_MODIFIED
  ? `"dateModified": "${PRIVACY_LAST_MODIFIED}",`
  : "";

export async function registerRoutes(app: Express): Promise<void> {
  const serverEnv = parseServerEnvironment();
  // Public GEO/SEO guide pages + discovery files (robots.txt, sitemap.xml, llms.txt)
  app.use(guidesRouter);

  // Privacy Policy route (publicly accessible, no auth required)
  app.get('/privacy', (req, res) => {
    const privacyPolicy = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Privacy Policy | Referral</title>
    <meta name="description" content="Read Referral's privacy policy, including how we collect, use, store, and protect professional networking data." />
    <link rel="canonical" href="https://referralprofessional.net/privacy" />
    <meta name="robots" content="index,follow" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="Privacy Policy | Referral" />
    <meta property="og:description" content="Read Referral's privacy policy, including how we collect, use, store, and protect professional networking data." />
    <meta property="og:url" content="https://referralprofessional.net/privacy" />
    <meta property="og:image" content="https://referralprofessional.net/assets/og-social-card.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="Referral – Professional Networking" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="Privacy Policy | Referral" />
    <meta name="twitter:description" content="Read Referral's privacy policy, including how we collect, use, store, and protect professional networking data." />
    <meta name="twitter:image" content="https://referralprofessional.net/assets/og-social-card.png" />
    <meta name="twitter:image:alt" content="Referral – Professional Networking" />
    <link rel="icon" type="image/png" href="/app-icon-192.png?v=3" />
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      "name": "Privacy Policy | Referral",
      "url": "https://referralprofessional.net/privacy",
      "description": "Read Referral's privacy policy, including how we collect, use, store, and protect professional networking data.",
      ${PRIVACY_DATE_METADATA}
      "inLanguage": "en-US",
      "isPartOf": {
        "@type": "WebSite",
        "name": "Referral",
        "url": "https://referralprofessional.net"
      },
      "publisher": {
        "@type": "Organization",
        "name": "Referral",
        "url": "https://referralprofessional.net",
        "logo": {
          "@type": "ImageObject",
          "url": "https://referralprofessional.net/app-icon-192.png"
        }
      }
    }
    </script>
    <link rel="stylesheet" href="/privacy.css" />
</head>
<body>
    <h1>Privacy Policy for Referral</h1>
    <p class="last-updated">Last updated: ${PRIVACY_LAST_MODIFIED_DISPLAY}</p>

    <h2>1. Introduction</h2>
    <p>Welcome to Referral, an AI-powered professional networking application. We are committed to protecting your privacy and handling your data in an open and transparent manner. This privacy policy explains how we collect, use, store, and protect your personal information when you use our service.</p>

    <h2>2. Information We Collect</h2>
    <h3>2.1 Information You Provide</h3>
    <ul>
        <li><strong>Profile Information:</strong> Name, email address, professional title, company, industry, location, professional interests, and other profile details you choose to share</li>
        <li><strong>Resume Data:</strong> When you upload your resume, we process and store the content to enhance your profile</li>
        <li><strong>Communication Data:</strong> Messages you send through our platform, connection requests, and other communications</li>
        <li><strong>Preferences:</strong> Your settings, preferences, and choices within the application</li>
    </ul>

    <h3>2.2 Information We Collect Automatically</h3>
    <ul>
        <li><strong>Usage Data:</strong> How you interact with our app, features used, and time spent</li>
        <li><strong>Device Information:</strong> Device type, operating system, app version, and unique device identifiers</li>
        <li><strong>Location Data:</strong> Approximate location for networking matches (only when you provide location information)</li>
    </ul>

    <h2>3. How We Use Your Information</h2>
    <p>We use your information to:</p>
    <ul>
        <li>Provide and improve our professional networking services</li>
        <li>Generate AI-powered professional compatibility matches and descriptions</li>
        <li>Enable communication between users through our messaging system</li>
        <li>Send you relevant notifications about connections, messages, and app updates</li>
        <li>Ensure security and prevent fraudulent activity</li>
        <li>Comply with legal obligations</li>
    </ul>

    <h2>4. AI and Machine Learning</h2>
    <p>We use artificial intelligence to enhance your networking experience by:</p>
    <ul>
        <li>Analyzing professional profiles to suggest compatible connections</li>
        <li>Generating personalized compatibility descriptions</li>
        <li>Processing resume content to enhance profile completeness</li>
    </ul>
    <p>All AI processing is designed to improve professional networking opportunities while maintaining your privacy.</p>

    <h2>5. Information Sharing</h2>
    <p>We do not sell your personal information. We may share your information in the following circumstances:</p>
    <ul>
        <li><strong>With Other Users:</strong> Profile information you choose to make visible for networking purposes</li>
        <li><strong>Service Providers:</strong> Third-party services that help us operate our platform (with appropriate data protection agreements)</li>
        <li><strong>Legal Requirements:</strong> When required by law or to protect our rights and users' safety</li>
        <li><strong>Business Transfers:</strong> In case of merger, acquisition, or sale of our business</li>
    </ul>

    <h2>6. Data Security</h2>
    <p>We implement appropriate technical and organizational measures to protect your personal information against unauthorized access, alteration, disclosure, or destruction. This includes:</p>
    <ul>
        <li>Encryption of data in transit and at rest</li>
        <li>Regular security assessments and updates</li>
        <li>Access controls and authentication measures</li>
        <li>Secure data storage and processing practices</li>
    </ul>

    <h2>7. Your Rights and Choices</h2>
    <p>You have the right to:</p>
    <ul>
        <li>Access and review your personal information</li>
        <li>Update or correct your profile information</li>
        <li>Delete your account and associated data</li>
        <li>Control your privacy settings and visibility preferences</li>
        <li>Opt out of non-essential communications</li>
        <li>Request a copy of your data</li>
    </ul>

    <h2>8. Data Retention</h2>
    <p>We retain your personal information for as long as your account is active or as needed to provide you services. We will delete or anonymize your personal information when you delete your account, subject to legal retention requirements.</p>

    <h2>9. International Data Transfers</h2>
    <p>Your information may be transferred to and processed in countries other than your own. We ensure appropriate safeguards are in place to protect your privacy and rights when such transfers occur.</p>

    <h2>10. Children's Privacy</h2>
    <p>Our service is intended for professional use by individuals 18 years of age or older. We do not knowingly collect personal information from children under 18. If we become aware that we have collected personal information from a child under 18, we will delete such information promptly.</p>

    <h2>11. Changes to This Privacy Policy</h2>
    <p>We may update this privacy policy from time to time. We will notify you of any material changes by posting the new privacy policy on this page and updating the "Last updated" date. Your continued use of our service after any changes constitutes acceptance of the updated policy.</p>

    <h2>12. Contact Us</h2>
    <div class="contact-info">
        <p>If you have any questions about this privacy policy or our privacy practices, please contact us:</p>
        <p>Please use the support or contact channel available in the Referral app.</p>
        <p>A dedicated privacy contact address has not been published.</p>
    </div>

    <p class="policy-effective-date">
        This privacy policy applies to all users of the Referral application. The review date is ${PRIVACY_LAST_MODIFIED_DISPLAY}.
    </p>
</body>
</html>
    `;
    
    res.setHeader('Content-Type', 'text/html');
    res.send(privacyPolicy);
  });

  // Register the locations router first (before auth middleware)
  app.use('/api/locations', publicLookupLimiter, locationRouter);

  // Register messages router
  app.use('/api/messages', expensiveRequestLimiter, messagesRouter);

  // Register matches router
  app.use('/api/matches', expensiveRequestLimiter, matchesRouter);
  
  // Register notifications router
  app.use('/api/notifications', expensiveRequestLimiter, notificationsRouter);
  
  // Register password reset router (no auth required, rate limited)
  app.use('/api/password-reset', passwordResetLimiter, passwordResetRouter);
  
  // Register user registration router (no auth required, rate limited)
  app.use('/api/register', registerLimiter, registerRouter);
  
  // Register Firebase authentication router (no auth required, rate limited)
  app.use('/api/firebase-auth', authLimiter, firebaseAuthRouter);
  
  // Register JWT token management router (no auth required for token refresh, rate limited)
  app.use('/api/auth', tokenRefreshLimiter, authTokensRouter);
  
  // Register iOS native verification router (requires authentication, rate limited)
  app.use('/api/ios-native-verify', authLimiter, iosNativeVerifyRouter);
  
  // Register user router (requires authentication)
  app.use('/api/user', userRouter);
  
  // Register API proxy router (requires authentication for security)
  app.use('/api/proxy', publicLookupLimiter, apiProxyRouter);
  
  // Register cost analysis router (requires authentication)
  app.use('/api/cost-analysis', publicLookupLimiter, costAnalysisRouter);
  
  // Register ZIP code analysis router (requires authentication)
  app.use('/api/zip-analysis', zipAnalysisRoutes);
  
  // Register hybrid locations router (requires authentication)
  app.use('/api/hybrid-locations', expensiveRequestLimiter, hybridLocationsRouter);
  
  // Register push notifications router (requires authentication)
  app.use('/api/push-notifications', pushNotificationsRouter);
  
  // Register admin router (requires authentication)
  app.use('/api/admin', expensiveRequestLimiter, adminRouter);

  // CMDCC: Centralized Match & Description Command Center routes (requires authentication)
  
  // Profile version update route - triggers staleness detection and match regeneration
  app.post('/api/cmdcc/profile-update/:userId', requireAuthJWT, requireCompleteRegistration, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    try {
      const userId = parseStrictPositiveInteger(req.params.userId);
      const { changes } = req.body;
      
      if (!userId) {
        return res.status(400).json({ error: 'Invalid user ID' });
      }
      
      // CRITICAL SECURITY: Verify user can only update their own profile
      if (req.user!.id !== userId) {
        return res.status(403).json({ error: 'Unauthorized: Can only update your own profile' });
      }

      logger.debug(`[CMDCC API] Processing profile update for user ${userId}`);
      const result = await centralizedMatchDescriptionCommandCenter.processProfileUpdate(userId, changes || []);
      
      res.json({
        success: result.success,
        message: `Profile update processed. ${result.deletedStaleContent} matches marked stale.`,
        data: {
          staleBefore: result.staleBefore,
          staleAfter: result.staleAfter,
          processedMatches: result.processedMatches,
          deletedStaleContent: result.deletedStaleContent,
          errors: result.errors
        }
      });
    } catch (error) {
      logger.error('[CMDCC API] Error processing profile update:', error);
      res.status(500).json({ error: 'Failed to process profile update' });
    }
  });

  // Match validation route - validates if existing matches are still valid
  app.get('/api/cmdcc/validate-matches/:userId', requireAuthJWT, requireCompleteRegistration, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    try {
      const userId = parseStrictPositiveInteger(req.params.userId);
      
      if (!userId) {
        return res.status(400).json({ error: 'Invalid user ID' });
      }
      
      // CRITICAL SECURITY: Verify user can only validate their own matches
      if (req.user!.id !== userId) {
        return res.status(403).json({ error: 'Unauthorized: Can only validate your own matches' });
      }

      logger.debug(`[CMDCC API] Validating matches for user ${userId}`);
      const result: UserMatchValidationResult = await centralizedMatchDescriptionCommandCenter.validateUserMatches(userId);
      
      res.json({
        validMatches: result.validMatches.length,
        invalidMatches: result.invalidMatches.length,
        totalMatches: result.totalMatches,
        staleness: result.staleness
      });
    } catch (error) {
      logger.error('[CMDCC API] Error validating matches:', error);
      res.status(500).json({ error: 'Failed to validate matches' });
    }
  });

  // Staleness detection route - gets stale match count for a user
  app.get('/api/cmdcc/stale-matches/:userId', requireAuthJWT, requireCompleteRegistration, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    try {
      const userId = parseStrictPositiveInteger(req.params.userId);
      
      if (!userId) {
        return res.status(400).json({ error: 'Invalid user ID' });
      }
      
      // CRITICAL SECURITY: Verify user can only check their own stale matches
      if (req.user!.id !== userId) {
        return res.status(403).json({ error: 'Unauthorized: Can only check your own stale matches' });
      }

      logger.debug(`[CMDCC API] Getting stale match count for user ${userId}`);
      const staleCount = await storage.getStaleMatchCountForUser(userId);
      
      res.json({
        userId,
        staleMatchCount: staleCount,
        hasStaleContent: staleCount > 0
      });
    } catch (error) {
      logger.error('[CMDCC API] Error getting stale matches:', error);
      res.status(500).json({ error: 'Failed to get stale match count' });
    }
  });

  // Get all conversations for the current user
  app.get("/api/conversations", requireAuthJWT, requireCompleteRegistration, async (req, res) => {
    if (!req.user) {
        return res.sendStatus(401);
    }

    try {
        const currentUserId = req.user!.id;
        logger.debug(`[Routes] Getting all conversations for user ${currentUserId}`);

        const conversations = await storage.getUserConversations(currentUserId);
        logger.debug(`[Routes] Found ${conversations.length} conversations for user ${currentUserId}`);
        res.json(conversations.map(toConversationDto));
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('[Routes] Error getting conversations:', errorMessage);
        res.status(500).json({ message: "Failed to get conversations" });
    }
  });

  // Search through all messages in conversations
  app.get("/api/conversations/search", expensiveRequestLimiter, requireAuthJWT, requireCompleteRegistration, async (req, res) => {
    if (!req.user) {
        return res.sendStatus(401);
    }

    try {
        const currentUserId = req.user!.id;
        const searchQuery = boundedString(req.query.q, 100);

        if (!searchQuery) {
            return res.status(400).json({ message: "Search query is required" });
        }

         logger.debug(`[Routes] Searching conversations for user ${currentUserId}`);

        const searchResults = await storage.searchConversationMessages(currentUserId, searchQuery.trim());
        logger.debug(`[Routes] Found ${searchResults.length} matching conversations for user ${currentUserId}`);
        res.json(searchResults.map(toConversationDto));
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('[Routes] Error searching conversations:', errorMessage);
        res.status(500).json({ message: "Failed to search conversations" });
    }
  });

  // Get or create a specific conversation between two users
  app.get("/api/conversations/:userId", requireAuthJWT, requireCompleteRegistration, async (req, res) => {
    if (!req.user) {
        return res.sendStatus(401);
    }

    try {
        const currentUserId = req.user!.id;
        const otherUserId = parseStrictPositiveInteger(req.params.userId);

        if (!otherUserId) {
            logger.debug('[Routes] Invalid user ID provided:', req.params.userId);
            return res.status(400).json({ message: "Invalid user ID" });
        }

        logger.debug(`[Routes] Getting or creating conversation between users ${currentUserId} and ${otherUserId}`);

        const conversation = await storage.getOrCreateConversation(currentUserId, otherUserId);
         logger.debug(`[Routes] Conversation found or created: ${conversation.id}`);
        
        // Use the markConversationNotificationsAsRead method to only mark messages 
        // for this specific conversation as read, not all message notifications
        try {
            await storage.markConversationNotificationsAsRead(currentUserId, conversation.id);
            logger.debug(`[Routes] Marked message notifications for conversation ${conversation.id} as read for user ${currentUserId}`);
        } catch (markError) {
            logger.error('[Routes] Error marking conversation notifications as read:', markError);
            // Don't fail the main request if this fails
        }
        
        res.json(toConversationDto(conversation));
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('[Routes] Error getting conversation:', errorMessage);
        if (error instanceof Error && error.message === "Users are not connected") {
          return res.status(403).json({ message: "Conversations require an accepted connection" });
        }
        res.status(500).json({ message: "Failed to get conversation" });
    }
  });

  app.get("/api/network/potential", expensiveRequestLimiter, requireAuthJWT, requireCompleteRegistration, async (req, res) => {
    if (!req.user) {
      return res.sendStatus(401);
    }
    try {
      const page = parseBoundedIntegerQuery(req.query.page, 1, 1, 100);
      const perPage = parseBoundedIntegerQuery(req.query.perPage, 10, 1, 50);
      if (page === undefined || perPage === undefined) {
        return res.status(400).json({ message: "Invalid pagination" });
      }
      
      // Extract search parameters from query
      const searchParams: Partial<User> = {};
      
      if (req.query.fullName) {
        searchParams.fullName = req.query.fullName as string;
      }
      
      if (req.query.industry) {
        searchParams.industry = req.query.industry as string;
      }
      
      if (req.query.currentLocation) {
        searchParams.currentLocation = req.query.currentLocation as string;
      }
      
      if (req.query.currentCompany) {
        searchParams.currentCompany = req.query.currentCompany as string;
      }
      
      if (req.query.title) {
        searchParams.title = req.query.title as string;
      }
      
      const potentialConnections = await storage.getAllPotentialConnections(
        req.user.id, 
        page, 
        perPage, 
        Object.keys(searchParams).length > 0 ? searchParams : undefined
      );
      
      res
        .header("Cache-Control", "private, no-store")
        .json({
        ...potentialConnections,
        profiles: potentialConnections.profiles.map(toPublicProfileDto),
        discoverabilityPolicyVersion: DISCOVERABILITY_POLICY_VERSION,
        });
    } catch (error) {
      logger.error('Get potential connections error:', error);
      res.status(500).json({ message: "Failed to get potential connections" });
    }
  });

  app.get("/api/network/shared-interests", expensiveRequestLimiter, requireAuthJWT, requireCompleteRegistration, async (req, res) => {
    if (!req.user) {
      return res.sendStatus(401);
    }
    try {
      const radiusInMiles = parseBoundedIntegerQuery(req.query.radius, 50, 1, 500);
      if (radiusInMiles === undefined) {
        return res.status(400).json({ message: "Invalid radius" });
      }
      const currentUser = await storage.getUser(req.user.id);
      
      if (!currentUser) {
        return res.status(404).json({ message: "User not found" });
      }

      // Get all potential connections
      const allConnections = await storage.getAllPotentialConnections(req.user.id, 1, 1000);
      const allUsers = allConnections.profiles || [];

      // Import geocoding service
      const { GeocodingService } = await import('./services/geocoding');
      const geocoding = new GeocodingService();

      // First filter users by shared interests (fast, synchronous operation)
      const usersWithSharedInterests = allUsers.filter(user => {
        // Don't include current user
        if (user.id === currentUser.id) return false;

        // Check for shared interests (personal hobbies)
        const sharedInterests = user.interests?.filter((interest: string) => 
          currentUser.interests?.includes(interest)
        );

        // Check for shared professional interests
        const sharedProfessionalInterests = user.professionalInterests?.filter((interest: string) => 
          currentUser.professionalInterests?.includes(interest)
        );

        // Must have at least one shared interest
        return (sharedInterests && sharedInterests.length > 0) || 
               (sharedProfessionalInterests && sharedProfessionalInterests.length > 0);
      });

      // Parallelize geocoding checks for all users with shared interests
      // This prevents N+1 query pattern - all geocoding happens concurrently
      const radiusChecks = usersWithSharedInterests.map(async (user) => {
        // Check distance if both users have locations
        if (currentUser.currentLocation && user.currentLocation) {
          try {
            const isWithinRadius = await geocoding.isWithinRadius(
              currentUser.currentLocation,
              user.currentLocation,
              radiusInMiles
            );
            return { user, isWithin: isWithinRadius };
          } catch (error) {
            logger.error(`[SharedInterests] Error calculating distance between ${currentUser.currentLocation} and ${user.currentLocation}:`, error);
            // Fall back to exact location match if distance calculation fails
            const exactMatch = currentUser.currentLocation.toLowerCase().trim() === user.currentLocation.toLowerCase().trim();
            return { user, isWithin: exactMatch };
          }
        }
        // If either user has no location, exclude them
        return { user, isWithin: false };
      });

      // Execute all geocoding checks in parallel
      const radiusResults = await Promise.all(radiusChecks);
      
      // Filter to only users within radius
      const filteredUsers = radiusResults
        .filter(result => result.isWithin)
        .map(result => result.user);

      logger.debug(`[SharedInterests] Found ${filteredUsers.length} users with shared interests within ${radiusInMiles} miles`);
      res.json({ profiles: filteredUsers.map(toPublicProfileDto), hasMore: false });
    } catch (error) {
      logger.error('Get shared interests error:', error);
      res.status(500).json({ message: "Failed to get shared interests" });
    }
  });

  // Connection management routes
  app.post("/api/connections/request/:userId", expensiveRequestLimiter, requireAuthJWT, requireCompleteRegistration, async (req, res) => {
    if (!req.user) {
      logger.debug("[ConnectionRequest] User not authenticated, returning 401");
      return res.sendStatus(401);
    }
    
    logger.debug("[ConnectionRequest] Received request from authenticated user:", req.user.id);

    try {
      const senderId = req.user.id;
      const receiverId = parseStrictPositiveInteger(req.params.userId);
      logger.debug(`[ConnectionRequest] User ${senderId} is requesting connection with user ${receiverId}`);

      if (!receiverId) {
        logger.debug("[ConnectionRequest] Invalid user ID:", req.params.userId);
        return res.status(400).json({ message: "Invalid user ID" });
      }

      if (senderId === receiverId) {
        logger.debug("[ConnectionRequest] User attempting to connect with themselves");
        return res.status(400).json({ message: "Cannot connect with yourself" });
      }

      // First check if the connection request already exists
      try {
        const existingRequests = await storage.getOutgoingRequests(senderId);
        const existingRequest = existingRequests.find(r => r.receiverId === receiverId);
        
        if (existingRequest) {
          logger.debug(`[ConnectionRequest] Found existing request from ${senderId} to ${receiverId}, returning duplicate notification`);
          return res.status(200).json({ message: "Request already exists", isDuplicate: true });
        }
      } catch (checkError) {
        logger.error('[ConnectionRequest] Error checking for existing requests:', checkError);
        // Continue with the request creation as normal
      }

      logger.debug('[ConnectionRequest] Creating new connection request', { requestId: req.requestId });
      const request = await storage.createConnectionRequest(senderId, receiverId);
      logger.info('[ConnectionRequest] Connection request created', { requestId: req.requestId });
      
      // Send real-time WebSocket notification to the receiver
      let websocketDelivered = false;
      try {
        const { notifyConnectionRequest } = await import('./websocket-utils');
        websocketDelivered = await notifyConnectionRequest(receiverId, senderId, request.id);
        logger.debug('[ConnectionRequest] WebSocket notification delivered', { requestId: req.requestId });
      } catch (wsError) {
        logger.error('[ConnectionRequest] Failed to send WebSocket notification:', wsError);
      }

      // Push is the durable fallback for offline native clients. The callback
      // queue is only needed when both transports are unavailable.
      let pushDelivered = false;
      try {
        const { sendConnectionRequestNotification } = await import('./services/push-notifications');
        const senderUser = await storage.getUser(senderId);
        if (senderUser) {
          pushDelivered = await sendConnectionRequestNotification(receiverId, senderUser.fullName, req.requestId);
        }
      } catch (pushError) {
        logger.error('[ConnectionRequest] Failed to send push notification:', pushError);
      }

      if (!websocketDelivered && !pushDelivered) {
        try {
          const dedupeKey = `connection-request:${request.id}`;
          await storage.enqueueCallbackNotification(
            receiverId,
            'connectionRequest',
            JSON.stringify({ senderId, requestId: request.id }),
            2,
            new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            dedupeKey,
          );
          await storage.completeDeliveryObligation(dedupeKey);
        } catch (queueError) {
          logger.error('[ConnectionRequest] Failed to enqueue callback fallback:', queueError);
        }
      } else {
        await storage.completeDeliveryObligation(`connection-request:${request.id}`);
      }

      res.status(201).json(request);
    } catch (error) {
      logger.error('[ConnectionRequest] Creation error:', error);
      if (error instanceof Error && error.message === "Connection request already exists") {
        logger.debug("[ConnectionRequest] Duplicate request detected in storage layer");
        return res.status(200).json({ message: "Request already exists", isDuplicate: true });
      }
      if (error instanceof Error && error.message === "Users are already connected") {
        return res.status(409).json({ message: "Users are already connected" });
      }
      if (error instanceof Error && error.message === "Users cannot connect") {
        return res.status(403).json({ message: "Connection is unavailable" });
      }
      res.status(500).json({ message: "Failed to create connection request" });
    }
  });

  // Get pending requests route
  app.get("/api/connections/requests", requireAuthJWT, requireCompleteRegistration, async (req, res) => {
    if (!req.user) {
      return res.sendStatus(401);
    }
    try {
      const pendingRequests = await storage.getPendingRequestsReceived(req.user.id);
      
      // Connection request notifications will be marked as read individually when accepting/rejecting
      // This ensures notifications persist until explicitly acted upon
      // Removed automatic clearing of connection request notifications
      
      res.json(pendingRequests.map(toConnectionRequestDto));
    } catch (error) {
      logger.error('Get pending requests error:', error);
      res.status(500).json({ message: "Failed to get pending requests" });
    }
  });

  // Get outgoing requests route
  app.get("/api/connections/outgoing", requireAuthJWT, requireCompleteRegistration, async (req, res) => {
    if (!req.user) return res.sendStatus(401);
    try {
      const outgoingRequests = await storage.getOutgoingRequests(req.user.id);
      res.json(outgoingRequests.map(toConnectionRequestDto));
    } catch (error) {
      logger.error('Get outgoing requests error:', error);
      res.status(500).json({ message: "Failed to get outgoing requests" });
    }
  });

  // Get connections route
  app.get("/api/connections", requireAuthJWT, requireCompleteRegistration, async (req, res) => {
    if (!req.user) return res.sendStatus(401);
    try {
      const connections = await storage.getConnections(req.user.id);
      
      // Removed automatic marking of new connection notifications as read
      // Notifications will now persist until specific connections are clicked
      
      res.json(connections.map(toConnectionDto));
    } catch (error) {
      logger.error('Get connections error:', error);
      res.status(500).json({ message: "Failed to get connections" });
    }
  });
  
  // Delete connection (disconnect from user)
  app.delete("/api/connections/:userId", expensiveRequestLimiter, requireAuthJWT, requireCompleteRegistration, async (req, res) => {
    if (!req.user) return res.sendStatus(401);
    
    try {
      const currentUserId = req.user.id;
      const otherUserId = parseStrictPositiveInteger(req.params.userId);
      
      if (!otherUserId) {
        return res.status(400).json({ message: "Invalid user ID" });
      }
      
      // Check if there's a connection between the users
      const connection = await storage.getConnectionBetweenUsers(currentUserId, otherUserId);
      
      if (!connection) {
        return res.status(404).json({ message: "Connection not found" });
      }
      
      // Delete the connection
      await storage.deleteConnection(currentUserId, otherUserId);
      
      res.status(200).send();
    } catch (error) {
      logger.error('Delete connection error:', error);
      res.status(500).json({ message: "Failed to delete connection" });
    }
  });

  // Update connection status route
  app.patch("/api/connections/:id", requireAuthJWT, requireCompleteRegistration, async (req, res) => {
    if (!req.user) {
      return res.sendStatus(401);
    }

    try {
      const requestId = parseStrictPositiveInteger(req.params.id);
      const currentUserId = req.user.id;
      const { status } = req.body;

      if (!requestId) {
        return res.status(400).json({ message: "Invalid connection request ID" });
      }
      if (!["accepted", "rejected"].includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
      }

      // Resolve and authorize the request before touching its notification.
      // The request ID alone is not an authorization boundary.
      const requestDetails = await storage.getConnectionRequestById(requestId);
      if (!requestDetails) {
        return res.status(404).json({ message: "Connection request not found" });
      }
      if (requestDetails.receiverId !== currentUserId) {
        return res.status(403).json({ message: "Not authorized to update this request" });
      }

      // Mark only this specific connection request notification as read
      // This prevents clearing all notification badges when accepting just one request
      try {
        // Get the notification for this specific connection request
        const relatedNotifications = await storage.getNotificationsForRelatedId(currentUserId, requestId, "connection_request");
        
        // Mark each notification related to this specific request as read
        for (const notification of relatedNotifications) {
          await storage.markNotificationAsRead(notification.id, currentUserId);
        }
        
        logger.debug(`[Routes] Marked ${relatedNotifications.length} notification(s) as read for connection request ${requestId}`);
      } catch (markError) {
        logger.error('[Routes] Error marking connection request notification as read:', markError);
        // Don't fail the main request if this fails
      }

      if (status === "accepted") {
        // Accept connection request and create bidirectional connection
        const connection = await storage.acceptConnectionRequest(requestId, currentUserId);

        if (!connection) {
          return res.status(404).json({ message: "Connection request not found" });
        }

        // Send real-time WebSocket notification to the original sender
        let websocketDelivered = false;
        try {
          const { notifyConnectionAccepted } = await import('./websocket-utils');
          websocketDelivered = await notifyConnectionAccepted(requestDetails.senderId, requestId, currentUserId);
          logger.debug(`[Routes] Sent WebSocket notification to user ${requestDetails.senderId} about accepted request ${requestId}`);
        } catch (wsError) {
          logger.error('[Routes] Failed to send WebSocket notification about accepted request:', wsError);
        }

        // Send push notification to iOS native users only (to the original requester)
        logger.debug('[ConnectionAccepted-PUSH] Entering push notification section', { requestId: req.requestId });
        
        let pushDelivered = false;
        try {
          const { sendConnectionAcceptedNotification } = await import('./services/push-notifications');
          const accepterUser = await storage.getUserById(currentUserId);
          
          if (accepterUser) {
            const pushResult = await sendConnectionAcceptedNotification(requestDetails.senderId, accepterUser.fullName, req.requestId);
            pushDelivered = pushResult;
            
            logger.debug('[ConnectionAccepted-PUSH] Push notification result', { delivered: pushResult, requestId: req.requestId });
            if (pushResult) {
              logger.info('[ConnectionAccepted-PUSH] Push notification delivered', { requestId: req.requestId });
            } else {
              logger.warn('[ConnectionAccepted-PUSH] Push notification was not delivered', { requestId: req.requestId });
            }
          } else {
            logger.error('[ConnectionAccepted-PUSH] Accepter user not found; cannot send push', undefined, { requestId: req.requestId });
          }
        } catch (pushError) {
          logger.error('[ConnectionAccepted-PUSH] Exception in push notification', pushError, { requestId: req.requestId });
          // Don't fail the request if push notification fails
        }

        if (!websocketDelivered && !pushDelivered) {
          try {
            const dedupeKey = `connection-accepted:${requestId}`;
            await storage.enqueueCallbackNotification(
              requestDetails.senderId,
              'connectionAccepted',
              JSON.stringify({ acceptedById: currentUserId, requestId }),
              2,
              new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
              dedupeKey,
            );
            await storage.completeDeliveryObligation(dedupeKey);
          } catch (queueError) {
            logger.error('[Routes] Failed to enqueue accepted-connection callback fallback:', queueError);
          }
        } else {
          await storage.completeDeliveryObligation(`connection-accepted:${requestId}`);
        }
        
        logger.debug('[ConnectionAccepted-PUSH] Exiting push notification section', { requestId: req.requestId });

        logger.info('Connection accepted successfully', { requestId: req.requestId });
        res.json(connection);
      } else {
        // Reject the connection request
        const rejected = await storage.rejectConnectionRequest(requestId, currentUserId);
        if (!rejected) {
          return res.status(404).json({ message: "Connection request not found" });
        }
        logger.debug(`Connection request ${requestId} rejected`);
        
        // Notify the original requester about the rejection via WebSocket
        try {
          await notifyConnectionRequestRejected(requestDetails.senderId, requestId, requestDetails.receiverId);
          logger.debug(`[Routes] Sent WebSocket notification to user ${requestDetails.senderId} about rejected request ${requestId} by user ${requestDetails.receiverId}`);
        } catch (wsError) {
          logger.error('[Routes] Error sending WebSocket notification about rejected request:', wsError);
          // Don't fail the main request if this fails
        }
        
        res.sendStatus(200);
      }
    } catch (error) {
      logger.error('Connection request update error:', error);
      if (error instanceof Error && error.message === "Connection request not found") {
        return res.status(404).json({ message: "Request not found" });
      }
      res.status(500).json({ message: "Failed to update connection request" });
    }
  });

  // Delete connection request route
  app.delete("/api/connections/request/:userId", expensiveRequestLimiter, requireAuthJWT, requireCompleteRegistration, async (req, res) => {
    if (!req.user) return res.sendStatus(401);
    try {
      const senderId = req.user.id;
      const receiverId = parseStrictPositiveInteger(req.params.userId);
      
      if (!receiverId) {
        return res.status(400).json({ message: "Invalid user ID" });
      }
      
      // Get outgoing requests to find the specific request to cancel
      const outgoingRequests = await storage.getOutgoingRequests(senderId);
      const requestToCancel = outgoingRequests.find(req => req.receiverId === receiverId);
      
      if (!requestToCancel) {
        return res.status(404).json({ message: "Connection request not found" });
      }
      
      // Mark any connection request notifications as read for both users
      try {
        // For the sender (current user)
        await storage.markAllNotificationsAsRead(senderId, "connection_request");
        
        // For the receiver of the request
        await storage.markAllNotificationsAsRead(receiverId, "connection_request");
        
        logger.debug(`[Routes] Marked connection request notifications as read for users ${senderId} and ${receiverId}`);
      } catch (markError) {
        logger.error('[Routes] Error marking connection request notifications as read:', markError);
        // Don't fail the main request if this fails
      }
      
      // Use the rejectConnectionRequest method to cancel the request
      await storage.rejectConnectionRequest(requestToCancel.id);
      res.sendStatus(200);
    } catch (error) {
      logger.error('Cancel connection request error:', error);
      res.status(500).json({ message: "Failed to cancel connection request" });
    }
  });

  // Update user route for autosave functionality
  app.patch("/api/users/:id", requireAuthJWT, requireCompleteRegistration, async (req, res) => {
    if (!req.user) {
      return res.sendStatus(401);
    }

    try {
      logger.debug(`[User Update] Received profile update request`, {
        requestedUserId: req.params.id,
        authenticatedUser: req.user.id
      });
      
      const userId = parseStrictPositiveInteger(req.params.id);
      
      if (!userId) {
        logger.error(`[User Update] Invalid user ID: ${req.params.id}`);
        return res.status(400).json({ message: "Invalid user ID" });
      }
      
      if (userId !== req.user.id) {
        logger.error(`[User Update] Authorization error: User ${req.user.id} attempted to update user ${userId}`);
        return res.status(403).json({ message: "You can only update your own profile" });
      }
      
      // Validate that the update data exists and is non-empty
      if (!req.body || Object.keys(req.body).length === 0) {
        logger.error(`[User Update] Empty update data for user ${userId}`);
        return res.status(400).json({ message: "No update data provided" });
      }

      const parseResult = editableProfileSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(422).json({ message: "Invalid profile data" });
      }
      const profileData = parseResult.data;
      
      // Check if this is a profile update that would affect matching
      // CRITICAL: Only these 5 fields should trigger match regeneration
      const matchingRelatedFields = [
        'currentCompany', 'currentLocation', 'industry', 
        'desiredCompanies', 'desiredLocations'
      ];
      
      const affectsMatching = Object.keys(profileData).some(key => 
        matchingRelatedFields.includes(key)
      );
      
      // Password changes are not supported - Firebase authentication is used exclusively
      if ((req.body as Record<string, unknown>).currentPassword || (req.body as Record<string, unknown>).newPassword) {
        logger.error(`[User Update] Password change requested for user ${userId} - not supported with Firebase authentication`);
        return res.status(400).json({ message: "Password changes must be done through Firebase authentication" });
      }

      // Get existing user data to preserve AI matching preferences when empty arrays are sent
      const existingUser = await storage.getUserById(userId);
      if (!existingUser) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Preserve existing AI matching preferences data when empty arrays are sent
      // Use only the validated allowlist. Explicit empty strings/arrays are
      // intentional clears and must not be replaced with old values.
      const updateData = { ...profileData };
      
      logger.debug(`[User Update] Preserving AI matching preferences:`, {
        desiredLocations: updateData.desiredLocations,
        desiredCompanies: updateData.desiredCompanies
      });
      
      const updatedUser = await storage.updateUser(userId, updateData);
      
      // Create immutable snapshot for rollback safety
      try {
        const { snapshotService } = await import('./services/profile-snapshot-service.js');
        const { extractProfileData } = await import('./services/background-job-queue.js');
        
        const profileData = extractProfileData(updatedUser);
        const snapshot = await snapshotService.createSnapshot(userId, profileData);
        
        // Update user's currentSnapshotId pointer
        await storage.updateUser(userId, { currentSnapshotId: snapshot.id });
        
        logger.debug(`[User Update] Created snapshot ${snapshot.id} for user ${userId}`);
      } catch (snapshotError) {
        logger.error('[User Update] Failed to create snapshot', { userId, error: snapshotError });
        // Don't fail the update if snapshot creation fails
      }
      
      // If this update affects matching, use CMDCC for bidirectional propagation with WebSocket notifications
      if (affectsMatching) {
        try {
          logger.debug(`[User Update] Update affects matching criteria. Using CMDCC for bidirectional propagation...`);
          
          // Get the changed fields that affect matching
      const changedFields = Object.keys(profileData).filter(key => 
            matchingRelatedFields.includes(key)
          );
          
          logger.debug(`[User Update] Changed matching fields for user ${userId}:`, changedFields);
          
          // Use CMDCC for comprehensive bidirectional match propagation
          const cmdccResult = await centralizedMatchDescriptionCommandCenter.processProfileUpdate(userId, changedFields);
          
          if (cmdccResult.success) {
            logger.debug(`[User Update] CMDCC processing successful:`, {
              deletedStaleContent: cmdccResult.deletedStaleContent,
              processedMatches: cmdccResult.processedMatches,
              errors: cmdccResult.errors
            });
          } else {
            logger.warn(`[User Update] CMDCC processing had issues:`, cmdccResult.errors);
          }
          
        } catch (syncError) {
          logger.error(`[User Update] Error with CMDCC bidirectional propagation:`, syncError);
          // Don't fail the whole update for sync errors
        }
      }
      
      logger.debug(`[User Update] Successfully updated user ${userId}`);
      res.json(toSelfUserDto(updatedUser));
    } catch (error) {
      logger.error('[User Update] Error:', error);
      res.status(500).json({ message: "Failed to update user" });
    }
  });

  // Get blocked users endpoint 
  // IMPORTANT: This route must be defined BEFORE the /api/users/:id route to avoid conflict
  app.get("/api/users/blocked", requireAuthJWT, requireCompleteRegistration, async (req, res) => {
    if (!req.user) {
      logger.debug("GET /api/users/blocked - User not authenticated");
      return res.sendStatus(401);
    }
    
    try {
      // Debug authentication information
      logger.debug(`GET /api/users/blocked - Authentication info:`, {
        isAuthenticated: req.isAuthenticated(),
        user: req.user,
        userId: req.user?.id,
        userIdType: typeof req.user?.id
      });
      
      // Check if user is properly authenticated with an ID
      if (!req.user || typeof req.user.id !== 'number') {
        logger.error("GET /api/users/blocked - Invalid user ID:", {
          user: req.user,
          userId: req.user?.id,
          userIdType: typeof req.user?.id
        });
        return res.status(400).json({ 
          message: "Invalid user ID",
          details: {
            user: req.user ? "exists" : "missing",
            userId: req.user?.id,
            userIdType: typeof req.user?.id
          }
        });
      }
      
      const currentUserId = req.user.id;
      logger.debug(`GET /api/users/blocked - Request from user ${currentUserId}`);
      
      // Get the list of blocked users
      const blockedUsers = await storage.getBlockedUsers(currentUserId);
      logger.debug(`GET /api/users/blocked - Found ${blockedUsers.length} blocked users for user ${currentUserId}`);
      
      res.status(200).json(blockedUsers.map(({ blockedUser, ...block }) => ({
        ...block,
        blockedUser: toPublicProfileDto(blockedUser),
      })));
    } catch (error) {
      logger.error('Get blocked users error:', error);
      res.status(500).json({ 
        message: "Failed to get blocked users",
        error: error instanceof Error ? error.message : "Unknown error"  
      });
    }
  });

  // Get user by ID
  app.get("/api/users/:id", requireAuthJWT, requireCompleteRegistration, async (req, res) => {
    if (!req.user) {
      return res.sendStatus(401);
    }
    
    try {
      const userId = parseStrictPositiveInteger(req.params.id);
      
      if (!userId) {
        return res.status(400).json({ message: "Invalid user ID" });
      }
      
      const user = await storage.getUserById(userId);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      if (user.id === req.user.id) {
        return res.json(toSelfUserDto(user));
      }

      const [blockedByViewer, blockedByTarget, connection] = await Promise.all([
        storage.isUserBlocked(req.user.id, user.id),
        storage.isUserBlocked(user.id, req.user.id),
        storage.getConnectionBetweenUsers(req.user.id, user.id),
      ]);
      if (
        blockedByViewer ||
        blockedByTarget ||
        (
          getDiscoverabilityState(user) !== 'eligible' &&
          !(connection && getDiscoverabilityState(user) === 'profile_hidden')
        )
      ) {
        return res.status(404).json({ message: "User not found" });
      }

      // Peer profile responses use a narrow public projection by default.
      // Resume references are included only for an accepted connection; the
      // media route independently re-checks the same boundary before serving
      // any private object.
      const profileDto = connection
        ? toAuthorizedPeerProfileDto(user)
        : toPublicProfileDto(user);
      return res
        .header("Cache-Control", "private, no-store")
        .json(profileDto);
    } catch (error) {
      logger.error('Get user error:', error);
      res.status(500).json({ message: "Failed to get user" });
    }
  });
  
  // Delete user by ID
  app.delete("/api/users/:id", requireAuthJWT, requireCompleteRegistration, async (req, res) => {
    if (!req.user) {
      return res.sendStatus(401);
    }
    
    try {
      const userId = parseStrictPositiveInteger(req.params.id);
      
      if (!userId) {
        return res.status(400).json({ message: "Invalid user ID" });
      }
      
      // Only allow users to delete their own account
      if (userId !== req.user.id) {
        return res.status(403).json({ message: "You can only delete your own account" });
      }
      
      // Get the user to confirm they exist
      const user = await storage.getUserById(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Delete the user
      await storage.deleteUser(userId);
      
      // Logout the user
      req.logout(function(err) {
        if (err) {
          logger.error('Logout error after user deletion:', err);
        }
        res.sendStatus(200);
      });
    } catch (error) {
      logger.error('Delete user error:', error);
      res.status(500).json({ message: "Failed to delete user" });
    }
  });
  
  // Block user endpoint
  app.post("/api/users/block/:userId", expensiveRequestLimiter, requireAuthJWT, requireCompleteRegistration, async (req, res) => {
    if (!req.user) {
      return res.sendStatus(401);
    }
    
    try {
      const currentUserId = req.user.id;
      const blockedUserId = parseStrictPositiveInteger(req.params.userId);
      
      if (!blockedUserId) {
        return res.status(400).json({ message: "Invalid user ID" });
      }
      
      if (currentUserId === blockedUserId) {
        return res.status(400).json({ message: "You cannot block yourself" });
      }
      
      // Check if the user to block exists
      const userToBlock = await storage.getUserById(blockedUserId);
      if (!userToBlock) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Block the user
      await storage.blockUser(currentUserId, blockedUserId);
      
      res.status(200).json({ message: "User blocked successfully" });
    } catch (error) {
      logger.error('Block user error:', error);
      if (error instanceof Error && error.message === "Cannot block yourself") {
        return res.status(400).json({ message: "You cannot block yourself" });
      }
      res.status(500).json({ message: "Failed to block user" });
    }
  });
  
  // Unblock user endpoint
  app.delete("/api/users/block/:userId", expensiveRequestLimiter, requireAuthJWT, requireCompleteRegistration, async (req, res) => {
    if (!req.user) {
      return res.sendStatus(401);
    }
    
    try {
      const currentUserId = req.user.id;
      const blockedUserId = parseStrictPositiveInteger(req.params.userId);
      
      if (!blockedUserId) {
        return res.status(400).json({ message: "Invalid user ID" });
      }
      
      // Unblock the user
      await storage.unblockUser(currentUserId, blockedUserId);
      
      res.status(200).json({ message: "User unblocked successfully" });
    } catch (error) {
      logger.error('Unblock user error:', error);
      res.status(500).json({ message: "Failed to unblock user" });
    }
  });
  


  // Serve uploaded files (profile photos, resumes, previews).
  // AUTHENTICATION REQUIRED: these are user PII. requireAuthJWT accepts either
  // a web session cookie (sent automatically by <img> tags on same-origin
  // pages) or an iOS JWT Bearer token. Unauthenticated requests get 401 and
  // client <img> onError handlers fall back to initials avatars.
  // Legacy local media is authorized against the authenticated user's current
  // database references before the file is served. Unknown or another user's
  // path returns the same 404 to avoid an existence oracle.
  app.get('/uploads/*', requireAuthJWT, async (req, res) => {
    try {
      const rawRelativePath = req.params[0];
      if (typeof rawRelativePath !== 'string' || rawRelativePath.length === 0) {
        return res.status(404).end();
      }
      const relativePath = decodeURIComponent(rawRelativePath);
      const candidate = path.resolve(process.cwd(), 'uploads', relativePath);
      const uploadRoot = path.resolve(process.cwd(), 'uploads');
      const relativeToRoot = path.relative(uploadRoot, candidate);
      if (!relativeToRoot || relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
        return res.status(404).end();
      }

      const reference = `/uploads/${relativePath}`;
      if (!await storage.canUserAccessLegacyMedia(req.user!.id, reference)) {
        return res.status(404).end();
      }

      const resolvedPath = await fs.promises.realpath(candidate);
      const resolvedRelativePath = path.relative(uploadRoot, resolvedPath);
      if (!resolvedRelativePath || resolvedRelativePath.startsWith('..') || path.isAbsolute(resolvedRelativePath)) {
        return res.status(404).end();
      }

      res.setHeader('Cache-Control', 'private, max-age=3600');
      return res.sendFile(resolvedPath);
    } catch (error) {
      logger.warn('[Media] Legacy media lookup failed', {
        requestId: req.requestId,
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      });
      return res.status(404).end();
    }
  });

  // Stable private media URLs resolve to short-lived Firebase signed URLs only
  // after application authentication. This keeps bucket objects private while
  // preserving normal <img>, PDF, and iOS WebView behavior.
  app.get('/api/media/:mediaId', requireAuthJWT, async (req, res) => {
    try {
      const { firebaseStorageService } = await import('./services/firebase-storage');
      const reference = `/api/media/${req.params.mediaId}`;
      const owner = await storage.getUserByMediaReference(reference);
      if (!owner) return res.status(404).json({ message: 'Media not found' });

      const isOwner = owner.id === req.user!.id;
      const isBlocked = !isOwner && (
        await storage.isUserBlocked(req.user!.id, owner.id) ||
        await storage.isUserBlocked(owner.id, req.user!.id)
      );
      if (isBlocked) return res.status(404).json({ message: 'Media not found' });

      const isPhoto = owner.photo === reference;
      const isResume = owner.resumeUrl === reference;
      const isPreview = (owner.resumePreviewUrls ?? []).includes(reference);
      if (!isPhoto && !isResume && !isPreview) {
        return res.status(404).json({ message: 'Media not found' });
      }
      if (!isOwner && (!owner.emailVerified || !owner.registrationCompleted)) {
        return res.status(404).json({ message: 'Media not found' });
      }
      if (!isOwner && !isPhoto && !(await storage.getConnectionBetweenUsers(req.user!.id, owner.id))) {
        return res.status(404).json({ message: 'Media not found' });
      }

      const signedUrl = await firebaseStorageService.getSignedReadUrlForMediaId(req.params.mediaId);
      res.setHeader('Cache-Control', 'private, no-store');
      return res.redirect(302, signedUrl);
    } catch (error) {
      logger.warn('[Media] Private media lookup failed', {
        requestId: req.requestId,
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      });
      return res.status(404).json({ message: 'Media not found' });
    }
  });

  // NOTE: This route was commented out to avoid conflicts with the messagesRouter
  /*
  app.get("/api/messages/:recipientId", async (req, res) => {
    if (!req.isAuthenticated()) {
      logger.debug('[Messages] Unauthorized access attempt');
      return res.sendStatus(401);
    }
    
    try {
      const currentUserId = req.user.id;
      const recipientId = parseStrictPositiveInteger(req.params.recipientId);
      
      logger.debug(`[Messages] Getting messages between ${currentUserId} and ${recipientId}`);
      
      if (!recipientId) {
        logger.debug(`[Messages] Invalid recipient ID: ${req.params.recipientId}`);
        return res.status(400).json({ message: "Invalid recipient ID" });
      }
      
      // Check if users are connected
      const connection = await storage.getConnectionBetweenUsers(currentUserId, recipientId);
      if (!connection) {
        logger.debug(`[Messages] No connection found between users ${currentUserId} and ${recipientId}`);
        return res.status(403).json({ message: "You must be connected with this user to view messages" });
      }
      
      logger.debug(`[Messages] Connection found: ${JSON.stringify(connection)}`);
      
      // Get or create conversation
      const conversation = await storage.getOrCreateConversation(currentUserId, recipientId);
      if (!conversation) {
        logger.debug(`[Messages] Failed to get or create conversation`);
        return res.status(500).json({ message: "Failed to get or create conversation" });
      }
      
      logger.debug(`[Messages] Using conversation: ${conversation.id}`);
      
      // Query messages directly from database for debugging
      const allMessages = await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conversation.id))
        .orderBy(asc(messages.createdAt));
      
      logger.debug(`[Messages] Direct DB query found ${allMessages.length} messages`);
      logger.debug('[Messages] First message sample:', allMessages.length > 0 ? JSON.stringify(allMessages[0]) : 'no messages');
      
      // Get messages between users
      const enhancedMessages = await storage.getMessages(currentUserId, recipientId);
      logger.debug(`[Messages] Enhanced messages count: ${enhancedMessages.length}`);
      
      res.json(enhancedMessages);
    } catch (error) {
      logger.error('[Messages] Error:', error);
      res.status(500).json({ 
        message: "Failed to get messages", 
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
  */

  // Resume upload endpoint (for both authenticated and unauthenticated users during registration)
  const requireUploadPrincipal = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authMethod = (req as express.Request & { authMethod?: 'jwt' | 'session' }).authMethod;
    if ((authMethod === 'jwt' || authMethod === 'session') && req.user) return next();
    return requireVerifiedFirebaseUser(req, res, next);
  };

  app.post('/api/upload/resume', uploadLimiter, authenticateUploadPrincipal, requireTrustedOriginForSessionMutation, requireUploadPrincipal, uploadResume.single('resume'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded' });
      }

       const userId = (req as express.Request & { authMethod?: string }).authMethod
         ? req.user?.id
         : undefined;
       const firebaseUid = !userId ? getRegistrant(req).uid : undefined;
      
       logger.debug('[Resume Upload] Processing upload', {
         authenticated: Boolean(userId),
       });

      logger.debug(`[Resume Upload] File received (${req.file.mimetype}, ${req.file.size} bytes)`);

      // Verify file contents match the extension (magic-byte check)
      if (req.file.path) {
        try {
          await verifyUploadedFile(req.file.path);
        } catch (verifyError) {
          return res.status(400).json({
            message: verifyError instanceof Error ? verifyError.message : 'Invalid file contents'
          });
        }
      }

      // Import Firebase Storage service
      const { firebaseStorageService } = await import('./services/firebase-storage');

      let result: { url: string; previewUrls: string[] };

      // Check if Firebase Storage is available
      if (firebaseStorageService.isAvailable()) {
        logger.debug('[Resume Upload] Uploading to Firebase Storage...');
        
        // Read file buffer
        const fileBuffer = req.file.buffer || fs.readFileSync(req.file.path);
        
        // Upload to Firebase Storage
        const firebaseResult = await firebaseStorageService.uploadResume(
          fileBuffer,
          req.file.originalname,
           userId,
           firebaseUid
        );

        result = {
          url: firebaseResult.url,
          previewUrls: firebaseResult.previewUrls || []
        };
        
         logger.debug('[Resume Upload] Firebase upload successful');

        // Clean up local temp file if it exists
        if (req.file.path) {
          try {
            fs.unlinkSync(req.file.path);
            logger.debug('[Resume Upload] Cleaned up local temp file');
          } catch (error) {
             logger.debug('[Resume Upload] Could not clean up temp file', {
               errorClass: error instanceof Error ? error.name : 'UnknownError',
             });
          }
        }
       } else if (!userId) {
         return res.status(503).json({ message: 'Managed media storage is unavailable' });
       } else {
        logger.debug('[Resume Upload] Firebase Storage not available, using local processing');
        // Fallback to local processing
        result = await processResumeUpload(req.file);
         logger.debug('[Resume Upload] Local processing complete');
      }
      
      // If the user is authenticated, update their profile with the resume info
       if (userId) {
        try {
           logger.debug('[Resume Upload] Updating resume for existing user');
          
          // Get the existing user first to preserve current values
          const currentUser = await storage.getUser(userId);
          if (!currentUser) {
            throw new Error(`User ${userId} not found`);
          }
          
          // Only update the resume fields, preserving all other fields
          await storage.updateUser(userId, {
            resumeUrl: result.url,
            resumePreviewUrls: result.previewUrls
          });
          
           logger.debug('[Resume Upload] Successfully updated resume for existing user');
        } catch (updateError) {
           logger.error('[Resume Upload] Error updating user resume', {
             errorClass: updateError instanceof Error ? updateError.name : 'UnknownError',
           });
          // We continue even if update fails - just log the error
        }
      } else {
        logger.debug('[Resume Upload] No authenticated user, returning URL only - will be saved during account creation');
      }
      
      res.json(result);
    } catch (error) {
       logger.error('[Resume Upload] Error', {
         errorClass: error instanceof Error ? error.name : 'UnknownError',
       });
      res.status(500).json({ 
         message: 'Failed to upload resume',
      });
    }
  });

  // Profile photo upload endpoint (two routes for backward compatibility)
  app.post(['/api/upload/photo', '/api/upload/profile-photo'], uploadLimiter, authenticateUploadPrincipal, requireTrustedOriginForSessionMutation, requireUploadPrincipal, uploadPhoto.single('photo'), async (req, res) => {
    // Accept photos even if not authenticated (for registration process)
     // Keep only bounded authentication metadata in logs.
     const userId = (req as express.Request & { authMethod?: string }).authMethod
       ? req.user?.id
       : undefined;
    const firebaseUid = !userId ? getRegistrant(req).uid : undefined;
     logger.debug('[Photo Upload] Processing upload', {
       authenticated: Boolean(userId),
       hasFirebaseRegistrant: Boolean(firebaseUid),
     });

    try {
      if (!req.file) {
        logger.debug('[Photo Upload] No file in request');
        return res.status(400).json({ message: 'No file uploaded' });
      }

      logger.debug(`[Photo Upload] File received (${req.file.mimetype}, ${req.file.size} bytes)`);

      // Verify file contents match the extension (magic-byte check)
      if (req.file.path) {
        try {
          await verifyUploadedFile(req.file.path);
        } catch (verifyError) {
          return res.status(400).json({
            message: verifyError instanceof Error ? verifyError.message : 'Invalid file contents'
          });
        }
      }

      // Import Firebase Storage service
      const { firebaseStorageService } = await import('./services/firebase-storage');

      let fileUrl: string;

      // Check if Firebase Storage is available
      if (firebaseStorageService.isAvailable()) {
        logger.debug('[Photo Upload] Uploading to Firebase Storage...');
        
        // Read file buffer
        const fileBuffer = req.file.buffer || fs.readFileSync(req.file.path);
        
        // Upload to Firebase Storage
        const result = await firebaseStorageService.uploadProfilePicture(
          fileBuffer,
          req.file.originalname,
           userId,
           firebaseUid
        );

        fileUrl = result.url;
         logger.debug('[Photo Upload] Firebase upload successful');

        // Clean up local temp file if it exists
        if (req.file.path) {
          try {
            fs.unlinkSync(req.file.path);
            logger.debug('[Photo Upload] Cleaned up local temp file');
          } catch (error) {
             logger.debug('[Photo Upload] Could not clean up temp file', {
               errorClass: error instanceof Error ? error.name : 'UnknownError',
             });
          }
        }
       } else if (!userId) {
         return res.status(503).json({ message: 'Managed media storage is unavailable' });
       } else {
         logger.debug('[Photo Upload] Firebase Storage not available, using local storage');
        // Fallback to local storage
        fileUrl = `/uploads/${path.basename(req.file.path)}`.replace(/\\/g, '/');
         logger.debug('[Photo Upload] Generated local media reference');
      }
      
      // If the user is authenticated, update their profile with the photo URL
       if (userId) {
        try {
           logger.debug('[Photo Upload] Updating photo for authenticated user');
          
          // Get the existing user first to preserve current values
          const currentUser = await storage.getUser(userId);
          if (!currentUser) {
            throw new Error(`User ${userId} not found`);
          }
          
          // Only update the photo field, preserving all other fields
          await storage.updateUser(userId, {
            photo: fileUrl
          });
          
           logger.debug('[Photo Upload] Successfully updated photo for authenticated user');
        } catch (updateError) {
           logger.error('[Photo Upload] Error updating user photo', {
             errorClass: updateError instanceof Error ? updateError.name : 'UnknownError',
           });
          // We continue even if update fails - just log the error
        }
      } else {
        logger.debug('[Photo Upload] No authenticated user, returning URL only');
      }
      
      // Return the URL to the uploaded file
      res.json({ url: fileUrl });
    } catch (error) {
       logger.error('[Photo Upload] Error', {
         errorClass: error instanceof Error ? error.name : 'UnknownError',
       });
      res.status(500).json({ 
         message: 'Failed to upload photo',
      });
    }
  });

  // Internal health check endpoint for worker connectivity testing
  // Allows worker VM to verify it can reach the main app
  app.get('/internal/health', internalLimiter, async (req, res) => {
    try {
      // Verify internal API secret (constant-time comparison)
      if (!process.env.INTERNAL_API_SECRET) {
        logger.error('[Internal API] INTERNAL_API_SECRET not configured');
        return res.status(401).json({ error: 'Unauthorized' });
      }

      if (!verifyInternalAuth(req.headers.authorization, process.env.INTERNAL_API_SECRET)) {
        logger.warn('[Internal API] Invalid authorization on health check');
        return res.status(401).json({ error: 'Unauthorized' });
      }
      
      // Import WebSocket utility to check connectivity
      const { getConnectedClientCount } = await import('./websocket-utils');
      const connectedClients = getConnectedClientCount();
      await queryDatabase(pool, 'SELECT 1');
      
      res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        websocket: {
          connected: connectedClients,
          available: true
        },
        database: {
          available: true // If we got here, DB is working
        }
      });
    } catch (error) {
      logger.error('[Internal API] Health check error', {
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({
        status: 'unhealthy',
        database: { available: false },
      });
    }
  });

  // Low-cardinality, PII-free process metrics for an authenticated monitor.
  // Never expose this endpoint publicly or attach user IDs/paths to its output.
  app.get('/internal/metrics', internalLimiter, async (req, res) => {
    if (!verifyInternalAuth(req.headers.authorization, process.env.INTERNAL_API_SECRET)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.json(operationalMetricsSnapshot());
  });

  // Internal callback endpoint for worker to trigger WebSocket match refresh
  // This allows the worker VM to notify the main app when matches are ready
  app.post('/internal/matches/refresh', internalLimiter, express.json({ limit: serverEnv.internalBodyLimitBytes }), async (req, res) => {
    try {
      // Verify internal API secret (constant-time comparison)
      if (!process.env.INTERNAL_API_SECRET) {
        logger.error('[Internal API] INTERNAL_API_SECRET not configured');
        return res.status(401).json({ error: 'Unauthorized' });
      }

      if (!verifyInternalAuth(req.headers.authorization, process.env.INTERNAL_API_SECRET)) {
        logger.warn('[Internal API] Invalid authorization');
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Payload shape: { userIds: number[] } — user IDs whose match lists
      // the Worker VM has finished regenerating.
      const { userIds } = req.body;

      if (!Array.isArray(userIds) || userIds.length === 0 || !userIds.every((id: unknown) =>
        typeof id === 'number' && Number.isSafeInteger(id) && id > 0
      )) {
        return res.status(400).json({ error: 'userIds array of numbers required' });
      }

      if (userIds.length > 1000) {
        return res.status(400).json({ error: 'userIds array too large (max 1000)' });
      }
      const uniqueUserIds = [...new Set(userIds as number[])];
      if (uniqueUserIds.length !== userIds.length) {
        return res.status(400).json({ error: 'userIds must not contain duplicates' });
      }

      logger.debug(`[Internal API] Match refresh callback received for ${userIds.length} user(s)`);
      
      // Import WebSocket broadcast function
      const { broadcastMatchRefreshToUsers } = await import('./websocket-utils');
      
      // Broadcast match refresh to all affected users
      const successCount = await broadcastMatchRefreshToUsers(uniqueUserIds);
      
      logger.debug(`[Internal API] Broadcasted match refresh to ${successCount}/${uniqueUserIds.length} users`);
      
      res.json({ 
        success: true, 
        broadcastCount: successCount,
        totalUsers: uniqueUserIds.length
      });
    } catch (error) {
      logger.error('[Internal API] Error processing match refresh callback:', error);
      res.status(500).json({ 
        error: 'Internal server error',
      });
    }
  });

}