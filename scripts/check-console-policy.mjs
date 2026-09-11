#!/usr/bin/env node
/**
 * Guard the security-sensitive server boundary against new direct console
 * calls. Existing legacy files are migrated separately; files on this list
 * must use the sanitizer-aware logger instead.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const protectedFiles = [
  'server/middleware/require-complete-registration.ts',
  'server/middleware/require-admin.ts',
  'server/routes/admin.ts',
  'server/routes/api-proxy.ts',
  'server/routes/cost-analysis.ts',
  'server/routes/hybrid-locations.ts',
  'server/routes/messages.ts',
  'server/routes/notifications.ts',
  'server/routes/push-notifications.ts',
  'server/services/push-notifications.ts',
  'server/routes/zip-analysis.ts',
];

const pattern = /\bconsole\.(?:log|info|warn|error|debug)\s*\(/;
const nativeLogPattern = /\b(?:print|debugPrint|NSLog|os_log)\s*\(/;
const nativeUnsafeInterpolationPattern = /\\\(|%[@difsx]|,\s*(?:token|fcmToken|senderName|accepterName|connectionName|messagePreview|userInfo|fullName|email|error)\b/i;

function collectNativeFiles(rootDir) {
  if (!fs.existsSync(rootDir)) return [];
  const files = [];
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const absolutePath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectNativeFiles(absolutePath));
    } else if (/\.(?:swift|m|mm)$/.test(entry.name)) {
      files.push(absolutePath);
    }
  }
  return files;
}

export function findNativeLoggingViolations(fileContents) {
  const violations = [];
  for (const [file, source] of fileContents) {
    source.split(/\r?\n/).forEach((line, index) => {
      if (nativeLogPattern.test(line) && nativeUnsafeInterpolationPattern.test(line)) {
        violations.push(`${file}:${index + 1}`);
      }
    });
  }
  return violations;
}

function run() {
  const violations = [];
  for (const file of protectedFiles) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      if (pattern.test(line)) violations.push(`${file}:${index + 1}`);
    });
  }

  const nativeFiles = collectNativeFiles('ios/App/App');
  const nativeViolations = findNativeLoggingViolations(
    nativeFiles.map((file) => [file, fs.readFileSync(file, 'utf8')]),
  );
  violations.push(...nativeViolations);

  if (violations.length > 0) {
    console.error('Console policy failed. Use sanitizer-aware, status-only logging in protected boundaries:');
    console.error(violations.join('\n'));
    process.exit(1);
  }

  console.log(`Console policy passed: ${protectedFiles.length} protected server files and ${nativeFiles.length} native files checked.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run();
}