import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './lib/logger';
import { loadProjectEnvironment, parseServerEnvironment } from './lib/env';

// Get the current file's directory path first
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

loadProjectEnvironment();

import express from 'express';
import { createServer } from 'http';
import compression from 'compression';
import cors from 'cors';
import { storage } from './storage';
import { pool } from './db';
import { registerRoutes } from './routes';
import { setupAuth } from './auth';
import { ensurePortIsFree } from './port-checker';
import { setupWebSocketServer } from './websocket-handlers';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

declare module 'express-serve-static-core' {
  interface Request {
    requestId?: string;
  }
}

import { isSpaRoute, isNoIndexRoute } from './lib/spa-routes';
import { isOriginAllowed, securityHeaders } from './lib/http-security';
import { assertRequiredEnv } from './lib/startup-checks';
import {
  checkDatabaseReadiness,
  requiredSchemaTablesForMode,
} from './lib/database-readiness';
import { beginHttpRequest, recordHttpResponse } from './lib/operational-metrics';
import { queryDatabase } from './lib/database-client';
import { createServerLifecycle } from './lib/server-lifecycle';
import { copyProxyResponseHeaders } from './lib/proxy-headers';

// Function to serve static files in production
function serveStaticFiles(app: ReturnType<typeof express>) {
  logger.info('[%s] Setting up static file serving for production...', new Date().toISOString());
  
  const distPath = path.resolve(__dirname, '..', 'dist', 'public');
  
  if (!fs.existsSync(distPath)) {
    logger.error(`[%s] Build directory not found: ${distPath}`, new Date().toISOString());
    logger.error('[%s] Did you run the build command?', new Date().toISOString());
    throw new Error(`Could not find the build directory: ${distPath}`);
  }
  
  logger.info(`[%s] Serving static files from: ${distPath}`, new Date().toISOString());
  app.use(express.static(distPath));
  
  // Serve index.html only for known SPA routes.
  // Unrecognised paths return HTTP 404 so search engines and AI crawlers
  // correctly classify them as non-existent instead of indexing soft-404s.
  app.get('*', (req, res, next) => {
    // Skip API and WebSocket routes
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
      return next();
    }
    
    const indexHtmlPath = path.join(distPath, 'index.html');
    if (!fs.existsSync(indexHtmlPath)) {
      return next(new Error('index.html not found in build directory'));
    }

    const statusCode = isSpaRoute(req.path) ? 200 : 404;

    // Prevent search engines from indexing auth/utility pages.
    if (isNoIndexRoute(req.path)) {
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
    }

    res.status(statusCode).sendFile(indexHtmlPath);
  });
}

