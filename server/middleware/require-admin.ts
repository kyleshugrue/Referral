import type { NextFunction, Request, Response } from 'express';
import { logger } from '../lib/logger';

/**
 * Administrator authorization is deliberately separate from authentication.
 *
 * ADMIN_USER_IDS is a server-only, comma-separated allowlist of numeric
 * database user IDs. Missing or malformed configuration denies access for
 * everyone; there is no self-service or client-controlled elevation path.
 */
function configuredAdminUserIds(): ReadonlySet<number> {
  const raw = process.env.ADMIN_USER_IDS;
  if (!raw) return new Set();

  const ids = raw.split(',').map((value) => value.trim());
  if (ids.length === 0 || ids.some((value) => {
    if (!/^[1-9]\d*$/.test(value)) return true;
    const id = Number(value);
    return !Number.isSafeInteger(id) || id < 1;
  })) {
    return new Set();
  }

  return new Set(ids.map((value) => Number(value)));
}

export function isConfiguredAdministrator(userId: number | undefined): boolean {
  if (!userId || !Number.isSafeInteger(userId) || userId < 1) return false;
  return configuredAdminUserIds().has(userId);
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const userId = req.user?.id;
  if (!isConfiguredAdministrator(userId)) {
    logger.warn('[AdminAuth] Denied administrative request', {
      requestId: (req as Request & { id?: string }).id ?? 'unknown',
      userId: userId ?? 'unknown',
      path: req.path,
      method: req.method,
    });
    res.status(403).json({
      error: 'Administrator authorization required',
    });
    return;
  }

  next();
}