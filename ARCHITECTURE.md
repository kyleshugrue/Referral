# Architecture

Referral is a monolithic full-stack TypeScript application with a separate Worker VM for AI processing.

```
┌─────────────┐   HTTPS/WSS   ┌──────────────────────┐   NOTIFY/LISTEN   ┌────────────┐
│  Web / iOS  │ ────────────► │  Main App (Express)  │ ◄───────────────► │ Worker VM  │
│   clients   │               │  + Vite frontend     │    PostgreSQL     │ (Claude AI,│
└─────────────┘               └──────────┬───────────┘                   │  APNs push)│
                                         │                               └─────┬──────┘
                                         ▼                                     │
                                   PostgreSQL (Neon) ◄─────────────────────────┘
```

## Frontend (`client/`)

- React 18 + TypeScript, built with Vite
- **Routing:** Wouter (`client/src/App.tsx` registers pages from `client/src/pages/`)
- **Data fetching:** TanStack Query v5 with a default fetcher (`client/src/lib/queryClient.ts`); mutations invalidate query keys
- **UI:** TailwindCSS + shadcn/ui components (`client/src/components/ui/`)
- **iOS specifics:** Capacitor plugins for Keychain token storage, keyboard handling (`useIOSKeyboardPro`), haptics, push notifications, and deep links. Platform detection keeps web and native auth paths separate.

## Backend API (`server/`)

- Express app (`server/index.ts`) serving both the API and the Vite dev server / built frontend on port 5000
- Routes live in `server/routes.ts` plus feature routers (`server/routes/`)
- All data access goes through the storage layer (`server/storage.ts`, Drizzle ORM)
- Shared types and Zod schemas live in `shared/schema.ts` — the single source of truth for both frontend and backend
- Cross-cutting middleware: CORS allowlist + security headers (`server/lib/http-security.ts`), rate limiting (`server/lib/rate-limits.ts`), dual-mode auth (`server/middleware/auth-jwt.ts`)
- Security integration tests use the test-only in-process app factory in `server/test-support/p0-http-harness.ts`; it injects synthetic identity, sessions, storage, and Firebase verification without starting workers or opening production services.

## Auth: Sessions, JWT, and Firebase

Identity is anchored in **Firebase Authentication**; the backend verifies Firebase ID tokens with the Firebase Admin SDK, then issues its own credentials:

- **Web:** Passport session with a persistent cookie (rolling refresh). Session state in PostgreSQL.
- **iOS native:** short-lived JWT access token + long-lived refresh token. Refresh tokens are stored **hashed** in the database; the client keeps tokens in the iOS Keychain. A synchronous refresh lock on the client prevents concurrent-refresh races.
- `requireAuthJWT` middleware accepts either a `Bearer` JWT or an authenticated session, and tags the request with the auth method used.

## Database

PostgreSQL (Neon) accessed via Drizzle ORM. Schema is defined in `shared/schema.ts` and pushed with `drizzle-kit push`. Key tables: users/profiles, matches, messages, connections, `background_job_queue`, `callback_notification_queue`, refresh tokens, dead-letter queue for failed jobs.

## Upload Flow

1. Client uploads resume (PDF) or profile photo via multipart form
2. Rate limiter caps uploads per IP
3. `server/lib/upload-validation.ts` validates size, extension, MIME type, and **magic bytes** (content sniffing)
4. Server generates a safe random filename (never derived from user input)
5. Resumes go to S3; photos go to local `uploads/`
6. PDF preview generation uses `execFile` with argument arrays (no shell interpolation)

## Matching Flow

1. User edits profile; only changes to match-relevant fields (`currentCompany`, `currentLocation`, `industry`, `desiredCompanies`, `desiredLocations`) trigger regeneration
2. Main app enqueues a job in `background_job_queue` (`PENDING`) and emits PostgreSQL `NOTIFY`
3. Worker VM claims the job (`PROCESSING`), generates matches and AI descriptions via Claude
4. Results are persisted; completion flows back through multiple redundant paths

## Background Job Queue

- Job statuses are a shared contract (`JOB_STATUSES` in `shared/schema.ts`): `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`, `RETRYING`, `CANCELLED`
- On startup the main app recovers stale in-flight jobs (`PROCESSING`, plus legacy `IN_PROGRESS` rows) back to `PENDING`
- Permanently failed jobs land in a dead-letter table with admin retry endpoints
- Note: `callback_notification_queue` uses a separate lowercase `pending` status — an independent contract with the Worker VM, intentionally not unified

## Main App ↔ Worker VM Relationship

- Communication is event-driven through PostgreSQL `NOTIFY/LISTEN` — no direct network dependency for job dispatch
- The Worker VM calls back into the main app on `/internal/*` endpoints, authenticated with a timing-safe shared-secret check (`INTERNAL_API_SECRET`, see `server/lib/internal-auth.ts`)
- The Anthropic API key exists **only** on the Worker VM; the main app cannot call Claude

## Callback / Fallback Flow (match delivery)

Matches are delivered through four redundant paths so users never wait on a dead spinner:
1. PostgreSQL `NOTIFY` → main app → WebSocket broadcast
2. Callback notification queue polled every ~10 seconds
3. WebSocket reconnect recovery (client re-syncs on reconnect)
4. Client-side polling as the final fallback

The UI renders cached matches immediately while fresh ones generate.

## Real-Time Notifications

A WebSocket server (`ws`) attached to the Express HTTP server handles chat messages, match-ready notifications, and connection events. iOS push notifications are sent by the Worker VM through APNs.

Direct conversations are the only supported chat contract. Conversation and message authorization requires an accepted connection, group-chat routes return `410 Gone`, and WebSocket admission uses the same authenticated identity/privacy rules.
