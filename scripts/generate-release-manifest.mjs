import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { verifyMigrationIntegrity } from './migration-integrity.mjs';

const execFile = promisify(execFileCallback);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const requireCleanTree = process.argv.includes('--require-clean-tree') || process.env.REQUIRE_CLEAN_TREE === '1';

async function git(...args) {
  try {
    return (await execFile('git', args, { encoding: 'utf8' })).stdout.trim();
  } catch {
    throw new Error(`Release evidence requires git ${args.join(' ')} to succeed.`);
  }
}

async function filesRecursively(directory, relative = '') {
  const entries = await fs.readdir(path.join(directory, relative), { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const entryRelative = path.join(relative, entry.name);
    if (entry.isDirectory()) return filesRecursively(directory, entryRelative);
    return entry.isFile() ? [entryRelative] : [];
  }));
  return files.flat();
}

const [commit, tree, status, npmVersion, pkg, lockfile, migrationIntegrity] = await Promise.all([
  git('rev-parse', 'HEAD'),
  git('rev-parse', 'HEAD^{tree}'),
  git('status', '--porcelain'),
  execFile('npm', ['--version'], { encoding: 'utf8' }).then(({ stdout }) => stdout.trim()),
  fs.readFile('package.json', 'utf8').then(JSON.parse),
  fs.readFile('package-lock.json'),
  verifyMigrationIntegrity(),
]);
const dirty = status.length > 0;
if (requireCleanTree && dirty) throw new Error('Refusing release evidence: git working tree is dirty.');

const distDirectory = path.resolve('dist');
const manifestFile = 'release-manifest.json';
const distFiles = (await filesRecursively(distDirectory))
  .map((file) => file.split(path.sep).join('/'))
  .filter((file) => file !== manifestFile)
  .sort();
const artifacts = await Promise.all(distFiles.map(async (file) => ({
  file,
  sha256: sha256(await fs.readFile(path.join(distDirectory, file))),
})));
const sourceDateEpoch = process.env.SOURCE_DATE_EPOCH;
if (sourceDateEpoch !== undefined && !/^\d+$/.test(sourceDateEpoch)) {
  throw new Error('SOURCE_DATE_EPOCH must be an integer when set.');
}

const releaseManifest = {
  schemaVersion: 1,
  git: { commit, tree, dirty },
  package: { name: pkg.name, version: pkg.version },
  runtime: { node: process.version, npm: npmVersion },
  lockfile: { file: 'package-lock.json', sha256: sha256(lockfile) },
  migrations: {
    manifest: 'migrations/migration-manifest.json',
    manifestSha256: migrationIntegrity.manifestSha256,
    files: migrationIntegrity.migrations,
  },
  artifacts,
  ...(sourceDateEpoch === undefined ? {} : { sourceDateEpoch }),
};
await fs.writeFile(path.join(distDirectory, manifestFile), `${JSON.stringify(releaseManifest, null, 2)}\n`);
console.log(`Wrote dist/${manifestFile} (${artifacts.length} artifact hashes).`);