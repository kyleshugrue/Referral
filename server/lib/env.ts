import dotenv from 'dotenv';
import path from 'node:path';
import { z } from 'zod';

const nodeEnvironmentSchema = z.enum(['development', 'test', 'production']);
const sameSiteSchema = z.enum(['lax', 'strict', 'none']);

export type ServerEnvironment = {
  nodeEnv: z.infer<typeof nodeEnvironmentSchema>;
  port: number;
  databaseUrl?: string;
  sessionSecret?: string;
  jwtSecret?: string;
  jwtRefreshSecret?: string;
  internalApiSecret?: string;
  firebaseProjectId?: string;
  firebaseClientEmail?: string;
  firebasePrivateKey?: string;
  allowedOrigins: string[];
  trustProxyHops?: number;
  sessionMaxAgeMs: number;
  sessionSameSite: z.infer<typeof sameSiteSchema>;
  jsonBodyLimitBytes: number;
  urlencodedBodyLimitBytes: number;
  internalBodyLimitBytes: number;
  rateLimitMode: 'memory' | 'single-instance' | 'postgres';
  smokeTestEnabled: boolean;
};

let projectEnvironmentLoaded = false;

/**
 * Load the optional local file without overriding platform-provided values.
 *
 * This runs from the database module before it checks DATABASE_URL, which
 * avoids relying on the order of top-level statements in server/index.ts.
 */
export function loadProjectEnvironment(): void {
  if (projectEnvironmentLoaded) return;
  projectEnvironmentLoaded = true;
  // `.env` is the documented local configuration file. Keep `keys.env` as a
  // non-overriding compatibility fallback for existing Replit workspaces.
  // Process-provided values always win because dotenv does not override them.
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });
  dotenv.config({ path: path.resolve(process.cwd(), 'keys.env') });
}

function parseBoundedInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return defaultValue;
  if (!/^\d+$/.test(raw.trim())) {
    throw new Error(`${name} must be a whole number between ${minimum} and ${maximum}.`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be a whole number between ${minimum} and ${maximum}.`);
  }
  return value;
}

function requiredSecret(
  env: NodeJS.ProcessEnv,
  name: string,
  isProduction: boolean,
): string | undefined {
  const value = env[name]?.trim();
  if (isProduction && (!value || value.length < 32)) {
    throw new Error(`${name} must be configured with at least 32 characters in production.`);
  }
  return value || undefined;
}

function validateDatabaseUrl(value: string | undefined, isProduction: boolean): string | undefined {
  if (!value) {
    if (isProduction) throw new Error('DATABASE_URL must be configured in production.');
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error('DATABASE_URL must use the PostgreSQL protocol.');
  }
  return value;
}

function validateOrigins(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  const origins = raw.split(',').map((origin) => origin.trim()).filter(Boolean);
  for (const origin of origins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error('ALLOWED_ORIGINS contains an invalid URL.');
    }
    if (!['http:', 'https:', 'capacitor:', 'ionic:'].includes(parsed.protocol)) {
      throw new Error('ALLOWED_ORIGINS contains an unsupported origin protocol.');
    }
    if (parsed.pathname !== '' && parsed.pathname !== '/') {
      throw new Error('ALLOWED_ORIGINS entries must not contain a path.');
    }
    if (parsed.search || parsed.hash) {
      throw new Error('ALLOWED_ORIGINS entries must be origins without a query or fragment.');
    }
  }
  return origins;
}

export function parseServerEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  options: { isProduction?: boolean } = {},
): ServerEnvironment {
  const nodeEnvResult = nodeEnvironmentSchema.safeParse(env.NODE_ENV || 'development');
  if (!nodeEnvResult.success) {
    throw new Error('NODE_ENV must be development, test, or production.');
  }
  const isProduction = options.isProduction ?? nodeEnvResult.data === 'production';
  const defaultPort = env.REPLIT_CLUSTER || env.REPL_ID || env.REPL_SLUG ? 5000 : 3001;
  const rateLimitMode = env.RATE_LIMIT_MODE || (isProduction ? '' : 'memory');
  if (!['memory', 'single-instance', 'postgres'].includes(rateLimitMode)) {
    throw new Error('RATE_LIMIT_MODE must be memory, single-instance, or postgres.');
  }
   if (isProduction && !['single-instance', 'postgres'].includes(rateLimitMode)) {
    throw new Error('Production requires RATE_LIMIT_MODE=single-instance or postgres.');
  }
  if (env.SMOKE_TEST === 'true' && env.CI !== 'true') {
    throw new Error('SMOKE_TEST is only permitted when CI=true.');
  }

  const sessionSameSiteResult = sameSiteSchema.safeParse(env.SESSION_COOKIE_SAMESITE || 'lax');
  if (!sessionSameSiteResult.success) {
    throw new Error('SESSION_COOKIE_SAMESITE must be lax, strict, or none.');
  }

  return {
    nodeEnv: nodeEnvResult.data,
    port: parseBoundedInteger(env, 'PORT', defaultPort, 1, 65535),
    databaseUrl: validateDatabaseUrl(env.DATABASE_URL, isProduction),
    sessionSecret: requiredSecret(env, 'SESSION_SECRET', isProduction),
    jwtSecret: requiredSecret(env, 'JWT_SECRET', isProduction),
    jwtRefreshSecret: requiredSecret(env, 'JWT_REFRESH_SECRET', false),
    internalApiSecret: requiredSecret(env, 'INTERNAL_API_SECRET', false),
    firebaseProjectId: env.FIREBASE_PROJECT_ID?.trim() || undefined,
    firebaseClientEmail: env.FIREBASE_CLIENT_EMAIL?.trim() || undefined,
    firebasePrivateKey: env.FIREBASE_PRIVATE_KEY?.trim() || undefined,
    allowedOrigins: validateOrigins(env.ALLOWED_ORIGINS),
    trustProxyHops: env.TRUST_PROXY_HOPS === undefined
      ? undefined
      : parseBoundedInteger(env, 'TRUST_PROXY_HOPS', 0, 0, 10),
    sessionMaxAgeMs: parseBoundedInteger(
      env,
      'SESSION_MAX_AGE_MS',
      30 * 24 * 60 * 60 * 1000,
      5 * 60 * 1000,
      90 * 24 * 60 * 60 * 1000,
    ),
    sessionSameSite: sessionSameSiteResult.data,
    jsonBodyLimitBytes: parseBoundedInteger(env, 'JSON_BODY_LIMIT_BYTES', 256 * 1024, 1024, 2 * 1024 * 1024),
    urlencodedBodyLimitBytes: parseBoundedInteger(env, 'URLENCODED_BODY_LIMIT_BYTES', 128 * 1024, 1024, 2 * 1024 * 1024),
    internalBodyLimitBytes: parseBoundedInteger(env, 'INTERNAL_BODY_LIMIT_BYTES', 64 * 1024, 1024, 512 * 1024),
    rateLimitMode: rateLimitMode as ServerEnvironment['rateLimitMode'],
    smokeTestEnabled: env.CI === 'true' && env.SMOKE_TEST === 'true',
  };
}