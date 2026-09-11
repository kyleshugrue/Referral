import { describe, expect, it } from "vitest";
import { findNativeLoggingViolations } from "./check-console-policy.mjs";

describe("native console policy", () => {
  it("accepts status-only native diagnostics", () => {
    expect(findNativeLoggingViolations([
      ["safe.swift", 'print("[AppDelegate] FCM token refresh received")'],
    ])).toEqual([]);
  });

  it("rejects token and notification-content interpolation", () => {
    expect(findNativeLoggingViolations([
      ["unsafe-token.swift", 'print("FCM token: \\(token)")'],
      ["unsafe-message.swift", 'print("message preview: \\(messagePreview)")'],
    ])).toEqual(["unsafe-token.swift:1", "unsafe-message.swift:1"]);
  });
});