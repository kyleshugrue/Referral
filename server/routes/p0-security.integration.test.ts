import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createP0HttpHarness,
  makeUser,
  requestJson,
  tokenFor,
  type HarnessState,
} from "../test-support/p0-http-harness";

const mocks = vi.hoisted(() => {
  const firebaseAuth = {
    verifyIdToken: vi.fn(),
  };

  return {
    firebaseAuth,
    accessTokens: new Map<string, number>(),
    storage: undefined as unknown,
  };
});

vi.mock("../storage", () => ({
  get storage() {
    return mocks.storage;
  },
}));

vi.mock("../lib/firebase-admin", () => ({
  auth: mocks.firebaseAuth,
  firebaseStorage: undefined,
}));

vi.mock("../lib/jwt-service", () => ({
  verifyAccessToken: (token: string) => {
    const userId = mocks.accessTokens.get(token);
    return userId ? { userId, email: `user-${userId}@example.invalid`, type: "access" } : null;
  },
  generateAccessToken: (userId: number) => `generated-access-${userId}`,
  generateRefreshToken: () => "synthetic-refresh-token",
  hashRefreshToken: (token: string) => `hash:${token}`,
  getRefreshTokenExpiry: () => new Date("2030-01-01T00:00:00.000Z"),
  createDeviceInfo: () => JSON.stringify({ synthetic: true }),
}));

vi.mock("../websocket-utils", () => ({
  notifyConnectionAccepted: vi.fn(async () => undefined),
  notifyConnectionRequestRejected: vi.fn(async () => undefined),
  notifyConnectionRequest: vi.fn(async () => undefined),
}));

vi.mock("../lib/logger", () => {
  const noop = () => undefined;
  return {
    logger: {
      debug: noop,
      info: noop,
      warn: noop,
      error: noop,
    },
  };
});

// The route registry imports this module for unrelated profile-update paths.
// It is mocked so this suite never opens a database connection.
vi.mock("../db", () => ({
  db: new Proxy({}, {
    get: () => () => ({
      set() { return this; },
      where() { return this; },
      returning: async () => [],
    }),
  }),
  pool: {},
}));

let harness: Awaited<ReturnType<typeof createP0HttpHarness>>;
let state: HarnessState;
let port: number;

async function startHarness(users: ReturnType<typeof makeUser>[]) {
  await harness?.close();
  mocks.accessTokens.clear();
  harness = await createP0HttpHarness(users, {
    onStorage: (storage) => {
      mocks.storage = storage;
    },
  });
  state = harness.state;
  port = harness.port;
}

function authToken(userId: number): string {
  const token = tokenFor(state, userId);
  mocks.accessTokens.set(token, userId);
  return token;
}

beforeEach(() => {
  mocks.firebaseAuth.verifyIdToken.mockReset();
});

afterAll(async () => {
  await harness?.close();
});

