// Allowlist of valid client-rendered SPA routes.
// Any path not matched here is not a real page and should receive a 404 status.
// This is shared between the production static-file handler (server/index.ts)
// and the development Vite handler (server/vite.ts) so both environments behave
// consistently and crawlers never receive soft-404s.

// Debug/demo routes that exist for local development only. They must never
// resolve as real pages (200 status, indexable or not) once NODE_ENV is
// 'production' — verified unreferenced by any nav link, so they are safe to
// gate rather than delete outright.
const DEBUG_ROUTE_PATTERNS: RegExp[] = [
  /^\/auth-preview$/,
  /^\/keyboard-test$/,
  /^\/device-test$/,
  /^\/synergy-button-demo$/,
];

function isDebugRoutesEnabled(): boolean {
  return process.env.NODE_ENV !== 'production';
}

// Routes that must not be indexed by search engines.
// This covers all auth/utility pages AND every authenticated app route.
// Crawlers that do not execute JavaScript would otherwise see an indexable
// 200 HTML shell for routes that are actually behind a login wall.
const NO_INDEX_ROUTE_PATTERNS: RegExp[] = [
  // Auth / onboarding utility pages
  /^\/auth(\/.*)?$/,
  /^\/verify-email$/,
  /^\/multi-step-register$/,
  /^\/profile-completion$/,

  // Authenticated app routes – protected in the SPA but visible as 200 to
  // crawlers that don't run JavaScript.  None of these should appear in
  // search results; the public /guides page is the only indexable content.
  /^\/$/,
  /^\/matches\/suggestions$/,
  /^\/network(\/.*)?$/,
  /^\/profile$/,
  /^\/connections$/,
  /^\/chat\/[^/]+$/,
  /^\/requests$/,
  /^\/settings(\/.*)?$/,
  /^\/resume\/[^/]+(\/[^/]+)?$/,
];

export function isNoIndexRoute(urlPath: string): boolean {
  if (isDebugRoutesEnabled() && DEBUG_ROUTE_PATTERNS.some((pattern) => pattern.test(urlPath))) {
    return true;
  }
  return NO_INDEX_ROUTE_PATTERNS.some((pattern) => pattern.test(urlPath));
}

const SPA_ROUTE_PATTERNS: RegExp[] = [
  /^\/$/,
  /^\/auth(\/.*)?$/,
  /^\/verify-email$/,
  /^\/multi-step-register$/,
  /^\/profile-completion$/,
  /^\/matches\/suggestions$/,
  /^\/network\/search$/,
  /^\/network\/shared-interests$/,
  /^\/network\/shared-experience$/,
  /^\/profile$/,
  /^\/connections$/,
  /^\/chat\/[^/]+$/,
  /^\/requests$/,
  /^\/settings(\/blocked-accounts)?$/,
  /^\/resume\/[^/]+(\/[^/]+)?$/,
];

export function isSpaRoute(urlPath: string): boolean {
  if (isDebugRoutesEnabled() && DEBUG_ROUTE_PATTERNS.some((pattern) => pattern.test(urlPath))) {
    return true;
  }
  return SPA_ROUTE_PATTERNS.some((pattern) => pattern.test(urlPath));
}
