import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import session, { type SessionData } from "express-session";
import { setupAuth } from "../auth";
import { registerRoutes } from "../routes";

export interface HarnessUser {
  id: number;
  email: string;
  fullName: string;
  birthday: string;
  title: string;
  currentLocation: string;
  currentLocationLat: string | null;
  currentLocationLng: string | null;
  desiredLocations: string[];
  desiredLocationCoords: string[];
  industry: string;
  currentCompany: string;
  desiredCompanies: string[];
  matchingRadius: number;
  yearsOfExperience: number;
  bio: string;
  photo: string;
  resumeUrl: string | null;
  resumePreviewUrls: string[];
  interests: string[];
  professionalInterests: string[];
  languages: string[];
  profileVisible: boolean;
  emailNotifications: boolean;
  readReceipts: boolean;
  emailVerificationStarted: boolean;
  emailVerified: boolean;
  registrationCompleted: boolean;
  hasMinimumMatchData: boolean;
  profileVersion: number;
  currentSnapshotId: number | null;
  initialMatchJobsQueued: boolean;
  initialMatchJobsQueuedAt: string | null;
  firebaseUid: string | null;
}

export interface HarnessState {
  users: Map<number, HarnessUser>;
  usersByFirebaseUid: Map<string, HarnessUser>;
  usersByEmail: Map<string, HarnessUser>;
  accessTokens: Map<string, number>;
  connectionRequests: Map<number, {
    id: number;
    senderId: number;
    receiverId: number;
    status: string;
  }>;
  updateCalls: Array<{ userId: number; data: Record<string, unknown> }>;
  acceptCalls: number[];
  refreshTokens: Array<Record<string, unknown>>;
  nextUserId: number;
  nextConnectionRequestId: number;
}

function createSessionStore() {
  const sessions = new Map<string, unknown>();
  type StoreGetCallback = Parameters<session.Store["get"]>[1];
  class MemorySessionStore extends session.Store {
    override get(sid: string, callback: StoreGetCallback) {
      callback(null, sessions.get(sid) as SessionData | undefined);
    }
    override set(sid: string, value: SessionData, callback: (error?: Error | null) => void) {
      sessions.set(sid, value);
      callback(null);
    }
    override destroy(sid: string, callback: (error?: Error | null) => void) {
      sessions.delete(sid);
      callback(null);
    }
    override touch(sid: string, value: SessionData, callback: (error?: Error | null) => void) {
      sessions.set(sid, value);
      callback(null);
    }
  }
  return new MemorySessionStore();
}

function makeStorage(state: HarnessState) {
  const base: Record<string, unknown> = {
    sessionStore: createSessionStore(),
    getUser: async (id: number) => state.users.get(id),
    getUserById: async (id: number) => state.users.get(id),
    getUsersByFirebaseUid: async (uid: string) => {
      const user = state.usersByFirebaseUid.get(uid);
      return user ? [user] : [];
    },
    getUserByEmail: async (email: string) => state.usersByEmail.get(email) ?? null,
    resolveUserForFirebaseIdentity: async (uid: string, email: string | null) => {
      const byUid = state.usersByFirebaseUid.get(uid);
      if (byUid) return byUid;
      return email ? state.usersByEmail.get(email) : undefined;
    },
    createUser: async (data: Partial<HarnessUser>) => {
      const user = makeUser({
        ...data,
        id: state.nextUserId++,
      });
      state.users.set(user.id, user);
      if (user.firebaseUid) state.usersByFirebaseUid.set(user.firebaseUid, user);
      state.usersByEmail.set(user.email, user);
      return user;
    },
    updateUser: async (userId: number, data: Record<string, unknown>) => {
      const existing = state.users.get(userId);
      if (!existing) return undefined;
      state.updateCalls.push({ userId, data: { ...data } });
      Object.assign(existing, data);
      if (existing.firebaseUid) state.usersByFirebaseUid.set(existing.firebaseUid, existing);
      state.usersByEmail.set(existing.email, existing);
      return existing;
    },
    createRefreshToken: async (data: Record<string, unknown>) => {
      state.refreshTokens.push(data);
      return data;
    },
    getOutgoingRequests: async (senderId: number) =>
      [...state.connectionRequests.values()].filter(
        (request) => request.senderId === senderId && request.status === "requested",
      ),
    getConnectionBetweenUsers: async (userId: number, otherUserId: number) => {
      const connection = [...state.connectionRequests.values()].find(
        (request) =>
          request.status === "accepted" &&
          ((request.senderId === userId && request.receiverId === otherUserId) ||
            (request.senderId === otherUserId && request.receiverId === userId)),
      );
      return connection
        ? {
            id: connection.id,
            user1Id: connection.senderId,
            user2Id: connection.receiverId,
            createdAt: "2030-01-01T00:00:00.000Z",
          }
        : undefined;
    },
    createConnectionRequest: async (senderId: number, receiverId: number) => {
      const request = {
        id: state.nextConnectionRequestId++,
        senderId,
        receiverId,
        status: "requested",
      };
      state.connectionRequests.set(request.id, request);
      return request;
    },
    getNotificationsForRelatedId: async () => [],
    markNotificationAsRead: async () => undefined,
    getConnectionRequestById: async (id: number) => state.connectionRequests.get(id),
    acceptConnectionRequest: async (id: number) => {
      const request = state.connectionRequests.get(id);
      if (!request || request.status !== "requested") return undefined;
      state.acceptCalls.push(id);
      request.status = "accepted";
      return {
        id,
        user1Id: request.senderId,
        user2Id: request.receiverId,
      };
    },
    rejectConnectionRequest: async (id: number) => {
      const request = state.connectionRequests.get(id);
      if (!request || request.status !== "requested") return false;
      request.status = "rejected";
      return true;
    },
  };

  // Route modules contain many unrelated endpoints. Returning harmless,
  // deterministic values for an uncalled storage method keeps this harness
  // focused on the P0 routes without touching the real database.
  return new Proxy(base, {
    get(target, property: string | symbol) {
      if (typeof property === "string" && property in target) return target[property];
      const fallback = async () => [];
      if (typeof property === "string") target[property] = fallback;
      return fallback;
    },
  });
}

