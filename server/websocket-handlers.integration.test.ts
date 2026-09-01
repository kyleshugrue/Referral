import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import {
  MAX_WEBSOCKET_PAYLOAD_BYTES,
} from "./lib/websocket-security";

const tickets = new Map<string, { userId: number; sessionId: string | null }>();
const syntheticUser = {
  id: 7,
  fullName: "Synthetic WebSocket User",
};

vi.mock("./auth", () => ({
  sessionMiddleware: (request: { session?: unknown }, _response: unknown, next: (error?: unknown) => void) => {
    request.session = undefined;
    next();
  },
}));

vi.mock("./storage", () => ({
  storage: {
    getUser: vi.fn(async (userId: number) => userId === syntheticUser.id ? syntheticUser : undefined),
    getConnectionBetweenUsers: vi.fn(async () => undefined),
  },
}));

vi.mock("./lib/websocket-tickets", () => ({
  consumeWebSocketTicket: vi.fn(async (ticket: string) => {
    const result = tickets.get(ticket) ?? null;
    tickets.delete(ticket);
    return result;
  }),
}));

vi.mock("./lib/websocket-utils", () => ({
  setConnectedClientsRef: vi.fn(),
  notifyConnectionAccepted: vi.fn(),
  notifyConnectionRequestRejected: vi.fn(),
  notifyConnectionRequest: vi.fn(),
}));

vi.mock("./lib/security-logger", () => ({
  logSecurityEvent: vi.fn(),
}));

vi.mock("./lib/logger", () => {
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

const { setupWebSocketServer } = await import("./websocket-handlers");

type ReceivedMessage = Record<string, unknown>;

function waitForMessage(
  socket: WebSocket,
  messages: ReceivedMessage[],
  predicate: (message: ReceivedMessage) => boolean,
): Promise<ReceivedMessage> {
  const existing = messages.find(predicate);
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve, reject) => {
    const onMessage = (data: WebSocket.RawData) => {
      const message = JSON.parse(data.toString()) as ReceivedMessage;
      messages.push(message);
      if (predicate(message)) {
        socket.off("message", onMessage);
        resolve(message);
      }
    };
    socket.on("message", onMessage);
    socket.once("error", reject);
  });
}

function waitForClose(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    socket.once("close", (code, reason) => {
      resolve({ code, reason: reason.toString() });
    });
  });
}

async function openSocket(
  port: number,
  protocols?: string[],
  headers?: Record<string, string>,
): Promise<{ socket: WebSocket; messages: ReceivedMessage[] }> {
  const messages: ReceivedMessage[] = [];
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, protocols, { headers });
  socket.on("error", () => undefined);
  socket.on("message", (data) => {
    messages.push(JSON.parse(data.toString()) as ReceivedMessage);
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
  return { socket, messages };
}

function expectHandshakeRejected(
  port: number,
  protocols?: string[],
  headers?: Record<string, string>,
): Promise<Error> {
  return new Promise((resolve) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, protocols, { headers });
    socket.once("error", (error) => {
      socket.close();
      resolve(error);
    });
  });
}

describe("WebSocket handler integration", () => {
  let server: Server;
  let stopWebSocketServer: () => Promise<void>;
  let port: number;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(async () => {
    process.env.NODE_ENV = "development";
    tickets.clear();
    server = createServer();
    stopWebSocketServer = setupWebSocketServer(server);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    port = (server.address() as { port: number }).port;
  });

  afterEach(async () => {
    process.env.NODE_ENV = originalNodeEnv;
    await stopWebSocketServer();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("rejects missing and invalid authentication during the real handshake", async () => {
    const missing = await expectHandshakeRejected(port);
    expect(missing.message).toContain("401");

    const invalid = await expectHandshakeRejected(
      port,
      ["referral-ws-ticket.invalid-ticket"],
    );
    expect(invalid.message).toContain("401");
  });

  it("consumes a valid ticket once and exercises the message lifecycle", async () => {
    tickets.set("one-time-ticket", { userId: syntheticUser.id, sessionId: null });
    const first = await openSocket(port, ["referral-ws-ticket.one-time-ticket"]);
    await expect(waitForMessage(first.socket, first.messages, (message) => message.type === "connected"))
      .resolves.toMatchObject({ type: "connected", userId: syntheticUser.id, platform: "web" });

    first.socket.send(JSON.stringify({ type: "authenticate" }));
    await expect(waitForMessage(first.socket, first.messages, (message) => message.type === "authenticated"))
      .resolves.toMatchObject({ type: "authenticated", userId: syntheticUser.id, status: "success" });

    first.socket.send(JSON.stringify({ type: "not-a-client-event" }));
    await expect(waitForMessage(first.socket, first.messages, (message) => message.type === "error"))
      .resolves.toMatchObject({ type: "error", message: "Message processing failed" });

    first.socket.close();
    await waitForClose(first.socket);

    const replay = await expectHandshakeRejected(
      port,
      ["referral-ws-ticket.one-time-ticket"],
    );
    expect(replay.message).toContain("401");
  });

  it("enforces relationship authorization and rejects oversized frames", async () => {
    tickets.set("relationship-ticket", { userId: syntheticUser.id, sessionId: null });
    const connection = await openSocket(port, ["referral-ws-ticket.relationship-ticket"]);
    await waitForMessage(connection.socket, connection.messages, (message) => message.type === "connected");

    connection.socket.send(JSON.stringify({ type: "loadMessages", partnerId: 8 }));
    await expect(waitForMessage(connection.socket, connection.messages, (message) => message.type === "error"))
      .resolves.toMatchObject({ message: "Users must be connected to chat" });

    const oversized = JSON.stringify({
      type: "test",
      content: "x".repeat(MAX_WEBSOCKET_PAYLOAD_BYTES),
    });
    connection.socket.send(oversized);
    await expect(waitForClose(connection.socket)).resolves.toMatchObject({ code: 1009 });
  });

  it("rejects an untrusted production origin before authentication", async () => {
    process.env.NODE_ENV = "production";
    const rejected = await expectHandshakeRejected(
      port,
      undefined,
      { origin: "https://attacker.invalid" },
    );
    expect(rejected.message).toContain("403");
  });

  it("closes active clients cleanly during server shutdown", async () => {
    tickets.set("shutdown-ticket", { userId: syntheticUser.id, sessionId: null });
    const connection = await openSocket(port, ["referral-ws-ticket.shutdown-ticket"]);
    await waitForMessage(connection.socket, connection.messages, (message) => message.type === "connected");

    const closed = waitForClose(connection.socket);
    const stop = stopWebSocketServer;
    stopWebSocketServer = async () => undefined;
    await stop();
    await expect(closed).resolves.toMatchObject({ code: 1000, reason: "Server shutting down" });
  });
});