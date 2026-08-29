#!/usr/bin/env node
/**
 * Guard the security-sensitive server boundary against new direct console
 * calls. Existing legacy files are migrated separately; files on this list
 * must use the sanitizer-aware logger instead.
 */
import fs from 'node:fs';

const protectedFiles = [
  'server/middleware/require-complete-registration.ts',
  'server/middleware/require-admin.ts',
  'server/routes/admin.ts',
  'server/routes/api-proxy.ts',
  'server/routes/cost-analysis.ts',
  'server/routes/hybrid-locations.ts',
  'server/routes/messages.ts',
  'server/routes/notifications.ts',
  'server/routes/zip-analysis.ts',
];

const pattern = /\bconsole\.(?:log|info|warn|error|debug)\s*\(/;
const violations = [];
for (const file of protectedFiles) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    if (pattern.test(line)) violations.push(`${file}:${index + 1}`);
  });
}

if (violations.length > 0) {
  console.error('Console policy failed. Use server/lib/logger in protected server boundaries:');
  console.error(violations.join('\n'));
  process.exit(1);
}

console.log(`Console policy passed: ${protectedFiles.length} protected files checked.`);