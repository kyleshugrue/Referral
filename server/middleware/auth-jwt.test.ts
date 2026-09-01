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

const { requireAuthJWT } = await import("./auth-jwt");

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