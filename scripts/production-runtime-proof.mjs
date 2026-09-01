#!/usr/bin/env node

/**
 * Prove that the built server starts with production dependencies only.
 *
 * The source checkout is never used as the install target. The copied lockfile
 * is normalized only inside the disposable directory because Replit's package
 * firewall URL is not reachable from GitHub-hosted runners.
 */

import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify((file, args, options, callback) => {
  const child = spawn(file, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  child.on("error", (error) => callback(error));
  child.on("close", (code, signal) => {
    if (code === 0) callback(null, { output, code, signal });
    else callback(new Error(`${file} ${args.join(" ")} exited with ${signal ?? code}`));
  });
});

const sourceRoot = path.resolve(".");
const lockfileName = "package-lock.json";
const firewallPrefix = /https?:\/\/package-firewall\.replit\.local\/npm\//g;

const fail = (message) => {
  throw new Error(message);
};

const getFreePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      reject(new Error("Unable to allocate a proof port."));
      return;
    }
    const port = address.port;
    server.close((error) => error ? reject(error) : resolve(port));
  });
});

const waitForExit = (child, timeoutMs) => new Promise((resolve, reject) => {
  let settled = false;
  const finish = (callback, value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    callback(value);
  };
  const timeout = setTimeout(() => finish(reject, new Error("Production server did not shut down within the timeout.")), timeoutMs);
  child.once("exit", (code, signal) => finish(resolve, { code, signal }));
  child.once("error", (error) => finish(reject, error));
});

const redactOutput = (output) => {
  let safe = output;
  for (const value of [
    process.env.DATABASE_URL,
    process.env.SESSION_SECRET,
    process.env.JWT_SECRET,
    process.env.JWT_REFRESH_SECRET,
    process.env.INTERNAL_API_SECRET,
    process.env.FIREBASE_PRIVATE_KEY,
  ]) {
    if (value) safe = safe.split(value).join("[REDACTED]");
  }
  return safe.split("\n").slice(-20).join("\n");
};

const waitForReady = async (port, child, getOutput) => {
  const url = `http://127.0.0.1:${port}/api/ready`;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (child.exitCode !== null) {
      fail(`Production server exited before readiness.\n${redactOutput(getOutput())}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.status === 200) return;
    } catch {
      // The process may still be starting or the listener may not be bound yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  fail(`Production server did not become ready within 15 seconds.\n${redactOutput(getOutput())}`);
};

let temporaryRoot;
try {
  const packagePath = path.join(sourceRoot, "package.json");
  const lockfilePath = path.join(sourceRoot, lockfileName);
  const artifactPath = path.join(sourceRoot, "dist");
  const packageJson = await readFile(packagePath, "utf8");
  const lockfile = await readFile(lockfilePath, "utf8");
  await readFile(path.join(artifactPath, "index.js"));

  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "referral-production-runtime-"));
  await writeFile(path.join(temporaryRoot, "package.json"), packageJson);
  await writeFile(
    path.join(temporaryRoot, lockfileName),
    lockfile.replace(firewallPrefix, "https://registry.npmjs.org/"),
  );
  await cp(artifactPath, path.join(temporaryRoot, "dist"), { recursive: true });

  await execFile(process.env.npm_execpath || "npm", ["ci", "--omit=dev", "--no-audit", "--no-fund"], {
    cwd: temporaryRoot,
    env: {
      ...process.env,
      NODE_ENV: "production",
      NPM_CONFIG_PRODUCTION: "true",
      NPM_CONFIG_OMIT: "dev",
      NPM_CONFIG_INCLUDE: "",
    },
  });

  const port = await getFreePort();
  const child = spawn(process.execPath, ["dist/index.js"], {
    cwd: temporaryRoot,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NODE_ENV: "production", PORT: String(port) },
  });
  let childOutput = "";
  const capture = (chunk) => {
    childOutput = `${childOutput}${chunk}`.slice(-32_000);
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  try {
    await waitForReady(port, child, () => childOutput);
    child.kill("SIGTERM");
    const shutdown = await waitForExit(child, 15_000);
    if (shutdown.signal && shutdown.signal !== "SIGTERM") {
      fail(`Production server exited from an unexpected signal: ${shutdown.signal}.`);
    }
    if (shutdown.code !== 0 && shutdown.code !== null) {
      fail(`Production server exited with status ${shutdown.code} during shutdown.`);
    }
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  console.log("Production-only runtime proof passed: omit-dev install, readiness, and graceful shutdown.");
} finally {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
}