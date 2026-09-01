import { describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAccessToken: vi.fn(),
  getUser: vi.fn(),
  next: vi.fn(),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../lib/jwt-service", () => ({ verifyAccessToken: mocks.verifyAccessToken }));
vi.mock("../storage", () => ({ storage: { getUser: mocks.getUser } }));
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
  session: { id: "session-id" },
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
    const request = makeRequest();
    const response = makeResponse();

    await requireAuthJWT(request as never, response as never, mocks.next);

    expect(mocks.next).toHaveBeenCalledOnce();
    expect(response.status).not.toHaveBeenCalled();
  });
});

describe("upload authentication compatibility", () => {
  test("attaches an application JWT user for upload routes", async () => {
    mocks.next.mockReset();
    mocks.verifyAccessToken.mockReturnValue({ userId: 7 });
    mocks.getUser.mockResolvedValue({ id: 7 });
    const request = makeRequest("Bearer app-token") as unknown as {
      user?: { id: number };
      authMethod?: string;
    };
    request.user = undefined;
    const response = makeResponse();

    await authenticateUploadPrincipal(request as never, response as never, mocks.next);

    expect(request.user).toEqual({ id: 7 });
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