#!/usr/bin/env node

/**
 * Authoritative public clean-room validation.
 *
 * This script never installs into the checkout that launched it. In canonical
 * mode it creates a deterministic public export first; in public-checkout mode
 * it copies tracked files into a disposable staging directory. All validation
 * commands then run from that disposable tree.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_PATH_LENGTH = 4096;
const COMMAND_TIMEOUT_MS = 15 * 60 * 1000;
const MANIFEST_NAME = "export-manifest.json";
const DEFAULT_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
const SAFE_SYSTEM_ENV_KEYS = Object.freeze(["PATH", "LANG", "LC_ALL", "TZ", "TERM"]);
const SYNTHETIC_BUILD_ENV = Object.freeze({
  VITE_FIREBASE_API_KEY: "ci-smoke-test-api-key",
  VITE_FIREBASE_AUTH_DOMAIN: "ci-smoke-test-project.firebaseapp.com",
  VITE_FIREBASE_PROJECT_ID: "ci-smoke-test-project",
  VITE_FIREBASE_STORAGE_BUCKET: "ci-smoke-test-project.appspot.com",
  VITE_FIREBASE_APP_ID: "1:000000000000:web:0000000000000000000000",
  VITE_SMOKE_TEST: "true",
});
const REPLIT_LOCKFILE_PREFIX = ["http://package-firewall", ".replit.local/npm/"].join("");
const PUBLIC_LOCKFILE_PREFIX = "https://registry.npmjs.org/";

const fail = (message) => {
  throw new Error(message);
};

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const normalizeRelativePath = (value) => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PATH_LENGTH ||
    value.includes("\\") ||
    value.startsWith("/") ||
    value.includes("\0")
  ) {
    fail("Clean-room path is invalid.");
  }
  const normalized = path.posix.normalize(value);
  if (normalized !== value || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    fail("Clean-room path is unsafe.");
  }
  return normalized;
};

const absolutePath = (value, label) => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    !path.isAbsolute(value) ||
    value.split(/[\\/]/).includes("..") ||
    /[$`{}]/.test(value)
  ) {
    fail(`${label} must be an explicit absolute path.`);
  }
  return path.resolve(value);
};

const relativePath = (root, candidate) => path.relative(path.resolve(root), path.resolve(candidate));

const assertOutside = (candidate, protectedRoot, label) => {
  const relative = relativePath(protectedRoot, candidate);
  if (!relative || (!relative.startsWith("../") && !path.isAbsolute(relative))) {
    fail(`${label} must be outside the source checkout.`);
  }
};

const assertDisjoint = (first, second, label) => {
  assertOutside(first, second, label);
  assertOutside(second, first, label);
};

const assertNoPathCollisions = (paths, label = "Clean-room paths") => {
  const seen = new Map();
  for (const value of paths) {
    const normalized = normalizeRelativePath(value);
    const identity = normalized.normalize("NFKC").toLocaleLowerCase("en-US");
    const previous = seen.get(identity);
    if (previous !== undefined) {
      fail(`${label} contain a case or Unicode-normalization collision.`);
    }
    seen.set(identity, normalized);
  }
  return [...seen.values()];
};

const pathExists = async (candidate) => {
  try {
    await lstat(candidate);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
};

const assertExistingAncestorsSafe = async (candidate, label) => {
  const absolute = path.resolve(candidate);
  const root = path.parse(absolute).root;
  const segments = absolute.slice(root.length).split(path.sep).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) fail(`${label} contains a symlinked path component.`);
      if (!info.isDirectory() && current !== absolute) fail(`${label} contains a non-directory path component.`);
    } catch (error) {
      if (error instanceof Error && error.message.includes("contains a ")) throw error;
      if (error?.code === "ENOENT") break;
      throw error;
    }
  }
};

const assertSafeDirectory = async (candidate, label, { allowMissing = false } = {}) => {
  const absolute = path.resolve(candidate);
  if (absolute === path.parse(absolute).root || absolute === path.resolve(os.homedir())) {
    fail(`${label} must not be the filesystem or home directory.`);
  }
  await assertExistingAncestorsSafe(absolute, label);
  if (!(await pathExists(absolute))) {
    if (!allowMissing) fail(`${label} does not exist.`);
    return absolute;
  }
  const info = await lstat(absolute);
  if (info.isSymbolicLink() || !info.isDirectory()) fail(`${label} must be a regular directory.`);
  const resolved = await realpath(absolute);
  if (resolved !== absolute) fail(`${label} resolves through an unexpected path.`);
  return absolute;
};

const assertSafeExistingPath = async (candidate, label) => {
  const absolute = path.resolve(candidate);
  await assertExistingAncestorsSafe(absolute, label);
  if (!(await pathExists(absolute))) return false;
  const info = await lstat(absolute);
  if (info.isSymbolicLink()) fail(`${label} must not be a symlink.`);
  return info;
};

const assertContainedPath = (root, candidate, label) => {
  const relative = relativePath(root, candidate);
  if (!relative || relative.startsWith("../") || path.isAbsolute(relative)) {
    fail(`${label} must remain inside its root.`);
  }
  return relative.split(path.sep).join("/");
};

const safeSystemEnvironment = () => {
  const env = {
    PATH: process.env.PATH || DEFAULT_PATH,
    LANG: process.env.LANG || "C.UTF-8",
    LC_ALL: process.env.LC_ALL || "C.UTF-8",
    TZ: process.env.TZ || "UTC",
    TERM: process.env.TERM || "dumb",
    CI: "true",
    FORCE_COLOR: "0",
    NO_COLOR: "1",
  };
  for (const key of SAFE_SYSTEM_ENV_KEYS) {
    if (typeof process.env[key] === "string" && process.env[key].length > 0) env[key] = process.env[key];
  }
  return env;
};

export const buildCommandEnvironment = (root, phase) => {
  const safeRoot = path.resolve(root);
  const env = {
    ...safeSystemEnvironment(),
    HOME: path.join(safeRoot, ".home"),
    TMPDIR: path.join(safeRoot, ".tmp"),
    TMP: path.join(safeRoot, ".tmp"),
    TEMP: path.join(safeRoot, ".tmp"),
    NPM_CONFIG_CACHE: path.join(safeRoot, ".npm-cache"),
    NPM_CONFIG_USERCONFIG: path.join(safeRoot, ".npmrc"),
    NPM_CONFIG_REGISTRY: "https://registry.npmjs.org/",
    NPM_CONFIG_PRODUCTION: "false",
    NPM_CONFIG_INCLUDE: "dev",
    NPM_CONFIG_AUDIT: "false",
    NPM_CONFIG_FUND: "false",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_OPTIONAL_LOCKS: "0",
  };
  if (phase === "build") env.NODE_ENV = "production";
  return env;
};

export const buildProductionEnvironment = (root) => ({
  ...buildCommandEnvironment(root, "build"),
  ...SYNTHETIC_BUILD_ENV,
});

const git = (cwd, ...args) => {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      shell: false,
      env: buildCommandEnvironment(cwd, "git"),
    }).trim();
  } catch {
    fail("Clean-room Git inspection failed.");
  }
};

const run = (cwd, binary, args, label, env = buildCommandEnvironment(cwd, "generic")) => {
  try {
    execFileSync(binary, args, {
      cwd,
      env,
      shell: false,
      stdio: "inherit",
      timeout: COMMAND_TIMEOUT_MS,
      killSignal: "SIGTERM",
    });
  } catch {
    fail(`Clean-room command failed: ${label}.`);
  }
};

const trackedPaths = (sourceRoot) =>
  assertNoPathCollisions(
    git(sourceRoot, "ls-files", "-z")
      .split("\0")
      .filter(Boolean)
      .map(normalizeRelativePath),
    "Tracked source paths",
  ).sort();

const sourceState = async (sourceRoot) => {
  const paths = trackedPaths(sourceRoot);
  const files = {};
  for (const relativePath of paths) {
    const filePath = path.join(sourceRoot, relativePath);
    const info = await lstat(filePath).catch(() => fail("Tracked source file is unavailable."));
    if (!info.isFile() || info.isSymbolicLink()) fail("Tracked source contains a non-regular file.");
    files[relativePath] = {
      sha256: sha256(await readFile(filePath)),
      mode: info.mode & 0o777,
    };
  }
  return {
    commit: git(sourceRoot, "rev-parse", "--verify", "HEAD^{commit}"),
    tree: git(sourceRoot, "rev-parse", "--verify", "HEAD^{tree}"),
    status: git(sourceRoot, "status", "--porcelain=v1", "--untracked-files=all"),
    paths,
    files,
  };
};

const assertSourceClean = (state) => {
  if (state.status.length > 0) fail("Source checkout must be clean before clean-room validation.");
};

const assertSourceUnchanged = async (sourceRoot, before) => {
  const after = await sourceState(sourceRoot);
  if (
    after.commit !== before.commit ||
    after.tree !== before.tree ||
    after.status !== before.status ||
    JSON.stringify(after.paths) !== JSON.stringify(before.paths) ||
    JSON.stringify(after.files) !== JSON.stringify(before.files)
  ) {
    fail("Canonical source checkout changed during clean-room validation.");
  }
};

const assertDestinationPath = (destinationRoot, relativePath) => {
  const normalized = normalizeRelativePath(relativePath);
  const destinationPath = path.resolve(destinationRoot, normalized);
  const relative = assertContainedPath(destinationRoot, destinationPath, "Clean-room destination path");
  if (relative !== normalized) fail("Clean-room destination path escaped its root.");
  return destinationPath;
};

const copyTrackedFiles = async (sourceRoot, destinationRoot, paths) => {
  assertNoPathCollisions(paths, "Tracked source paths");
  await assertSafeDirectory(sourceRoot, "Source checkout");
  await assertSafeDirectory(destinationRoot, "Public checkout");
  for (const relativePath of paths) {
    const sourcePath = path.join(sourceRoot, relativePath);
    const info = await lstat(sourcePath).catch(() => fail("Tracked source file is unavailable."));
    if (!info.isFile() || info.isSymbolicLink()) fail("Public checkout contains a non-regular tracked file.");
    const destinationPath = assertDestinationPath(destinationRoot, relativePath);
    await assertExistingAncestorsSafe(destinationPath, "Public checkout destination");
    await mkdir(path.dirname(destinationPath), { recursive: true });
    if (await pathExists(destinationPath)) fail("Public checkout destination is not empty.");
    await writeFile(destinationPath, await readFile(sourcePath), { mode: info.mode & 0o777 });
    await chmod(destinationPath, info.mode & 0o777);
  }
};

export const buildIntegrityManifest = async ({ root, paths, commit, tree }) => {
  await assertSafeDirectory(root, "Public checkout");
  assertNoPathCollisions(paths, "Integrity manifest paths");
  const files = [];
  for (const relativePath of [...paths].sort()) {
    const filePath = assertDestinationPath(root, relativePath);
    const info = await lstat(filePath).catch(() => fail("Public clean-room file is unavailable."));
    if (!info.isFile() || info.isSymbolicLink()) fail("Public clean-room tree contains a non-regular file.");
    const bytes = await readFile(filePath);
    files.push({
      path: relativePath,
      sourcePath: relativePath,
      size: bytes.length,
      mode: info.mode & 0o777,
      sha256: sha256(bytes),
    });
  }
  return {
    schemaVersion: 2,
    manifestType: "export-integrity",
    exportType: "public",
    source: { commit, tree, dirty: false },
    selectionManifest: null,
    fileCount: files.length,
    totalBytes: files.reduce((total, entry) => total + entry.size, 0),
    files,
  };
};

export const assertStagedPublicPaths = ({ stagedPaths, manifest }) => {
  const staged = assertNoPathCollisions([...stagedPaths], "Staged public paths").sort();
  const expected = assertNoPathCollisions(
    manifest.files.map((entry) => normalizeRelativePath(entry.path)),
    "Integrity manifest paths",
  ).sort();
  if (staged.includes(MANIFEST_NAME)) {
    fail("Integrity manifest must remain unstaged.");
  }
  if (staged.length !== expected.length || staged.some((entry, index) => entry !== expected[index])) {
    fail("Staged public paths do not match the integrity manifest.");
  }
};

const initializeAndStage = (root, manifest) => {
  run(root, "git", ["init", "--quiet"], "temporary Git initialization");
  run(root, "git", ["config", "user.email", "ci-clean-room@example.invalid"], "temporary Git identity");
  run(root, "git", ["config", "user.name", "CI Clean Room"], "temporary Git identity");
  run(root, "git", ["add", "--all"], "temporary Git staging");
  const staged = git(root, "ls-files", "-z").split("\0").filter(Boolean);
  assertStagedPublicPaths({ stagedPaths: staged, manifest });
  run(root, "git", ["commit", "--quiet", "-m", "public clean-room baseline"], "temporary Git baseline");
};

const fileState = async (root, paths) => {
  const state = {};
  for (const relativePath of paths) {
    state[relativePath] = sha256(await readFile(assertDestinationPath(root, relativePath)));
  }
  return state;
};

const assertTrackedFilesUnchanged = async (root, paths, before) => {
  const after = await fileState(root, paths);
  if (JSON.stringify(after) !== JSON.stringify(before)) {
    fail("Tracked public source changed during clean-room validation.");
  }
  if (git(root, "status", "--porcelain=v1", "--untracked-files=no").length > 0) {
    fail("Tracked public source has a Git change after clean-room validation.");
  }
};

const comparableRuntimeFile = async (root, relativePath) => {
  const bytes = await readFile(assertDestinationPath(root, relativePath));
  if (relativePath !== "release-manifest.json") {
    return { size: bytes.length, sha256: sha256(bytes) };
  }
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("Release evidence manifest is not valid JSON.");
  }
  if (!manifest || typeof manifest !== "object" || !manifest.git || typeof manifest.git !== "object") {
    fail("Release evidence manifest has an unexpected shape.");
  }
  const normalized = JSON.parse(JSON.stringify(manifest));
  delete normalized.git.commit;
  delete normalized.git.tree;
  delete normalized.git.dirty;
  // Public exports replace Replit-only package firewall URLs with the public
  // npm registry, so the public lockfile hash is intentionally different.
  if (normalized.lockfile && typeof normalized.lockfile === "object") {
    delete normalized.lockfile.sha256;
  }
  const normalizedBytes = Buffer.from(JSON.stringify(normalized));
  return {
    size: normalizedBytes.length,
    sha256: sha256(normalizedBytes),
    ignoredMetadata: ["git.commit", "git.tree", "git.dirty", "lockfile.sha256"],
  };
};

const runtimeEntries = async (root, relativeDirectory = "") => {
  const directory = relativeDirectory ? path.join(root, relativeDirectory) : root;
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = entries.map((entry) => normalizeRelativePath(
    relativeDirectory ? path.posix.join(relativeDirectory, entry.name) : entry.name,
  ));
  assertNoPathCollisions(paths, "Runtime paths");
  const result = [];
  for (const relativePath of paths.sort()) {
    const absolute = assertDestinationPath(root, relativePath);
    const info = await assertSafeExistingPath(absolute, "Runtime path");
    if (!info) fail("Runtime path disappeared during validation.");
    if (info.isDirectory()) {
      result.push({ path: relativePath, type: "directory", mode: info.mode & 0o777 });
      result.push(...await runtimeEntries(root, relativePath));
    } else if (info.isFile()) {
      const comparable = await comparableRuntimeFile(root, relativePath);
      result.push({
        path: relativePath,
        type: "file",
        mode: info.mode & 0o777,
        ...comparable,
      });
    } else {
      fail("Runtime tree contains a special file.");
    }
  }
  return result;
};

export const compareRuntimeOutputs = async ({ canonicalRoot, publicRoot }) => {
  await assertSafeDirectory(canonicalRoot, "Canonical runtime artifact");
  await assertSafeDirectory(publicRoot, "Public runtime output");
  assertDisjoint(canonicalRoot, publicRoot, "Runtime roots");
  const canonical = await runtimeEntries(canonicalRoot);
  const publicOutput = await runtimeEntries(publicRoot);
  if (JSON.stringify(canonical) !== JSON.stringify(publicOutput)) {
    const canonicalByPath = new Map(canonical.map((entry) => [entry.path, entry]));
    const publicByPath = new Map(publicOutput.map((entry) => [entry.path, entry]));
    const missing = canonical.filter((entry) => !publicByPath.has(entry.path)).map((entry) => entry.path);
    const extra = publicOutput.filter((entry) => !canonicalByPath.has(entry.path)).map((entry) => entry.path);
    const changed = canonical
      .filter((entry) => publicByPath.has(entry.path) &&
        JSON.stringify(entry) !== JSON.stringify(publicByPath.get(entry.path)))
      .map((entry) => entry.path);
    const summarize = (paths) => paths.length > 10
      ? `${paths.slice(0, 10).join(", ")} (+${paths.length - 10} more)`
      : paths.join(", ") || "none";
    fail(
      "Canonical and public runtime outputs are not exactly equivalent. " +
      `Missing: ${summarize(missing)}. Extra: ${summarize(extra)}. Changed: ${summarize(changed)}.`,
    );
  }
  return { fileCount: canonical.filter((entry) => entry.type === "file").length, entries: canonical.length };
};

export const CLEAN_ROOM_COMMANDS = Object.freeze([
  ["repo:hygiene", ["run", "repo:hygiene"]],
  ["npm ci", ["ci", "--no-audit", "--no-fund"]],
  ["db:verify", ["run", "db:verify"]],
  ["lint", ["run", "lint"]],
  ["typecheck:gate", ["run", "typecheck:gate"]],
  ["unit tests", ["run", "test:unit"]],
  ["production build", ["run", "build"]],
  ["bundle budget", ["run", "bundle:budget"]],
]);

const normalizeGitHubLockfile = async (root) => {
  const lockfilePath = path.join(root, "package-lock.json");
  if (!existsSync(lockfilePath)) return;
  const original = await readFile(lockfilePath, "utf8");
  const count = original.split(REPLIT_LOCKFILE_PREFIX).length - 1;
  const normalized = original.split(REPLIT_LOCKFILE_PREFIX).join(PUBLIC_LOCKFILE_PREFIX);
  if (normalized.includes("package-firewall.replit.local")) {
    fail("GitHub clean-room lockfile still contains an internal package firewall URL.");
  }
  if (count > 0) {
    await writeFile(lockfilePath, normalized);
    console.log(`Normalized ${count} Replit firewall lockfile URLs in disposable clean room.`);
  }
};

const runQualityGates = async (root, paths) => {
  await mkdir(path.join(root, ".home"), { recursive: true });
  await mkdir(path.join(root, ".tmp"), { recursive: true });
  await mkdir(path.join(root, ".npm-cache"), { recursive: true });
  const env = buildCommandEnvironment(root, "quality");
  await normalizeGitHubLockfile(root);
  const beforeInstall = await fileState(root, paths);
  run(root, "npm", CLEAN_ROOM_COMMANDS[0][1], CLEAN_ROOM_COMMANDS[0][0], env);
  run(root, "npm", CLEAN_ROOM_COMMANDS[1][1], CLEAN_ROOM_COMMANDS[1][0], env);
  await assertTrackedFilesUnchanged(root, paths, beforeInstall);
  for (const [label, args] of CLEAN_ROOM_COMMANDS.slice(2)) {
    const commandEnv = label === "production build"
      ? buildProductionEnvironment(root)
      : env;
    run(root, "npm", args, label, commandEnv);
  }
  await assertTrackedFilesUnchanged(root, paths, beforeInstall);
};

const makeTemporaryRoot = async (sourceRoot, requestedRoot) => {
  if (!requestedRoot) {
    const root = await mkdtemp(path.join(os.tmpdir(), "referral-public-clean-room-"));
    await assertSafeDirectory(root, "Temporary root");
    return { root, owned: true };
  }
  const root = absolutePath(requestedRoot, "Temporary root");
  assertOutside(root, sourceRoot, "Temporary root");
  await assertSafeDirectory(root, "Temporary root", { allowMissing: true });
  if (existsSync(root)) {
    const entries = await readdir(root);
    if (entries.length > 0) fail("Temporary root must be empty.");
    const ownedRoot = await mkdtemp(path.join(root, "referral-public-clean-room-"));
    await assertSafeDirectory(ownedRoot, "Owned temporary root");
    return { root: ownedRoot, owned: true };
  } else {
    await mkdir(root, { recursive: true });
    await assertSafeDirectory(root, "Temporary root");
  }
  return { root, owned: true };
};

export const parseCli = (argv) => {
  let sourceRoot = process.cwd();
  let publicCheckout = false;
  let temporaryRoot;
  let canonicalArtifact;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = () => {
      const value = argv[++index];
      if (!value || value.startsWith("--")) fail("Clean-room option is missing a value.");
      return value;
    };
    if (argument === "--public-checkout") publicCheckout = true;
    else if (argument === "--source-root") sourceRoot = next();
    else if (argument.startsWith("--source-root=")) sourceRoot = argument.slice("--source-root=".length);
    else if (argument === "--temp-root") temporaryRoot = next();
    else if (argument.startsWith("--temp-root=")) temporaryRoot = argument.slice("--temp-root=".length);
    else if (argument === "--canonical-artifact") canonicalArtifact = next();
    else if (argument.startsWith("--canonical-artifact=")) canonicalArtifact = argument.slice("--canonical-artifact=".length);
    else fail("Clean-room received an unsupported option.");
  }
  return {
    sourceRoot: absolutePath(sourceRoot, "Source root"),
    publicCheckout,
    temporaryRoot: temporaryRoot ? absolutePath(temporaryRoot, "Temporary root") : undefined,
    canonicalArtifact: canonicalArtifact ? absolutePath(canonicalArtifact, "Canonical artifact") : undefined,
  };
};

const main = async () => {
  const options = parseCli(process.argv.slice(2));
  await assertSafeDirectory(options.sourceRoot, "Source checkout");
  if (options.canonicalArtifact) {
    assertOutside(options.canonicalArtifact, options.sourceRoot, "Canonical artifact");
    await assertSafeDirectory(options.canonicalArtifact, "Canonical artifact");
  }
  const sourceBefore = await sourceState(options.sourceRoot);
  assertSourceClean(sourceBefore);
  const canonicalMode =
    !options.publicCheckout &&
    existsSync(path.join(options.sourceRoot, "scripts", "deterministic-export.mjs")) &&
    existsSync(path.join(options.sourceRoot, "scripts", "export-manifests", "public.json"));
  const temporary = await makeTemporaryRoot(options.sourceRoot, options.temporaryRoot);
  const publicRoot = canonicalMode ? path.join(temporary.root, "public") : temporary.root;
  if (options.canonicalArtifact) {
    assertDisjoint(options.canonicalArtifact, temporary.root, "Canonical artifact and temporary root");
  }
  try {
    if (canonicalMode) {
      const exporter = path.join(options.sourceRoot, "scripts", "deterministic-export.mjs");
      const exportEnvironment = buildCommandEnvironment(options.sourceRoot, "export");
      run(
        options.sourceRoot,
        process.execPath,
        [exporter, "public", "--destination", publicRoot],
        "deterministic public export",
        exportEnvironment,
      );
    } else {
      await mkdir(publicRoot, { recursive: true });
      await copyTrackedFiles(options.sourceRoot, publicRoot, sourceBefore.paths);
      const manifest = await buildIntegrityManifest({
        root: publicRoot,
        paths: sourceBefore.paths,
        commit: sourceBefore.commit,
        tree: sourceBefore.tree,
      });
      await writeFile(path.join(publicRoot, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    }

    const manifest = JSON.parse(await readFile(path.join(publicRoot, MANIFEST_NAME), "utf8"));
    if (
      manifest.schemaVersion !== 2 ||
      manifest.manifestType !== "export-integrity" ||
      manifest.exportType !== "public" ||
      !Array.isArray(manifest.files) ||
      manifest.fileCount !== manifest.files.length
    ) {
      fail("Public integrity manifest is invalid.");
    }
    initializeAndStage(publicRoot, manifest);
    await runQualityGates(publicRoot, manifest.files.map((entry) => normalizeRelativePath(entry.path)));
    if (options.canonicalArtifact) {
      const comparison = await compareRuntimeOutputs({
        canonicalRoot: options.canonicalArtifact,
        publicRoot: path.join(publicRoot, "dist"),
      });
      console.log(
        `Canonical/public runtime equivalence passed: ${comparison.fileCount} files; ` +
        `${comparison.entries} entries.`,
      );
    }
    console.log(
      `Public clean-room validation passed: ${manifest.fileCount} files; ${manifest.totalBytes} bytes; ` +
      "manifest unstaged; canonical source unchanged.",
    );
  } finally {
    await assertSourceUnchanged(options.sourceRoot, sourceBefore);
    const temporaryInfo = await assertSafeExistingPath(temporary.root, "Owned temporary root");
    if (!temporaryInfo?.isDirectory()) fail("Owned temporary root is unavailable for cleanup.");
    await rm(temporary.root, { recursive: true, force: true });
  }
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(`PUBLIC CLEAN-ROOM FAILURE: ${error instanceof Error ? error.message : "validation stopped safely."}`);
    process.exitCode = 1;
  });
}
