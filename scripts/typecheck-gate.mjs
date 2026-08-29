#!/usr/bin/env node
/**
 * Zero-error TypeScript gate.
 *
 * Invoke the checked-in local compiler directly and fail unless it completes
 * successfully with no diagnostics. This deliberately has no baseline or
 * file allowlist.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const tscBin = path.resolve(
  'node_modules/.bin',
  process.platform === 'win32' ? 'tsc.cmd' : 'tsc',
);

if (!existsSync(tscBin)) {
  console.error(
    `Typecheck gate FAILED: local TypeScript binary not found at ${tscBin}.\n` +
    'Install checked-in dependencies with "npm ci"; the gate never downloads a fallback compiler.',
  );
  process.exit(1);
}

const result = spawnSync(tscBin, [], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
  env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=6144' },
});

const output = `${result.stdout || ''}${result.stderr || ''}`;

if (result.error) {
  console.error(`Typecheck gate FAILED: could not run tsc: ${result.error.message}`);
  process.exit(1);
}

if (result.signal) {
  console.error(`Typecheck gate FAILED: tsc was killed by signal ${result.signal}.`);
  console.error(output);
  process.exit(1);
}

if (result.status !== 0) {
  console.error(`Typecheck gate FAILED: tsc exited with status ${result.status}.`);
  console.error(output);
  process.exit(1);
}

if (output.trim()) {
  console.log(output.trim());
}
console.log('Typecheck gate passed: 0 TypeScript errors.');