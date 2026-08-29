import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export async function verifyMigrationIntegrity({ root = process.cwd() } = {}) {
  const migrationDirectory = path.join(root, 'migrations');
  const files = (await fs.readdir(migrationDirectory))
    .filter((file) => file.endsWith('.sql'))
    .sort();
  if (files.length === 0) throw new Error('No numbered SQL migrations were found.');

  const migrations = await Promise.all(files.map(async (file, index) => {
    const match = /^(\d{4})_(.+)\.sql$/i.exec(file);
    if (!match) throw new Error(`Migration SQL filename is invalid: ${file}.`);
    if (Number(match[1]) !== index) {
      throw new Error(`Migration ordering is not contiguous at ${file}; expected ${String(index).padStart(4, '0')}.`);
    }
    const source = await fs.readFile(path.join(migrationDirectory, file));
    return { file, tag: file.slice(0, -4), sha256: sha256(source) };
  }));

  const journal = JSON.parse(await fs.readFile(path.join(migrationDirectory, 'meta', '_journal.json'), 'utf8'));
  if (journal.version !== '7' || journal.dialect !== 'postgresql' || !Array.isArray(journal.entries) || journal.entries.length !== migrations.length) {
    throw new Error('Migration journal entries do not match the SQL migration count.');
  }
  for (const [index, migration] of migrations.entries()) {
    const entry = journal.entries[index];
    if (!entry || entry.idx !== index || entry.tag !== migration.tag || entry.version !== journal.version) {
      throw new Error(`Migration journal drift at ${migration.file}.`);
    }
  }

  const manifestPath = path.join(migrationDirectory, 'migration-manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  if (manifest.version !== 1 || !Array.isArray(manifest.migrations) || manifest.migrations.length !== migrations.length) {
    throw new Error('Migration manifest has an unsupported format or incorrect migration count.');
  }
  for (const [index, migration] of migrations.entries()) {
    const recorded = manifest.migrations[index];
    if (!recorded || recorded.file !== migration.file || recorded.sha256 !== migration.sha256) {
      throw new Error(`Migration manifest checksum drift at ${migration.file}.`);
    }
  }

  return {
    journalVersion: journal.version,
    manifestSha256: sha256(await fs.readFile(manifestPath)),
    migrations,
  };
}