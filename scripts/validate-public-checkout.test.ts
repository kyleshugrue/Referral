import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  assertStagedPublicPaths,
  buildCommandEnvironment,
  buildProductionEnvironment,
  buildIntegrityManifest,
  CLEAN_ROOM_COMMANDS,
  compareRuntimeOutputs,
  parseCli,
} from "./validate-public-checkout.mjs";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("public clean-room orchestration", () => {
  test("uses the exact lockfile-enforced install command after hygiene", () => {
    expect(CLEAN_ROOM_COMMANDS[0]).toEqual(["repo:hygiene", ["run", "repo:hygiene"]]);
    expect(CLEAN_ROOM_COMMANDS[1]).toEqual(["npm ci", ["ci", "--no-audit", "--no-fund"]]);
    expect(CLEAN_ROOM_COMMANDS.findIndex(([label]) => label === "repo:hygiene"))
      .toBeLessThan(CLEAN_ROOM_COMMANDS.findIndex(([label]) => label === "npm ci"));
  });

  test("parses source-root, public-checkout, and temporary-root options", () => {
    expect(parseCli([
      "--public-checkout",
      "--source-root=/tmp/public",
      "--temp-root",
      "/tmp/clean-room",
      "--canonical-artifact=/tmp/canonical",
    ])).toEqual({
      sourceRoot: "/tmp/public",
      publicCheckout: true,
      temporaryRoot: "/tmp/clean-room",
      canonicalArtifact: "/tmp/canonical",
    });
  });

  test("uses a minimal environment and keeps production mode build-only", () => {
    const root = "/tmp/clean-room";
    const original = {
      PATH: process.env.PATH,
      REFERRAL_CANARY_INPUT: process.env.REFERRAL_CANARY_INPUT,
      NODE_ENV: process.env.NODE_ENV,
      DATABASE_URL: process.env.DATABASE_URL,
    };
    process.env.REFERRAL_CANARY_INPUT = "must-not-cross-process-boundary";
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgres://canary.invalid";
    try {
      const quality = buildCommandEnvironment(root, "quality");
      const build = buildProductionEnvironment(root);
      expect(quality).not.toHaveProperty("REFERRAL_CANARY_SECRET");
      expect(quality).not.toHaveProperty("DATABASE_URL");
      expect(quality).not.toHaveProperty("NODE_ENV");
      expect(quality).not.toHaveProperty("VITE_FIREBASE_API_KEY");
      expect(quality).toMatchObject({
        NPM_CONFIG_PRODUCTION: "false",
        NPM_CONFIG_INCLUDE: "dev",
        NPM_CONFIG_USERCONFIG: `${root}/.npmrc`,
      });
      expect(build).toMatchObject({
        NODE_ENV: "production",
        NPM_CONFIG_PRODUCTION: "false",
        NPM_CONFIG_INCLUDE: "dev",
        VITE_FIREBASE_API_KEY: "ci-smoke-test-api-key",
      });
      expect(build).not.toHaveProperty("REFERRAL_CANARY_INPUT");
      expect(execFileSync(process.execPath, [
        "-e",
        "process.stdout.write(process.env.REFERRAL_CANARY_INPUT || '')",
      ], { env: quality, encoding: "utf8" })).toBe("");
    } finally {
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  test("builds a deterministic integrity manifest with modes and hashes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "public-clean-room-test-"));
    roots.push(root);
    await writeFile(path.join(root, "README.md"), "public\n", { mode: 0o644 });
    await writeFile(path.join(root, "run.sh"), "#!/bin/sh\n", { mode: 0o755 });
    await chmod(path.join(root, "run.sh"), 0o755);
    const manifest = await buildIntegrityManifest({
      root,
      paths: ["run.sh", "README.md"],
      commit: "a".repeat(40),
      tree: "b".repeat(40),
    });
    expect(manifest).toMatchObject({
      manifestType: "export-integrity",
      exportType: "public",
      fileCount: 2,
      totalBytes: 17,
      source: { commit: "a".repeat(40), tree: "b".repeat(40), dirty: false },
    });
    expect(manifest.files).toEqual([
      {
        path: "README.md",
        sourcePath: "README.md",
        size: 7,
        mode: 0o644,
        sha256: createHash("sha256").update("public\n").digest("hex"),
      },
      {
        path: "run.sh",
        sourcePath: "run.sh",
        size: 10,
        mode: 0o755,
        sha256: createHash("sha256").update("#!/bin/sh\n").digest("hex"),
      },
    ]);
    expect(await readFile(path.join(root, "README.md"), "utf8")).toBe("public\n");
  });

  test("requires staged paths to exactly match the manifest without staging it", () => {
    const manifest = {
      files: [{ path: ".gitignore" }, { path: "README.md" }],
    };
    expect(() => assertStagedPublicPaths({
      stagedPaths: [".gitignore", "README.md"],
      manifest,
    })).not.toThrow();
    expect(() => assertStagedPublicPaths({
      stagedPaths: [".gitignore", "README.md", "export-manifest.json"],
      manifest,
    })).toThrow(/unstaged/);
    expect(() => assertStagedPublicPaths({
      stagedPaths: [".gitignore"],
      manifest,
    })).toThrow(/match/);
  });

  test("requires canonical and public runtime trees to match exactly", async () => {
    const canonical = await mkdtemp(path.join(os.tmpdir(), "canonical-runtime-test-"));
    const publicOutput = await mkdtemp(path.join(os.tmpdir(), "public-runtime-test-"));
    roots.push(canonical, publicOutput);
    await mkdir(path.join(canonical, "assets"));
    await mkdir(path.join(publicOutput, "assets"));
    await writeFile(path.join(canonical, "assets", "app.js"), "same\n", { mode: 0o644 });
    await writeFile(path.join(publicOutput, "assets", "app.js"), "same\n", { mode: 0o644 });
    expect(await compareRuntimeOutputs({ canonicalRoot: canonical, publicRoot: publicOutput }))
      .toMatchObject({ fileCount: 1 });
    await writeFile(path.join(publicOutput, "assets", "app.js"), "different\n");
    await expect(compareRuntimeOutputs({ canonicalRoot: canonical, publicRoot: publicOutput }))
      .rejects.toThrow(/not exactly equivalent/);
  });

  test("compares release evidence while excluding only Git identity metadata", async () => {
    const canonical = await mkdtemp(path.join(os.tmpdir(), "canonical-evidence-test-"));
    const publicOutput = await mkdtemp(path.join(os.tmpdir(), "public-evidence-test-"));
    roots.push(canonical, publicOutput);
    const baseManifest = {
      schemaVersion: 1,
      git: { commit: "canonical", tree: "canonical-tree", dirty: false },
      package: { name: "referral", version: "1.0.0" },
      runtime: { node: "v24.0.0", npm: "10.8.2" },
    };
    await writeFile(path.join(canonical, "release-manifest.json"), JSON.stringify(baseManifest));
    await writeFile(path.join(publicOutput, "release-manifest.json"), JSON.stringify({
      ...baseManifest,
      git: { commit: "temporary", tree: "temporary-tree", dirty: false },
    }));
    await expect(compareRuntimeOutputs({ canonicalRoot: canonical, publicRoot: publicOutput }))
      .resolves.toMatchObject({ fileCount: 1 });
    await writeFile(path.join(publicOutput, "release-manifest.json"), JSON.stringify({
      ...baseManifest,
      git: { commit: "temporary", tree: "temporary-tree", dirty: false },
      package: { name: "changed", version: "1.0.0" },
    }));
    await expect(compareRuntimeOutputs({ canonicalRoot: canonical, publicRoot: publicOutput }))
      .rejects.toThrow(/not exactly equivalent/);
  });

  test("rejects case-folding collisions in runtime paths", async () => {
    const canonical = await mkdtemp(path.join(os.tmpdir(), "canonical-collision-test-"));
    const publicOutput = await mkdtemp(path.join(os.tmpdir(), "public-collision-test-"));
    roots.push(canonical, publicOutput);
    await writeFile(path.join(canonical, "app.js"), "same\n");
    await writeFile(path.join(publicOutput, "App.js"), "same\n");
    await writeFile(path.join(publicOutput, "app.js"), "same\n");
    await expect(compareRuntimeOutputs({ canonicalRoot: canonical, publicRoot: publicOutput }))
      .rejects.toThrow(/collision/);
  });

  test("rejects symlinks in runtime output trees", async () => {
    const canonical = await mkdtemp(path.join(os.tmpdir(), "canonical-symlink-test-"));
    const publicOutput = await mkdtemp(path.join(os.tmpdir(), "public-symlink-test-"));
    roots.push(canonical, publicOutput);
    await writeFile(path.join(canonical, "app.js"), "same\n");
    await writeFile(path.join(publicOutput, "outside.js"), "same\n");
    await symlink("outside.js", path.join(publicOutput, "app.js"));
    await expect(compareRuntimeOutputs({ canonicalRoot: canonical, publicRoot: publicOutput }))
      .rejects.toThrow(/symlink/);
  });
});
