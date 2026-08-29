import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Ensure environment variables are loaded before anything else
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '..', 'keys.env');
dotenv.config({ path: envPath });

import { Pool as NeonPool } from '@neondatabase/serverless';
import type { Pool as PostgresPool } from 'pg';
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-serverless';
import { drizzle as drizzlePostgres } from 'drizzle-orm/node-postgres';
import type { EventEmitter } from 'node:events';
import { createDatabasePool, usesNativePostgres } from './lib/database-client';
import * as schema from "@shared/schema";
import { logger } from './lib/logger';

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Configure pool with production-safe settings to prevent connection exhaustion
export const pool = createDatabasePool({
  connectionString: process.env.DATABASE_URL,
  max: 20, // Maximum 20 connections (not unlimited)
  min: 5, // Keep 5 connections always ready
  connectionTimeoutMillis: 10000, // 10s timeout (not infinite)
  idleTimeoutMillis: 60000, // 60s idle timeout (not 0)
  maxUses: 7500, // Recycle connections after 7500 uses (prevent memory leaks)
  allowExitOnIdle: false // Keep pool alive
});

// Add pool error handler
(pool as unknown as EventEmitter).on('error', (err: unknown) => {
  // Use the sanitizing logger, not console.error: pg/neon error objects carry
  // a `connectionString` property (the full DATABASE_URL, including the
  // password) that console.error would otherwise print verbatim into logs.
  logger.error('[ConnectionPool] Unexpected pool error:', err);
  // Don't exit the process immediately, let individual queries handle errors
  const errorCode = err && typeof err === 'object' && 'code' in err ? err.code : undefined;
  if (errorCode === 'ECONNRESET' || errorCode === '57P01') {
    console.log('[ConnectionPool] Connection reset detected, pool will recover automatically');
  }
});

// Add pool metrics logging
setInterval(() => {
  console.log('[ConnectionPool] Metrics:', {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
    timestamp: new Date().toISOString()
  });
}, 60000); // Log every minute

export const db = usesNativePostgres()
  ? drizzlePostgres({ client: pool as PostgresPool, schema })
  : drizzleNeon({ client: pool as NeonPool, schema });