export function makeUser(overrides: Partial<HarnessUser> = {}): HarnessUser {
  return {
    id: 1,
    email: "owner@example.invalid",
    fullName: "Owner",
    birthday: "1990-01-01",
    title: "Engineer",
    currentLocation: "New York",
    currentLocationLat: "40.7",
    currentLocationLng: "-74.0",
    desiredLocations: ["New York"],
    desiredLocationCoords: ['{"lat":"40.7","lng":"-74.0"}'],
    industry: "Technology",
    currentCompany: "Example Co",
    desiredCompanies: ["Example Co"],
    matchingRadius: 25,
    yearsOfExperience: 5,
    bio: "A synthetic test user",
    photo: "/placeholder.jpg",
    resumeUrl: null,
    resumePreviewUrls: [],
    interests: ["testing"],
    professionalInterests: ["security"],
    languages: ["English"],
    profileVisible: true,
    emailNotifications: true,
    readReceipts: true,
    emailVerificationStarted: true,
    emailVerified: true,
    registrationCompleted: true,
    hasMinimumMatchData: true,
    profileVersion: 1,
    currentSnapshotId: null,
    initialMatchJobsQueued: true,
    initialMatchJobsQueuedAt: null,
    firebaseUid: null,
    ...overrides,
  };
}

export async function createP0HttpHarness(
  identityUsers: HarnessUser[],
  options: { onStorage?: (storage: unknown) => void } = {},
): Promise<{
  app: Express;
  state: HarnessState;
  port: number;
  close: () => Promise<void>;
}> {
  const state: HarnessState = {
    users: new Map(identityUsers.map((user) => [user.id, user])),
    usersByFirebaseUid: new Map(
      identityUsers
        .filter((user) => user.firebaseUid)
        .map((user) => [user.firebaseUid as string, user]),
    ),
    usersByEmail: new Map(identityUsers.map((user) => [user.email, user])),
    accessTokens: new Map(),
    connectionRequests: new Map(),
    updateCalls: [],
    acceptCalls: [],
    refreshTokens: [],
    nextUserId: Math.max(0, ...identityUsers.map((user) => user.id)) + 1,
    nextConnectionRequestId: 1000,
  };

  const storage = makeStorage(state);
  const app = express();

  // Test-only dependency injection points are installed by the Vitest module
  // mocks before this function imports the real route registry.
  app.locals.p0State = state;
  app.locals.p0Storage = storage;
  options.onStorage?.(storage);

  setupAuth(app);

  // A tiny session-login endpoint gives cookie-authenticated tests a real
  // Passport session without adding a production login path or a real account.
  app.get("/__p0/session/:userId", (req, res, next) => {
    const user = state.users.get(Number(req.params.userId));
    if (!user) return res.sendStatus(404);
    req.login(user, (error) => {
      if (error) return next(error);
      res.sendStatus(204);
    });
  });

  await registerRoutes(app);

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    app,
    state,
    port,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

/**
 * In-process application factory for security integration tests.
 *
 * The factory provides synthetic identities, a session store, bearer-token
 * verification, and storage injection without starting workers, Vite, a
 * production listener, or a real database. Keep this seam test-only: it is
 * intentionally backed by the Vitest module mocks in the suites that use it.
 */
export const createInProcessHttpApp = createP0HttpHarness;

export function tokenFor(state: HarnessState, userId: number): string {
  const token = `synthetic-access-${userId}`;
  state.accessTokens.set(token, userId);
  return token;
}

export async function requestJson(
  port: number,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown; headers: Headers }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  const body = !text
    ? null
    : (() => {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    })();
  return { status: response.status, body, headers: response.headers };
}