import { describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAccessToken: vi.fn(),
  getUser: vi.fn(),
  isAccessTokenActive: vi.fn(async () => true),
  next: vi.fn(),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../lib/jwt-service", () => ({ verifyAccessToken: mocks.verifyAccessToken }));
vi.mock("../storage", () => ({
  storage: {
    getUser: mocks.getUser,
    isAccessTokenActive: mocks.isAccessTokenActive,
  },
}));
vi.mock("../lib/logger", () => ({ logger: mocks.logger }));
vi.mock("../lib/security-logger", () => ({
  logSecurityEvent: vi.fn(),
  extractRequestMetadata: vi.fn(() => ({ ip: "127.0.0.1", userAgent: "test", platform: "web" })),
}));
vi.mock("../lib/http-security", () => ({
  requireTrustedOriginForSessionMutation: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const { authenticateUploadPrincipal, requireAuthJWT } = await import("./auth-jwt");

const makeRequest = (authorization?: string) => ({
  headers: authorization ? { authorization } : {},
  path: "/api/user",
  method: "GET",
  session: { id: "session-id", authEpoch: 0 },
  user: { id: 2 },
  isAuthenticated: () => true,
});

const makeResponse = () => ({
  status: vi.fn().mockReturnThis(),
  json: vi.fn(),
});

describe("requireAuthJWT authentication precedence", () => {
  test("rejects an invalid bearer token instead of falling through to a session", async () => {
    mocks.verifyAccessToken.mockReturnValue(null);
    const request = makeRequest("Bearer invalid-token");
    const response = makeResponse();

    await requireAuthJWT(request as never, response as never, mocks.next);

    expect(response.status).toHaveBeenCalledWith(401);
    expect(response.json).toHaveBeenCalledWith({ error: "Authentication required" });
    expect(mocks.next).not.toHaveBeenCalled();
  });

  test("uses the session when no bearer credential is supplied", async () => {
    mocks.next.mockReset();
    mocks.getUser.mockResolvedValue({ id: 2, accountStatus: "active", authEpoch: 0 });
    const request = makeRequest();
    const response = makeResponse();

    await requireAuthJWT(request as never, response as never, mocks.next);

    expect(mocks.next).toHaveBeenCalledOnce();
    expect(response.status).not.toHaveBeenCalled();
  });

  test("rejects an access token after its authorization family is revoked", async () => {
    mocks.next.mockReset();
    mocks.verifyAccessToken.mockReturnValue({
      userId: 7,
      authSessionId: "device-session-7",
      authEpoch: 0,
    });
    mocks.getUser.mockResolvedValue({ id: 7, accountStatus: "active", authEpoch: 0 });
    mocks.isAccessTokenActive.mockResolvedValue(false);
    const response = makeResponse();

    await requireAuthJWT(makeRequest("Bearer revoked-token") as never, response as never, mocks.next);

    expect(response.status).toHaveBeenCalledWith(401);
    expect(mocks.next).not.toHaveBeenCalled();
  });

  test("fails closed when authorization-state lookup is unavailable", async () => {
    mocks.next.mockReset();
    mocks.verifyAccessToken.mockReturnValue({
      userId: 7,
      authSessionId: "device-session-7",
      authEpoch: 0,
    });
    mocks.getUser.mockResolvedValue({ id: 7, accountStatus: "active", authEpoch: 0 });
    mocks.isAccessTokenActive.mockRejectedValue(new Error("database unavailable"));
    const response = makeResponse();

    await requireAuthJWT(makeRequest("Bearer unavailable-token") as never, response as never, mocks.next);

    expect(response.status).toHaveBeenCalledWith(401);
    expect(mocks.next).not.toHaveBeenCalled();
  });
});

describe("upload authentication compatibility", () => {
  test("attaches an application JWT user for upload routes", async () => {
    mocks.next.mockReset();
    mocks.isAccessTokenActive.mockResolvedValue(true);
    mocks.verifyAccessToken.mockReturnValue({ userId: 7 });
    mocks.getUser.mockResolvedValue({ id: 7, accountStatus: "active" });
    const request = makeRequest("Bearer app-token") as unknown as {
      user?: { id: number };
      authMethod?: string;
    };
    request.user = undefined;
    const response = makeResponse();

    await authenticateUploadPrincipal(request as never, response as never, mocks.next);

    expect(request.user).toMatchObject({ id: 7, accountStatus: "active" });
    expect(request.authMethod).toBe("jwt");
    expect(mocks.next).toHaveBeenCalledOnce();
  });

  test("passes Firebase registration tokens through for Firebase verification", async () => {
    mocks.next.mockReset();
    mocks.verifyAccessToken.mockReturnValue(null);
    const request = makeRequest("Bearer firebase-token") as unknown as {
      user?: { id: number };
      authMethod?: string;
    };
    request.user = undefined;
    const response = makeResponse();

    await authenticateUploadPrincipal(request as never, response as never, mocks.next);

    expect(request.user).toBeUndefined();
    expect(request.authMethod).toBeUndefined();
    expect(mocks.next).toHaveBeenCalledOnce();
    expect(response.status).not.toHaveBeenCalled();
  });
});