describe("P0 HTTP security regressions", () => {
  describe("Firebase identity binding", () => {
    it("does not let body email select another account", async () => {
      const owner = makeUser({
        id: 1,
        email: "victim@example.invalid",
        firebaseUid: null,
      });
      await startHarness([owner]);
      mocks.firebaseAuth.verifyIdToken.mockResolvedValue({
        uid: "attacker-firebase-uid",
        email: "attacker@example.invalid",
        email_verified: true,
      });

      const response = await requestJson(port, "/api/firebase-auth", {
        method: "POST",
        body: JSON.stringify({
          token: "synthetic-firebase-token",
          email: owner.email,
          displayName: "Victim overwrite",
          photoURL: "https://attacker.invalid/photo.jpg",
        }),
      });

      expect(response.status).toBe(401);
      expect(owner.firebaseUid).toBeNull();
      expect(state.updateCalls).toHaveLength(0);
    });

    it("requires the verified identity in Authorization bearer auth", async () => {
      const owner = makeUser({ id: 1, firebaseUid: "owner-firebase-uid" });
      await startHarness([owner]);
      mocks.firebaseAuth.verifyIdToken.mockResolvedValue({
        uid: owner.firebaseUid,
        email: owner.email,
        email_verified: true,
      });

      const response = await requestJson(port, "/api/firebase-auth", {
        method: "POST",
        headers: { authorization: "Bearer synthetic-firebase-token" },
      });

      expect(response.status).toBe(200);
      expect((response.body as { id: number }).id).toBe(owner.id);
    });
  });

  describe("connection request ownership and races", () => {
    it("only the stored receiver can accept or reject a request", async () => {
      const sender = makeUser({ id: 1, email: "sender@example.invalid" });
      const receiver = makeUser({ id: 2, email: "receiver@example.invalid" });
      const attacker = makeUser({ id: 3, email: "attacker@example.invalid" });
      await startHarness([sender, receiver, attacker]);
      state.connectionRequests.set(77, {
        id: 77,
        senderId: sender.id,
        receiverId: receiver.id,
        status: "requested",
      });

      const response = await requestJson(port, "/api/connections/77", {
        method: "PATCH",
        headers: { authorization: `Bearer ${authToken(attacker.id)}` },
        body: JSON.stringify({ status: "accepted" }),
      });

      expect(response.status).toBe(403);
      expect(state.acceptCalls).toEqual([]);
    });

    it("does not accept the same request twice under concurrent PATCHes", async () => {
      const sender = makeUser({ id: 1, email: "sender@example.invalid" });
      const receiver = makeUser({ id: 2, email: "receiver@example.invalid" });
      await startHarness([sender, receiver]);
      state.connectionRequests.set(78, {
        id: 78,
        senderId: sender.id,
        receiverId: receiver.id,
        status: "requested",
      });
      const token = authToken(receiver.id);

      const responses = await Promise.all([
        requestJson(port, "/api/connections/78", {
          method: "PATCH",
          headers: { authorization: `Bearer ${token}` },
          body: JSON.stringify({ status: "accepted" }),
        }),
        requestJson(port, "/api/connections/78", {
          method: "PATCH",
          headers: { authorization: `Bearer ${token}` },
          body: JSON.stringify({ status: "accepted" }),
        }),
      ]);

      expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
      expect(responses.some((response) => [404, 409].includes(response.status))).toBe(true);
      expect(state.acceptCalls).toHaveLength(1);
    });
  });

  describe("profile mass assignment", () => {
    it("filters server-managed fields on PATCH /api/users/:id", async () => {
      const owner = makeUser({ id: 1 });
      await startHarness([owner]);
      const token = authToken(owner.id);

      const response = await requestJson(port, "/api/users/1", {
        method: "PATCH",
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({
          bio: "safe update",
          email: "attacker@example.invalid",
          firebaseUid: "forged-firebase-uid",
          emailVerified: false,
          hasMinimumMatchData: false,
          currentLocationLat: "999",
          currentSnapshotId: 999,
        }),
      });

      expect(response.status).toBe(200);
      const update = state.updateCalls.find((call) => call.userId === owner.id)?.data;
      expect(update).toMatchObject({ bio: "safe update" });
      expect(update).not.toHaveProperty("email");
      expect(update).not.toHaveProperty("firebaseUid");
      expect(update).not.toHaveProperty("emailVerified");
      expect(update).not.toHaveProperty("hasMinimumMatchData");
      expect(update).not.toHaveProperty("currentLocationLat");
      expect(update).not.toHaveProperty("currentSnapshotId");
    });

    it("filters server-managed fields on PATCH /api/user", async () => {
      const owner = makeUser({ id: 1 });
      await startHarness([owner]);
      const token = authToken(owner.id);

      const response = await requestJson(port, "/api/user", {
        method: "PATCH",
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({
          bio: "safe update",
          currentLocationLat: "999",
          currentLocationLng: "999",
          desiredLocationCoords: ["forged"],
          currentSnapshotId: 999,
          initialMatchJobsQueued: true,
        }),
      });

      expect(response.status).toBe(200);
      const update = state.updateCalls.find((call) => call.userId === owner.id)?.data;
      expect(update).toMatchObject({ bio: "safe update" });
      expect(update).not.toHaveProperty("currentLocationLat");
      expect(update).not.toHaveProperty("currentLocationLng");
      expect(update).not.toHaveProperty("desiredLocationCoords");
      expect(update).not.toHaveProperty("currentSnapshotId");
      expect(update).not.toHaveProperty("initialMatchJobsQueued");
    });
  });

  describe("CSRF and bearer behavior", () => {
    it("rejects cookie-authenticated state changes without an allowed Origin", async () => {
      const owner = makeUser({ id: 1 });
      await startHarness([owner]);
      const sessionResponse = await requestJson(port, "/__p0/session/1");
      const cookie = sessionResponse.headers.get("set-cookie");
      expect(cookie).toBeTruthy();

      const response = await requestJson(port, "/api/user", {
        method: "PATCH",
        headers: { cookie: cookie as string },
        body: JSON.stringify({ bio: "cookie update" }),
      });

      expect(response.status).toBe(403);
    });

    it("rejects cookie-authenticated state changes from an untrusted Origin", async () => {
      const owner = makeUser({ id: 1 });
      await startHarness([owner]);
      const sessionResponse = await requestJson(port, "/__p0/session/1");
      const cookie = sessionResponse.headers.get("set-cookie");
      expect(cookie).toBeTruthy();

      const response = await requestJson(port, "/api/user", {
        method: "PATCH",
        headers: {
          cookie: cookie as string,
          origin: "https://evil.example.invalid",
        },
        body: JSON.stringify({ bio: "cross-site update" }),
      });

      expect(response.status).toBe(403);
    });

    it("allows a valid native bearer request without an Origin header", async () => {
      const owner = makeUser({ id: 1 });
      await startHarness([owner]);
      const response = await requestJson(port, "/api/user", {
        method: "PATCH",
        headers: { authorization: `Bearer ${authToken(owner.id)}` },
        body: JSON.stringify({ bio: "native update" }),
      });

      expect(response.status).toBe(200);
    });
  });

  describe("registration state ordering", () => {
    it("allows completion when the submitted profile satisfies required fields despite a stale readiness flag", async () => {
      const owner = makeUser({
        id: 1,
        industry: "Finance",
        registrationCompleted: false,
        hasMinimumMatchData: false,
      });
      await startHarness([owner]);

      const response = await requestJson(port, "/api/user", {
        method: "PATCH",
        headers: { authorization: `Bearer ${authToken(owner.id)}` },
        body: JSON.stringify({ registrationCompleted: true }),
      });

      expect(response.status).toBe(200);
      const update = state.updateCalls.find((call) => call.userId === owner.id)?.data;
      expect(update).toMatchObject({ registrationCompleted: true });
    });
  });

  describe("administrative authorization and privacy", () => {
    it("does not expose an unverified peer profile", async () => {
      const viewer = makeUser({ id: 1, email: "viewer@example.invalid" });
      const target = makeUser({
        id: 2,
        email: "target@example.invalid",
        emailVerified: false,
      });
      await startHarness([viewer, target]);

      const response = await requestJson(port, "/api/users/2", {
        headers: { authorization: `Bearer ${authToken(viewer.id)}` },
      });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ message: "User not found" });
    });

    it("reports incomplete match readiness instead of queuing or claiming no matches", async () => {
      const incompleteMatchProfile = makeUser({
        id: 1,
        hasMinimumMatchData: false,
      });
      await startHarness([incompleteMatchProfile]);

      const response = await requestJson(port, "/api/matches/synergy", {
        headers: { authorization: `Bearer ${authToken(incompleteMatchProfile.id)}` },
      });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        matches: [],
        apiConnectionIssue: false,
        matchState: "profile_incomplete",
        requiresAction: "complete_profile",
        discoverabilityPolicyVersion: "1",
      });
    });

    it("keeps administrative authorization separate from ordinary authentication", async () => {
      const ordinaryUser = makeUser({ id: 1 });
      await startHarness([ordinaryUser]);
      const token = authToken(ordinaryUser.id);

      const denied = await requestJson(port, "/api/admin/dead-letters", {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(denied.status).toBe(403);
      expect(denied.body).toEqual({ error: "Administrator authorization required" });

      process.env.ADMIN_USER_IDS = String(ordinaryUser.id);
      try {
        const allowed = await requestJson(port, "/api/admin/dead-letters", {
          headers: { authorization: `Bearer ${token}` },
        });
        expect(allowed.status).toBe(200);
        expect(allowed.body).toMatchObject({ success: true, deadLetters: [] });
      } finally {
        delete process.env.ADMIN_USER_IDS;
      }
    });

    it("returns only the public projection for another user's profile", async () => {
      const viewer = makeUser({ id: 1, email: "viewer@example.invalid" });
      const target = makeUser({
        id: 2,
        email: "target@example.invalid",
        firebaseUid: "target-firebase-uid",
        resumeUrl: "/api/media/target-resume",
      });
      await startHarness([viewer, target]);
      const storage = mocks.storage as Record<string, unknown>;
      storage.isUserBlocked = async () => false;
      storage.getConnectionBetweenUsers = async () => undefined;

      const response = await requestJson(port, "/api/users/2", {
        headers: { authorization: `Bearer ${authToken(viewer.id)}` },
      });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ id: target.id, fullName: target.fullName });
      expect(response.body).not.toHaveProperty("email");
      expect(response.body).not.toHaveProperty("firebaseUid");
      expect(response.body).not.toHaveProperty("resumeUrl");
    });

    it("returns resume references to an accepted peer without exposing private identity fields", async () => {
      const viewer = makeUser({ id: 1, email: "viewer@example.invalid" });
      const target = makeUser({
        id: 2,
        email: "target@example.invalid",
        firebaseUid: "target-firebase-uid",
        resumeUrl: "/api/media/target-resume",
        resumePreviewUrls: ["/api/media/target-preview"],
      });
      await startHarness([viewer, target]);
      const storage = mocks.storage as Record<string, unknown>;
      storage.isUserBlocked = async () => false;
      storage.getConnectionBetweenUsers = async () => ({
        id: 11,
        user1Id: viewer.id,
        user2Id: target.id,
        createdAt: "2030-01-01T00:00:00.000Z",
      });

      const response = await requestJson(port, "/api/users/2", {
        headers: { authorization: `Bearer ${authToken(viewer.id)}` },
      });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: target.id,
        resumeUrl: target.resumeUrl,
        resumePreviewUrls: target.resumePreviewUrls,
      });
      expect(response.body).not.toHaveProperty("email");
      expect(response.body).not.toHaveProperty("firebaseUid");
    });

    it("hides a profile when either user has blocked the other", async () => {
      const viewer = makeUser({ id: 1 });
      const target = makeUser({ id: 2 });
      await startHarness([viewer, target]);
      (mocks.storage as Record<string, unknown>).isUserBlocked = async (
        userId: number,
        blockedUserId: number,
      ) => userId === viewer.id && blockedUserId === target.id;

      const response = await requestJson(port, "/api/users/2", {
        headers: { authorization: `Bearer ${authToken(viewer.id)}` },
      });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ message: "User not found" });
    });
  });

  describe("registration, messaging, media, and internal boundaries", () => {
    it("does not allow incomplete registration to reach protected routes", async () => {
      const incomplete = makeUser({ id: 1, registrationCompleted: false });
      await startHarness([incomplete]);

      const response = await requestJson(port, "/api/connections", {
        headers: { authorization: `Bearer ${authToken(incomplete.id)}` },
      });

      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({
        error: "Registration incomplete",
        requiresAction: "complete_registration",
      });
    });

    it("requires an accepted connection before direct messages", async () => {
      const sender = makeUser({ id: 1 });
      const recipient = makeUser({ id: 2 });
      await startHarness([sender, recipient]);
      (mocks.storage as Record<string, unknown>).getConnectionBetweenUsers = async () => undefined;

      const response = await requestJson(port, "/api/messages/2", {
        method: "POST",
        headers: { authorization: `Bearer ${authToken(sender.id)}` },
        body: JSON.stringify({ content: "private message" }),
      });

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ message: "Messages require an accepted connection" });
    });

    it("rejects group chat instead of creating an unsupported conversation", async () => {
      const sender = makeUser({ id: 1 });
      await startHarness([sender]);

      const response = await requestJson(port, "/api/messages/group", {
        method: "POST",
        headers: { authorization: `Bearer ${authToken(sender.id)}` },
        body: JSON.stringify({ memberIds: [2], content: "unsupported" }),
      });

      expect(response.status).toBe(410);
      expect(response.body).toEqual({
        message: "Group chat is not supported. Use a direct connection chat instead.",
      });
    });

    it("keeps legacy password reset and private media paths explicit", async () => {
      const user = makeUser({ id: 1 });
      await startHarness([user]);

      const reset = await requestJson(port, "/api/password-reset/request", {
        method: "POST",
        body: JSON.stringify({ email: user.email }),
      });
      expect(reset.status).toBe(410);
      expect(reset.body).toMatchObject({ message: expect.stringContaining("Firebase") });

      const media = await requestJson(port, "/api/media/not-owned");
      expect(media.status).toBe(401);
    });

    it("rejects internal Worker requests without the server-only credential", async () => {
      const response = await requestJson(port, "/internal/health");
      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({ error: expect.any(String) });
    });
  });
});