import type { NextFunction, Request, Response } from 'express';

const WINDOW_MS = 60_000;
const PER_USER_UNITS = 30;
const GLOBAL_UNITS = 300;

const userWindows = new Map<number, { startedAt: number; units: number }>();
let globalWindow = { startedAt: Date.now(), units: 0 };

export function geocodingQuotaLimiter(req: Request, res: Response, next: NextFunction): void {
  const userId = req.user?.id;
  if (!userId) {
    res.sendStatus(401);
    return;
  }

  const now = Date.now();
  if (now - globalWindow.startedAt >= WINDOW_MS) {
    globalWindow = { startedAt: now, units: 0 };
  }
  const userWindow = userWindows.get(userId);
  const current = !userWindow || now - userWindow.startedAt >= WINDOW_MS
    ? { startedAt: now, units: 0 }
    : userWindow;
  const requestedUnits = req.path === '/batch-process' && Array.isArray(req.body?.locations)
    ? Math.min(req.body.locations.length, 50)
    : 1;

  if (
    current.units + requestedUnits > PER_USER_UNITS ||
    globalWindow.units + requestedUnits > GLOBAL_UNITS
  ) {
    res.setHeader('Retry-After', '60');
    res.status(429).json({ error: 'Geocoding quota exceeded' });
    return;
  }

  current.units += requestedUnits;
  globalWindow.units += requestedUnits;
  userWindows.set(userId, current);
  next();
}