import passport from "passport";
import { Express, json, urlencoded } from "express";
import session from "express-session";
import { randomBytes } from "crypto";
import { storage } from "./storage";
import { User as SelectUser } from "@shared/schema";

declare module 'express-serve-static-core' {
  interface User extends SelectUser {
    id: SelectUser["id"];
  }
}

import { logger } from './lib/logger';
import { Request, Response, NextFunction } from 'express';
import { registerLimiter } from './lib/rate-limits';
import { legacyFirebaseTokenAuthorization, requireVerifiedFirebaseUser } from './lib/register-auth';
import { registerFirebaseUser } from './routes/register';

// Export session middleware for WebSocket authentication
export let sessionMiddleware: ReturnType<typeof session>;
const configuredApps = new WeakSet<Express>();

// Session-only authentication middleware (legacy)
// NOTE: This middleware only supports session-based authentication.
// For dual-mode authentication (JWT + session), use requireAuthJWT instead.
// This is kept for backward compatibility and routes that explicitly need session-only auth.
// Eventually, most routes should migrate to requireAuthJWT.
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated() && req.user) {
    return next();
  }
  res.status(401).json({ message: 'Authentication required' });
}

// Export dual-mode authentication middleware (JWT + session)
// This middleware supports both JWT (Authorization Bearer header) and session-based authentication
// Use this for routes that need to support both mobile apps (JWT) and web browsers (session)
export { requireAuthJWT } from './middleware/auth-jwt';