async function main() {
  logger.info('[%s] Starting server initialization...', new Date().toISOString());

  try {
    const isProduction = process.env.NODE_ENV === 'production';
    const serverEnv = parseServerEnvironment(process.env, { isProduction });
    const PORT_NUMBER = serverEnv.port;
    const isReplitEnv = process.env.REPLIT_CLUSTER || process.env.REPL_ID || process.env.REPL_SLUG;
    
    logger.info('[%s] Environment: %s, Using port: %d', 
      new Date().toISOString(), isReplitEnv ? 'Replit' : 'Local Mac', PORT_NUMBER);
    
    // Check if port is available first
    logger.debug('[%s] Checking port availability...', new Date().toISOString());
    const portAvailable = await ensurePortIsFree(PORT_NUMBER);
    if (!portAvailable) {
      throw new Error(`Failed to free up port ${PORT_NUMBER} after multiple attempts`);
    }

    // Fail fast in production when core secrets are missing.
    assertRequiredEnv(isProduction);

    const app = express();
    const httpServer = createServer(app);
    const lifecycle = createServerLifecycle({
      forceShutdown: () => {
        logger.error('[Shutdown] Graceful shutdown timed out; forcing process exit');
        process.exit(1);
      },
    });

    // CORS: exact allowlist in production (Capacitor/Ionic origins + known
    // web domains + ALLOWED_ORIGINS env); dev additionally allows localhost
    // and Replit preview origins. See server/lib/http-security.ts.
    app.use(cors({
      origin: (origin, callback) => {
        if (isOriginAllowed(origin, isProduction)) {
          return callback(null, true);
        }
        logger.debug(`[CORS] Blocked request from origin: ${origin}`);
        callback(null, false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Platform', 'X-Capacitor-Platform', 'X-Operation-ID'],
      exposedHeaders: ['X-Request-ID']
    }));

    // Baseline security headers (frame/HSTS protection only in production so
    // the Replit dev preview iframe keeps working).
    app.use(securityHeaders(isProduction));
    logger.info('[%s] CORS + security header middleware enabled', new Date().toISOString());

    // Add request ID middleware for structured logging
    app.use((req, res, next) => {
      req.requestId = uuidv4();
      res.setHeader('X-Request-ID', req.requestId);
      const completeRequest = beginHttpRequest();
      res.once('finish', () => {
        recordHttpResponse(res.statusCode);
        completeRequest();
      });
      res.once('close', completeRequest);
      logger.debug(`[${new Date().toISOString()}] [ReqID: ${req.requestId}] ${req.method} ${req.path}`);
      next();
    });

    // Enable gzip compression for all responses
    app.use(compression({
      filter: (req, res) => {
        // Compress all JSON responses and text-based responses
        if (req.headers['x-no-compression']) {
          return false;
        }
        return compression.filter(req, res);
      },
      level: 6, // Balance between speed and compression ratio (default is 6)
      threshold: 1024 // Only compress responses larger than 1KB
    }));
    logger.info('[%s] Compression middleware enabled', new Date().toISOString());

    logger.info('[%s] Initializing storage...', new Date().toISOString());
    await storage.initialize();

    // Initialize background job queue for match generation
    logger.info('[%s] Initializing background job queue...', new Date().toISOString());
    const { backgroundJobQueue } = await import('./services/background-job-queue');
    await backgroundJobQueue.start();
    logger.info('[%s] Background job queue started', new Date().toISOString());

    // Initialize callback queue processor for handling pending notifications
    logger.info('[%s] Initializing callback queue processor...', new Date().toISOString());
    const { callbackQueueProcessor } = await import('./services/callback-queue-processor');
    callbackQueueProcessor.start();
    logger.info('[%s] Callback queue processor started (polling every 5s)', new Date().toISOString());

    // Push fallback delivery is durable work and must have an owner in the
    // main app as well as the optional Worker VM. Atomic claims make this
    // safe when both runtimes are enabled.
    const { processQueuedPushNotifications } = await import('./services/push-notifications');
    const runPushQueue = async (): Promise<void> => {
      try {
        await processQueuedPushNotifications();
      } catch (error) {
        logger.error('[Push Queue] Scheduled processing failed', {
          errorClass: error instanceof Error ? error.name : 'UnknownError',
        });
      }
    };
    void runPushQueue();
    const pushQueueInterval = setInterval(runPushQueue, 30_000);
    pushQueueInterval.unref?.();
    logger.info('[%s] Push queue processor started (polling every 30s)', new Date().toISOString());

    // Lease recovery is periodic, not startup-only. A process can die after
    // claiming work and before writing its terminal state.
    const runQueueRecovery = async (): Promise<void> => {
      try {
        const dispatched = await storage.dispatchPendingDeliveryObligations(100);
        const recovered = await storage.recoverStaleQueueWork(
          new Date(Date.now() - 5 * 60_000).toISOString(),
        );
        if (dispatched > 0 || recovered.jobs + recovered.callbacks + recovered.pushes > 0) {
          logger.info('[Queue Recovery] Reconciled delivery work', { dispatched, ...recovered });
        }
      } catch (error) {
        logger.error('[Queue Recovery] Scheduled recovery failed', {
          errorClass: error instanceof Error ? error.name : 'UnknownError',
        });
      }
    };
    const queueRecoveryInterval = setInterval(runQueueRecovery, 60_000);
    queueRecoveryInterval.unref?.();
    void runQueueRecovery();

    // Start stale token cleanup job (runs every 24 hours, deletes tokens older than 90 days)
    const STALE_TOKEN_DAYS = 90;
    const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
    
    // Run cleanup immediately on startup, then every 24 hours
    const runTokenCleanup = async () => {
      try {
        logger.debug(`[%s] Running stale token cleanup (${STALE_TOKEN_DAYS} days)...`, new Date().toISOString());
        const deletedCount = await storage.deleteStaleTokens(STALE_TOKEN_DAYS);
        logger.info(`[%s] Stale token cleanup complete: ${deletedCount} token(s) removed`, new Date().toISOString());
      } catch (error) {
        logger.error('[Token Cleanup] Error in periodic cleanup:', error);
      }
    };
    
    runTokenCleanup(); // Run immediately on startup
    const staleTokenCleanupInterval = setInterval(runTokenCleanup, CLEANUP_INTERVAL_MS); // Then every 24 hours
    logger.info('[%s] Stale token cleanup job started (runs every 24h)', new Date().toISOString());

    // Reset stale active match generation jobs to 'PENDING' on startup
    // (crash recovery). The queue marks active jobs as 'PROCESSING';
    // 'IN_PROGRESS' is included for legacy rows written by older builds.
    // Terminal statuses (COMPLETED/FAILED/CANCELLED) are never touched.
    try {
      const staleThreshold = new Date(Date.now() - 60000).toISOString(); // 1 minute ago
      const recovered = await storage.recoverStaleQueueWork(staleThreshold);
      if (recovered.jobs + recovered.callbacks + recovered.pushes > 0) {
        logger.info(`[Job Recovery] Reset ${recovered.jobs} job(s), ${recovered.callbacks} callback(s), and ${recovered.pushes} push notification(s)`);
      }
    } catch (error) {
      logger.error('[Job Recovery] Error resetting stale processing records:', error);
    }

    logger.info('[%s] Setting up auth...', new Date().toISOString());
    await setupAuth(app);

    // CI-only authenticated browser fixture. It is enabled only for the
    // synthetic smoke build and is deliberately registered before production
    // API routes. No real Firebase, database user, email, upload, or message
    // service is touched by this path.
    if (serverEnv.smokeTestEnabled) {
      const smokeCookieName = isProduction ? '__Host-smoke-auth' : 'smoke-auth';
      const smokeUser = {
        id: 900001,
        email: 'ci-smoke-user@example.invalid',
        fullName: 'CI Smoke User',
        birthday: '1990-01-01',
        title: 'Synthetic Tester',
        currentLocation: 'New York',
        currentLocationLat: null,
        currentLocationLng: null,
        desiredLocations: [],
        desiredLocationCoords: [],
        industry: 'Technology',
        currentCompany: 'Synthetic Co',
        desiredCompanies: [],
        matchingRadius: 25,
        yearsOfExperience: 5,
        bio: 'Synthetic browser smoke identity',
        photo: '/placeholder.jpg',
        resumeUrl: null,
        resumePreviewUrls: [],
        interests: [],
        professionalInterests: [],
        languages: ['English'],
        profileVisible: true,
        emailNotifications: false,
        readReceipts: true,
        emailVerificationStarted: true,
        emailVerified: true,
        registrationCompleted: true,
        hasMinimumMatchData: true,
        profileVersion: 1,
        currentSnapshotId: null,
        initialMatchJobsQueued: false,
        initialMatchJobsQueuedAt: null,
        firebaseUid: 'ci-smoke-firebase-uid',
      };

      app.get('/__smoke/session', (_req, res) => {
        // This is deliberately a separate fixture cookie rather than a
        // production session. It makes the smoke test independent of the
        // external PostgreSQL session store and is enabled only in CI.
        res.cookie(smokeCookieName, '1', {
          httpOnly: true,
          sameSite: 'lax',
          secure: isProduction,
          path: '/',
          maxAge: 5 * 60 * 1000,
        });
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).type('text/plain').send('Synthetic smoke session ready');
      });
      app.get('/api/user', (req, res) => {
        if (!req.headers.cookie?.split(';').some((cookie) => cookie.trim() === `${smokeCookieName}=1`)) {
          return res.sendStatus(401);
        }
        res.json(smokeUser);
      });
      app.get('/api/notifications/counts', (_req, res) => {
        res.json({ messages: 0, connectionRequests: 0, newConnections: 0 });
      });
    }

    logger.info('[%s] Registering routes...', new Date().toISOString());
    await registerRoutes(app);

    // Ensure the uploads directory exists. Serving is handled by the
    // authenticated /uploads route registered in registerRoutes() — do NOT
    // add an unauthenticated express.static mount here (uploads are user PII).
    const uploadsDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
      logger.debug('[%s] Created uploads directory', new Date().toISOString());
    }

    // Set up WebSocket server
    logger.info('[%s] Setting up WebSocket server...', new Date().toISOString());
    const cleanupWebSocketServer = setupWebSocketServer(httpServer);
    logger.info('[%s] WebSocket server initialized', new Date().toISOString());

    logger.debug('[%s] Setting up Vite or static files...', new Date().toISOString());
    if (process.env.NODE_ENV === "production") {
      // Serve static files in production
      serveStaticFiles(app);
    } else {
      // Use Vite dev server in development
      const { setupVite } = await import('./vite');
      await setupVite(app, httpServer);
    }

    // Keep parser failures bounded and free of stack/details at the HTTP
    // boundary. Route handlers may still provide their own validation errors.
    app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large') {
        res.status(413).json({ error: 'Request body too large' });
        return;
      }
      if (error instanceof SyntaxError && 'body' in error) {
        res.status(400).json({ error: 'Malformed request body' });
        return;
      }
      next(error);
    });

    // Add error handler for the HTTP server
    httpServer.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        logger.error('[%s] Port 5000 is already in use. Please free up the port and try again.', new Date().toISOString());
      } else {
        logger.error('[%s] Server error:', new Date().toISOString(), error);
      }
      process.exit(1);
    });

    // Add health check endpoint for API checks only
    app.get('/api/health', (req, res) => {
      res.status(200).send('OK');
    });

    app.get('/api/ready', async (_req, res) => {
      if (!lifecycle.isReady()) {
        return res.status(503).json({
          status: 'not_ready',
          reason: lifecycle.getState() === 'draining' ? 'draining' : 'starting',
        });
      }

      const readiness = await checkDatabaseReadiness({
        query: (text, values) => queryDatabase(pool, text, values),
      }, requiredSchemaTablesForMode());
      if (!readiness.ready) {
        return res.status(503).json({
          status: 'not_ready',
          reason: readiness.reason,
          missingTables: readiness.reason === 'schema-incomplete' ? readiness.missingTables : undefined,
        });
      }
      try {
        const [push, callbacks] = await Promise.all([
          storage.getQueuedNotificationStats(),
          storage.getCallbackNotificationStats(),
        ]);
        return res.status(200).json({
          status: 'ready',
          queues: {
            push: { pending: push.pending, processing: push.processing, failed: push.failed },
            callbacks: { pending: callbacks.pending, processing: callbacks.processing, failed: callbacks.failed },
          },
        });
      } catch (error) {
        logger.error('[Readiness] Queue health check failed', {
          errorClass: error instanceof Error ? error.name : 'UnknownError',
        });
        return res.status(503).json({ status: 'not_ready', reason: 'queue-unavailable' });
      }
    });

    const closeHttpServer = (): Promise<void> => new Promise((resolve, reject) => {
      httpServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    let httpClosePromise: Promise<void> | undefined;
    const stopAcceptingHttp = (): void => {
      // httpServer.close() stops new connections synchronously, while its
      // promise resolves only after existing HTTP/WebSocket connections drain.
      httpClosePromise ??= closeHttpServer();
    };
    const awaitHttpDrain = (): Promise<void> => httpClosePromise ?? Promise.resolve();

    let signalHandled = false;
    const handleShutdownSignal = (signal: NodeJS.Signals) => {
      if (signalHandled) {
        logger.info('[Shutdown] %s received while shutdown is already in progress', signal);
        return;
      }

      signalHandled = true;
      logger.info('[Shutdown] Received %s; beginning graceful shutdown', signal);
      void lifecycle.beginShutdown([
        stopAcceptingHttp,
        () => cleanupWebSocketServer(),
        awaitHttpDrain,
        () => backgroundJobQueue.stop(),
        () => callbackQueueProcessor.stop(),
         () => clearInterval(pushQueueInterval),
         () => clearInterval(queueRecoveryInterval),
        () => clearInterval(staleTokenCleanupInterval),
        () => pool.end(),
      ]).then(() => {
        logger.info('[Shutdown] Graceful shutdown complete');
        process.exit(0);
      }).catch((error) => {
        logger.error('[Shutdown] Graceful shutdown completed with errors:', error);
        process.exit(1);
      });
    };
    process.on('SIGTERM', handleShutdownSignal);
    process.on('SIGINT', handleShutdownSignal);

    // Start listening
    logger.info('[%s] Starting server on port %d...', new Date().toISOString(), PORT_NUMBER);
    httpServer.listen(PORT_NUMBER, '0.0.0.0', () => {
      logger.info('[%s] Server is running on port %d', new Date().toISOString(), PORT_NUMBER);
      lifecycle.markReady();
      
      // For Replit environment, also create a proxy on port 5000 if we're using port 3001
      if (isReplitEnv && PORT_NUMBER === 3001) {
        logger.debug('[%s] Setting up Replit proxy on port 5000...', new Date().toISOString());
        const proxy = express();
        
        // Simple proxy using fetch
        proxy.use('*', async (req, res) => {
          try {
            const targetUrl = `http://localhost:${PORT_NUMBER}${req.originalUrl}`;
            logger.debug(`[${new Date().toISOString()}] Proxying ${req.method} ${req.originalUrl} -> ${targetUrl}`);
            
            // Forward the request using fetch
            const fetchOptions: RequestInit = {
              method: req.method,
              headers: new Headers(
                Object.entries(req.headers).flatMap(([name, value]) =>
                  value === undefined
                    ? []
                    : [[name, Array.isArray(value) ? value.join(', ') : value] as [string, string]],
                ),
              ),
            };
            
            // Include body for non-GET requests
            if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
              fetchOptions.body = JSON.stringify(req.body);
            }
            
            const response = await fetch(targetUrl, fetchOptions);
            
            // Copy status and headers
            res.status(response.status);
            copyProxyResponseHeaders(response.headers, res);
            
            // Fetch transparently decodes compressed upstream responses. Buffer
            // the decoded bytes and let Express calculate fresh framing headers;
            // forwarding upstream Content-Length/Content-Encoding after this
            // conversion creates invalid preview responses.
            const body = Buffer.from(await response.arrayBuffer());
            res.send(body);
            
          } catch (err) {
            logger.error(`[${new Date().toISOString()}] Proxy error:`, err);
            res.status(502).send('Proxy Error');
          }
        });
        
        proxy.listen(5000, '0.0.0.0', () => {
          logger.info('[%s] Replit proxy server running on port 5000', new Date().toISOString());
        });
      }
    });

    // Note: Health check server removed since main app now runs on port 5000

  } catch (error) {
    logger.error('[%s] Fatal error during startup:', new Date().toISOString(), error);
    process.exit(1);
  }
}

main().catch(error => {
  logger.error('[%s] Fatal error during startup:', new Date().toISOString(), error);
  process.exit(1);
});