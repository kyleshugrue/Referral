/**
 * Shared, environment-agnostic log sanitization used by both the client and
 * server loggers (client/src/lib/logger.ts and server/lib/logger.ts).
 *
 * Two layers of protection, because either one alone is insufficient:
 *  1. Key-based redaction: object properties whose *key* matches a known
 *     sensitive name (password, token, email, uid, ...) are replaced,
 *     regardless of what the value looks like.
 *  2. Pattern-based scrubbing: every string value - whether a bare log
 *     argument, a nested object value, or an Error message - is scanned for
 *     shapes that indicate sensitive content (emails, JWTs, sensitive URL
 *     query params) and scrubbed even when it isn't behind a sensitive key.
 *
 * This module intentionally has no dependency on `import.meta.env` or
 * `process.env` so it can be imported unchanged from client and server code.
 */

// Substrings that mark an object key as sensitive, matched against a
// normalized (lowercased, non-alphanumeric-stripped) version of the key.
// Substring matching - rather than an exhaustive exact-name allowlist - is
// deliberate: real call sites use aliases and compound names for the same
// concept (sessionId, originalSessionId, newSessionId, tokenUid, storedUid,
// emailFromFirebase, ...) and an exact-match set requires finding and adding
// every alias by hand. A substring match catches the whole family at once.
const SENSITIVE_KEY_SUBSTRINGS = [
  'password',
  'token',
  'email',
  'uid',
  'sessionid',
  'cookie',
  'authorization',
  'phonenumber',
  'deviceid',
  'secret',
  'birthday',
  'birthdate',
  'location',
  'address',
  'message',
  'content',
  'body',
  'prompt',
  'resume',
  'connectionstring',
  'databaseurl',
  'upload',
  'url',
  'href',
  'signature',
  'stack',
  // Push-notification and messaging payloads commonly carry another user's
  // identity or private message content under keys like `sender_name`,
  // `accepter_name`, `message_preview` - these are PII/private content, not
  // operational metadata, so redact by default rather than allowlisting
  // every call site that happens to build one of these fields.
  'name',
  'preview',
];

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return SENSITIVE_KEY_SUBSTRINGS.some((needle) => normalized.includes(needle));
}

// Sensitive query-string param names that must never appear in a logged URL,
// e.g. a WebSocket connection URL carrying `?token=<JWT>` for native/mobile auth.
const SENSITIVE_URL_PARAMS = [
  'token',
  'access_token',
  'accessToken',
  'id_token',
  'idToken',
  'refresh_token',
  'refreshToken',
  'password',
  'auth',
];

// Matches email-address-shaped strings.
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Matches JWT-shaped strings (three dot-separated base64url segments).
const JWT_PATTERN = /\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;
const AUTHORIZATION_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const DATABASE_URL_PATTERN = /\bpostgres(?:ql)?:\/\/[^\s"']+/gi;
const COOKIE_PATTERN = /\b(?:set-cookie|cookie)\s*:\s*[^\r\n]+/gi;
const DATABASE_ERROR_PATTERN = /\b(?:failed query|query failed|database query failed|error executing query)\b/i;

/**
 * Scrub a plain string for embedded sensitive patterns. Used for bare string
 * log arguments, nested string values, and Error messages - anywhere a
 * sensitive value could appear that key-based redaction can't reach.
 */
export function scrubSensitiveText(text: string): string {
  let result = text;

  // Cloud storage signed URLs use several provider-specific credential
  // parameters. Keep the URL shape for diagnostics, but never retain the
  // credential-bearing values.
  result = result.replace(
    /([?&](?:x-goog-[^=&\s]+|x-amz-[^=&\s]+|googleaccessid|signature|expires)=)[^&\s]+/gi,
    '$1[REDACTED]',
  );

  for (const param of SENSITIVE_URL_PARAMS) {
    const paramPattern = new RegExp(`([?&]${param}=)[^&\\s]+`, 'gi');
    result = result.replace(paramPattern, '$1[REDACTED]');
  }

  result = result.replace(JWT_PATTERN, '[REDACTED_TOKEN]');
  result = result.replace(AUTHORIZATION_PATTERN, '[REDACTED_AUTHORIZATION]');
  result = result.replace(DATABASE_URL_PATTERN, '[REDACTED_DATABASE_URL]');
  result = result.replace(COOKIE_PATTERN, '[REDACTED_COOKIE]');
  result = result.replace(EMAIL_PATTERN, '[REDACTED_EMAIL]');

  return result;
}

function scrubErrorMessage(text: string): string {
  const scrubbed = scrubSensitiveText(text);
  // ORM/database errors can include the full SQL statement and bound
  // parameters. Those details are useful to a local debugger but are not safe
  // for production logs; retain only the stable error class.
  if (DATABASE_ERROR_PATTERN.test(scrubbed)) {
    return 'Database operation failed';
  }
  return scrubbed;
}

/**
 * Recursively sanitize a value for logging: redact object properties with a
 * sensitive key name, scrub sensitive patterns out of every string, and
 * sanitize Error messages the same way.
 */
export function sanitizeLogValue(value: unknown, seen: WeakSet<object> = new WeakSet<object>()): unknown {
  if (typeof value === 'string') {
    return scrubSensitiveText(value);
  }

  if (value instanceof Error) {
    return { name: value.name, message: scrubErrorMessage(value.message) };
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLogValue(item, seen));
  }

  if (value && typeof value === 'object') {
    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);

    const output: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(key)) {
        output[key] = val === undefined ? undefined : '[REDACTED]';
      } else {
        output[key] = sanitizeLogValue(val, seen);
      }
    }
    return output;
  }

  return value;
}

/** Sanitize an entire argument list, e.g. the `...args` of a log call. */
export function sanitizeLogArgs(args: unknown[]): unknown[] {
  return args.map((arg) => sanitizeLogValue(arg));
}
