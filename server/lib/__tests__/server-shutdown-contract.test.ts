import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const serverSource = readFileSync(new URL("../../index.ts", import.meta.url), "utf8");

describe("server shutdown resource contract", () => {
  test("clears the media deletion sweep exactly once in each shutdown path", () => {
    const startupFailureShutdown = serverSource.slice(
      serverSource.indexOf("httpServer.on('error'"),
      serverSource.indexOf("const closeHttpServer"),
    );
    const signalShutdown = serverSource.slice(
      serverSource.indexOf("const handleShutdownSignal"),
      serverSource.indexOf("// Start listening"),
    );

    expect(startupFailureShutdown.match(/clearInterval\(mediaDeletionInterval\)/g)).toHaveLength(1);
    expect(signalShutdown.match(/clearInterval\(mediaDeletionInterval\)/g)).toHaveLength(1);
  });
});