import type { RequestHandler } from 'express';
import type { DatabaseReadinessResult } from './database-readiness';

const SCHEMA_READINESS_EXEMPT_PATHS = new Set([
  '/api/health',
  '/api/ready',
  // The handler performs the internal bearer check before returning the
  // detailed schema diagnostics needed to repair an incomplete database.
  '/internal/readiness',
]);

const MAINTENANCE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Referral is temporarily unavailable</title>
    <style>
      :root { color-scheme: light; font-family: system-ui, sans-serif; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f8fafc; color: #172033; }
      main { max-width: 34rem; margin: 1.5rem; padding: 2rem; border: 1px solid #dbe3ee; border-radius: 1rem; background: white; box-shadow: 0 1rem 3rem #17203314; }
      h1 { margin-top: 0; font-size: 1.35rem; }
      p { line-height: 1.6; color: #536176; }
      code { padding: .15rem .35rem; border-radius: .35rem; background: #eef2f7; }
    </style>
  </head>
  <body>
    <main>
      <h1>Referral is temporarily unavailable</h1>
      <p>We are finishing a safe database update. Please try again shortly.</p>
      <p>System health is available at <code>/api/ready</code>.</p>
    </main>
  </body>
</html>`;

function isExemptRequest(path: string, method: string): boolean {
  return method === 'OPTIONS' || SCHEMA_READINESS_EXEMPT_PATHS.has(path);
}

export function createSchemaReadinessGate(
  getReadiness: () => DatabaseReadinessResult,
): RequestHandler {
  return (req, res, next) => {
    if (isExemptRequest(req.path, req.method)) {
      next();
      return;
    }

    const readiness = getReadiness();
    if (readiness.ready) {
      next();
      return;
    }

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Retry-After', '30');

    if (req.path.startsWith('/api/') || req.path.startsWith('/internal/') || req.path.startsWith('/ws')) {
      res.status(503).json({
        status: 'not_ready',
        reason: readiness.reason ?? 'schema-incomplete',
        code: 'SCHEMA_NOT_READY',
      });
      return;
    }

    res.status(503).type('html').send(MAINTENANCE_HTML);
  };
}