import { describe, expect, test, vi } from "vitest";
import type { Response } from "express";
import { copyProxyResponseHeaders } from "../proxy-headers";

describe("copyProxyResponseHeaders", () => {
  test("does not forward body framing or compression headers", () => {
    const response = {
      setHeader: vi.fn(),
    } as unknown as Response;
    const headers = new Headers({
      "Cache-Control": "no-store",
      "Content-Encoding": "gzip",
      "Content-Length": "42",
      "Content-Type": "text/plain",
      "Transfer-Encoding": "chunked",
    });

    copyProxyResponseHeaders(headers, response);

    expect(response.setHeader).toHaveBeenCalledWith("cache-control", "no-store");
    expect(response.setHeader).toHaveBeenCalledWith("content-type", "text/plain");
    expect(response.setHeader).not.toHaveBeenCalledWith("content-encoding", "gzip");
    expect(response.setHeader).not.toHaveBeenCalledWith("content-length", "42");
    expect(response.setHeader).not.toHaveBeenCalledWith("transfer-encoding", "chunked");
  });
});