export function setupAuth(app: Express) {
  // Route registration is not idempotent in Express. Defending here prevents
  // duplicate session/passport middleware and duplicate auth endpoints if a
  // bootstrap path calls setupAuth twice.
  if (configuredApps.has(app)) {
    logger.warn('[Auth] setupAuth called more than once; ignoring duplicate setup');
    return;
  }
  // Generate a secure session secret if not provided
  const sessionSecret = process.env.SESSION_SECRET || randomBytes(32).toString('hex');
  if (!process.env.SESSION_SECRET) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SESSION_SECRET environment variable must be set in production');
    }
    process.env.SESSION_SECRET = sessionSecret;
  }

  // Session cookie configuration optimized for both web and Capacitor native apps
  // Production (HTTPS): secure=true, sameSite=none (required for Capacitor iOS cross-origin)
  // Local dev (HTTP): secure=false, sameSite=lax (browsers reject secure cookies over HTTP)
  const isProduction = process.env.NODE_ENV === "production";
  
  const sessionSettings: session.SessionOptions = {
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: storage.sessionStore,
    cookie: {
      secure: isProduction, // true in production (HTTPS), false in local dev (HTTP)
      sameSite: isProduction ? "none" : "lax", // 'none' for Capacitor in production, 'lax' for local web dev
      maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year (effectively disabling automatic logout)
    },
  };

  // Create and export session middleware for WebSocket authentication
  sessionMiddleware = session(sessionSettings);

  // Configure Express middleware
  //
  // Trust only Replit's proxy infrastructure (loopback + link-local + private
  // ranges) instead of `trust proxy: true`. Express walks X-Forwarded-For from
  // the right and stops at the first non-trusted (public) address, so req.ip
  // resolves to the real client IP as recorded by Replit's edge proxy.
  // A client-supplied X-Forwarded-For cannot influence req.ip: spoofed entries
  // sit to the LEFT of the client's real public IP and are never reached
  // (Replit's proxy also strips client-sent XFF entirely — verified
  // empirically; observed chain: "<client-ip>, 10.x.x.x, 127.0.0.1").
  // This keeps per-IP rate limits unspoofable while X-Forwarded-Proto from the
  // trusted hops still marks requests secure, so secure session cookies work.
  // TRUST_PROXY_HOPS (numeric) overrides with a fixed hop count if the
  // platform topology ever changes.
  const trustProxyHops = Number.parseInt(process.env.TRUST_PROXY_HOPS ?? "", 10);
  app.set(
    "trust proxy",
    Number.isInteger(trustProxyHops) && trustProxyHops >= 0
      ? trustProxyHops
      : ["loopback", "linklocal", "uniquelocal"]
  );

  // Post-deploy verification aid: log the proxy chain for the first few
  // production requests so the resolved client IP can be confirmed from
  // deployment logs (and TRUST_PROXY_HOPS adjusted if ever needed).
  if (isProduction) {
    let trustProxySamples = 0;
    app.use((req, _res, next) => {
      if (trustProxySamples < 5) {
        trustProxySamples++;
        logger.info(
          `[TrustProxy] sample ${trustProxySamples}/5: xff="${req.headers["x-forwarded-for"] ?? ""}" socket=${req.socket.remoteAddress} resolved req.ip=${req.ip}`
        );
      }
      next();
    });
  }
  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ extended: true, limit: '10mb' }));
  app.use(sessionMiddleware);
  app.use(passport.initialize());
  app.use(passport.session());

  // LocalStrategy removed - Firebase handles all authentication

  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: number, done) => {
    try {
      const user = await storage.getUser(id);
      if (!user) {
        return done(null, false);
      }
      done(null, user);
    } catch (error) {
      done(error);
    }
  });

  // Authentication routes
  // REMOVED: Conflicting /api/register route to prevent conflicts with registerRouter
  // All registration functionality is now handled by server/routes/register.ts
  // which includes both /api/register and /api/register/partial endpoints

  // REMOVED: /api/login endpoint - Firebase handles all authentication
  // The local strategy was removed during Firebase migration (Oct 21, 2025)
  // All login functionality now uses Firebase Authentication via /api/firebase-auth

  app.post("/api/logout", (req, res, next) => {
    req.logout((err) => {
      if (err) {
        return next(err);
      }
      
      // SECURITY: Fully destroy the session to clear all session data
      req.session.destroy((destroyErr) => {
        if (destroyErr) {
          console.error("[Logout] Session destroy error:", destroyErr);
          return next(destroyErr);
        }
        
        // SECURITY: Clear the session cookie from the client
        res.clearCookie('connect.sid', { path: '/' });
        res.sendStatus(200);
      });
    });
  });

  // REMOVED: Basic /api/user route to prevent conflict with detailed user routes
  // The detailed /api/user route is handled by server/routes/user.ts
  // which includes comprehensive debugging and error handling
  
  // REMOVED: Old conflicting firebase-auth endpoint that had needsRegistration logic
  // Now using server/routes/firebase-auth.ts for clean binary system
  
  // Compatibility adapter for pre-/api/register clients. It shares the modern
  // registration implementation and limiter, while accepting their historical
  // body token. The adapter deliberately overwrites Authorization so identity
  // (UID, email and emailVerified) remains token-derived.
  app.post("/api/firebase-register", registerLimiter, (req, res, next) => {
    const authorization = legacyFirebaseTokenAuthorization(req.body?.token);
    if (!authorization) {
      return res.status(400).json({ message: "Firebase token is required" });
    }
    req.headers.authorization = authorization;
    // Keep legacy cookie/session behavior, but defer it until the shared
    // registration handler has produced the token-derived user.
    (res as Response & { registrationSuccessResponder?: (user: SelectUser, status: 200 | 201) => void }).registrationSuccessResponder = (user, status) => {
      req.session.regenerate((regenerateErr) => {
        if (regenerateErr) {
          logger.error('[Firebase register] Session regeneration failed:', regenerateErr);
          return res.status(500).json({ error: 'Session regeneration failed' });
        }
        req.login(user, (loginErr) => {
          if (loginErr) return next(loginErr);
          req.session.save((saveErr) => {
            if (saveErr) {
              logger.error('[Firebase register] Session save failed:', saveErr);
              return res.status(500).json({ error: 'Session save failed' });
            }
            return status === 201 ? res.status(201).json(user) : res.json(user);
          });
        });
      });
    };
    return requireVerifiedFirebaseUser(req, res, next);
  }, registerFirebaseUser);

  configuredApps.add(app);
}