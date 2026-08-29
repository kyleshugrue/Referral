import { verifyMigrationIntegrity } from './migration-integrity.mjs';

const result = await verifyMigrationIntegrity();
console.log(`Migration integrity verified (${result.migrations.length} SQL files; manifest ${result.manifestSha256}).`);