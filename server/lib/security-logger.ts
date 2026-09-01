import { logger } from './logger';
import type { Request } from 'express';

export interface SecurityEventMetadata {
  requestId?: string;
  userId?: number | 'unknown';
  deviceId?: string;
  ip?: string;
  userAgent?: string;
  platform?: string;
  action: string;
  details?: Record<string, unknown>;
}

export function logSecurityEvent(
  level: 'info' | 'warn' | 'error',
  eventType: string,
  metadata: SecurityEventMetadata
) {
  const timestamp = new Date().toISOString();
  
  // Use allowlist approach - only copy explicitly safe fields to prevent sensitive data leakage
  const sanitized: Record<string, unknown> = {
    timestamp,
    eventType,
  };
  
  // Allowlist of safe fields that can be logged
  const safeFields = ['requestId', 'userId', 'deviceId', 'ip', 'userAgent', 'platform', 'action'];
  
  for (const field of safeFields) {
    if (field in metadata && metadata[field as keyof SecurityEventMetadata] !== undefined) {
      sanitized[field] = metadata[field as keyof SecurityEventMetadata];
    }
  }
  
  // Sanitize details object if present - only include safe nested fields
  if (metadata.details) {
    const sensitiveKeys = ['refreshToken', 'accessToken', 'tokenHash', 'email', 'password', 'encryptionKey', 'apiKey', 'secret', 'token', 'key', 'credential'];
    const sanitizedDetails: Record<string, unknown> = {};
    
    for (const [key, value] of Object.entries(metadata.details)) {
      const lowerKey = key.toLowerCase();
      const isSensitive = sensitiveKeys.some(sensitive => lowerKey.includes(sensitive.toLowerCase()));
      if (!isSensitive) {
        sanitizedDetails[key] = value;
      }
    }
    
    if (Object.keys(sanitizedDetails).length > 0) {
      sanitized.details = sanitizedDetails;
    }
  }
  
  const logMessage = `[JWT Security Event] ${eventType}`;
  
  switch (level) {
    case 'info':
      logger.info(logMessage, sanitized);
      break;
    case 'warn':
      logger.warn(logMessage, sanitized);
      break;
    case 'error':
      logger.error(logMessage, sanitized);
      break;
  }
}

// Helper to extract request metadata
export function extractRequestMetadata(req: Request): Pick<SecurityEventMetadata, 'ip' | 'userAgent' | 'platform'> {
  return {
    // Express has already resolved the client address using the configured
    // trusted proxy ranges. Never fall back to the raw X-Forwarded-For chain.
    ip: req.ip || 'unknown',
    userAgent: req.headers?.['user-agent'] || 'unknown',
    platform: req.body?.platform || req.headers?.['x-platform'] || 'unknown',
  };
}
