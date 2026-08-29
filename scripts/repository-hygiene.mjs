#!/usr/bin/env node

/**
 * Fail-closed repository hygiene gate.
 *
 * This checks the Git index, not the whole workspace. Local uploads, Agent
 * state, and Replit working files may remain on disk, but they must never be
 * tracked. Binary files are allowed only when their exact SHA-256 is recorded
 * in scripts/repository-hygiene-allowlist.json.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const manifestPath = resolve(root, "scripts/repository-hygiene-allowlist.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const tracked = execFileSync("git", ["ls-files", "-z"], {
  cwd: root,
  encoding: "utf8",
}).split("\0").filter(Boolean);

const violations = [];
const trackedSet = new Set(tracked);

const addViolation = (category, file) => {
  violations.push({ category, file });
};

const bannedPath = /(^|\/)(?:attached_assets|\.agents|\.agent-state|\.local|replit_agent|uploads|archive|business|functions|dist|node_modules|portfolio-export|test-results|playwright-report|blob-report|\.cache|\.config|\.upm)(\/|$)/i;
const bannedFilename = /(^|\/)(?:\.env(?:\..*)?|.*\.(?:log|zip|tar|gz|tgz|bak|new|old|disabled|pem|p12|key|dump|pdf|doc|docx|rtf)|cookies?\.txt|.*(?:prompt|transcript).*)$/i;
const safeEnvironmentFiles = new Set([".env.example", ".env.local.example"]);

const binaryMimes = new Set([
  "application/octet-stream",
  "application/pdf",
  "application/zip",
  "audio/",
  "font/",
  "image/",
  "video/",
]);

const isBinary = (file) => {
  const mime = execFileSync("file", ["--mime-type", "-b", file], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  return [...binaryMimes].some((prefix) => mime === prefix || mime.startsWith(prefix));
};

const sha256 = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

for (const file of tracked) {
  const absolute = resolve(root, file);
  const normalized = relative(root, absolute).split(sep).join("/");

  if (normalized !== file || normalized.startsWith("../") || normalized.startsWith("/")) {
    addViolation("unsafe-path", file);
    continue;
  }

  let stat;
  try {
    stat = lstatSync(absolute);
  } catch {
    addViolation("missing-tracked-file", file);
    continue;
  }

  if (stat.isSymbolicLink()) {
    addViolation("symlink", file);
    continue;
  }
  if (!stat.isFile()) {
    addViolation("special-file", file);
    continue;
  }

  if (bannedPath.test(file)) addViolation("banned-directory", file);
  const basename = file.split("/").at(-1);
  if (bannedFilename.test(file) && !safeEnvironmentFiles.has(basename)) {
    addViolation("banned-filename", file);
  }

  if (stat.size > manifest.maxFileBytes && !manifest.allowedBinaries[file]) {
    addViolation("oversized-file", file);
  }

  if (isBinary(absolute)) {
    const expectedHash = manifest.allowedBinaries[file];
    if (!expectedHash) {
      addViolation("unexpected-binary", file);
    } else if (sha256(absolute) !== expectedHash) {
      addViolation("binary-hash-mismatch", file);
    }
  }
}

for (const [file, expectedHash] of Object.entries(manifest.allowedBinaries)) {
  if (!trackedSet.has(file)) {
    addViolation("approved-asset-missing", file);
    continue;
  }
  const absolute = resolve(root, file);
  if (!lstatSync(absolute).isFile() || sha256(absolute) !== expectedHash) {
    addViolation("approved-asset-changed", file);
  }
}

if (violations.length > 0) {
  for (const { category, file } of violations) {
    console.error(`HYGIENE FAILURE [${category}] ${file}`);
  }
  console.error(`Repository hygiene failed with ${violations.length} finding(s).`);
  process.exit(1);
}

console.log(
  `Repository hygiene passed: ${tracked.length} tracked paths; ` +
    `${Object.keys(manifest.allowedBinaries).length} approved binary assets.`,
);