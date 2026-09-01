import path from 'path';
import { randomBytes } from 'crypto';

/**
 * Upload validation helpers.
 *
 * These are intentionally pure/self-contained so they can be unit tested
 * without touching multer, the filesystem, or the network.
 */

export const ALLOWED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png'] as const;
export const ALLOWED_RESUME_EXTENSIONS = ['.pdf', '.doc', '.docx'] as const;

export const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png'] as const;
export const ALLOWED_RESUME_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

export const UPLOAD_LIMITS = Object.freeze({
  resumeBytes: 10 * 1024 * 1024,
  photoBytes: 25 * 1024 * 1024,
  maxFields: 20,
  maxFieldBytes: 256 * 1024,
  maxParts: 25,
  maxImagePixels: 20_000_000,
  maxPreviewPages: 5,
});

/**
 * Extract the lower-cased extension of a filename if (and only if) it is in
 * the allowed list. Returns null for anything else, including missing
 * extensions and path-traversal attempts.
 */
export function getSafeExtension(
  originalName: string,
  allowedExtensions: readonly string[]
): string | null {
  if (!originalName) return null;
  // Use only the basename so "../../etc/passwd.pdf" cannot smuggle path parts.
  const ext = path.extname(path.basename(originalName)).toLowerCase();
  return allowedExtensions.includes(ext) ? ext : null;
}

/**
 * Generate a filename that is completely independent of user input except
 * for the (validated) extension. Prevents shell metacharacters, path
 * traversal, and header-injection tricks in stored filenames.
 */
export function generateSafeFilename(
  originalName: string,
  allowedExtensions: readonly string[],
  prefix = 'upload'
): string | null {
  const ext = getSafeExtension(originalName, allowedExtensions);
  if (!ext) return null;
  return `${prefix}-${Date.now()}-${randomBytes(8).toString('hex')}${ext}`;
}

/** True when the MIME type reported by the client is in the allowed list. */
export function isAllowedMimeType(
  mimeType: string,
  allowedMimeTypes: readonly string[]
): boolean {
  return allowedMimeTypes.includes((mimeType || '').toLowerCase());
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const OLE_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/**
 * Check that a file's leading bytes match the expected signature for its
 * extension. This catches files renamed to bypass extension filters.
 * Returns true when the extension is unknown (no signature to check).
 */
export function matchesMagicBytes(buffer: Buffer, extension: string): boolean {
  const ext = extension.toLowerCase();
  switch (ext) {
    case '.pdf':
      return buffer.subarray(0, 5).toString('latin1') === '%PDF-';
    case '.png':
      return buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE);
    case '.jpg':
    case '.jpeg':
      return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    case '.docx':
      // DOCX is a ZIP container: "PK"
      return buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b;
    case '.doc':
      // Legacy Word documents use the OLE compound file signature.
      return buffer.length >= 8 && buffer.subarray(0, 8).equals(OLE_SIGNATURE);
    default:
      return true;
  }
}
