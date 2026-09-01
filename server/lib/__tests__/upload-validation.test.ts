import { describe, it, expect } from 'vitest';
import {
  getSafeExtension,
  generateSafeFilename,
  isAllowedMimeType,
  matchesMagicBytes,
  ALLOWED_IMAGE_EXTENSIONS,
  ALLOWED_RESUME_EXTENSIONS,
  ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_RESUME_MIME_TYPES,
  UPLOAD_LIMITS,
} from '../upload-validation';

describe('getSafeExtension', () => {
  it('accepts allowed resume extensions case-insensitively', () => {
    expect(getSafeExtension('resume.PDF', ALLOWED_RESUME_EXTENSIONS)).toBe('.pdf');
    expect(getSafeExtension('cv.docx', ALLOWED_RESUME_EXTENSIONS)).toBe('.docx');
    expect(getSafeExtension('old.doc', ALLOWED_RESUME_EXTENSIONS)).toBe('.doc');
  });

  it('rejects disallowed extensions', () => {
    expect(getSafeExtension('shell.sh', ALLOWED_RESUME_EXTENSIONS)).toBeNull();
    expect(getSafeExtension('page.html', ALLOWED_IMAGE_EXTENSIONS)).toBeNull();
    expect(getSafeExtension('script.js', ALLOWED_IMAGE_EXTENSIONS)).toBeNull();
    expect(getSafeExtension('archive.zip', ALLOWED_RESUME_EXTENSIONS)).toBeNull();
  });

  it('rejects missing or empty names', () => {
    expect(getSafeExtension('', ALLOWED_RESUME_EXTENSIONS)).toBeNull();
    expect(getSafeExtension('noextension', ALLOWED_RESUME_EXTENSIONS)).toBeNull();
  });

  it('neutralizes path traversal attempts', () => {
    expect(getSafeExtension('../../etc/passwd', ALLOWED_RESUME_EXTENSIONS)).toBeNull();
    // Traversal with an allowed extension: extension is fine, but only the
    // basename's extension is used — path parts never survive.
    expect(getSafeExtension('../../evil.pdf', ALLOWED_RESUME_EXTENSIONS)).toBe('.pdf');
  });
});

describe('generateSafeFilename', () => {
  it('produces a name with no user-controlled characters except the extension', () => {
    const name = generateSafeFilename('$(rm -rf ~)payload;.pdf', ALLOWED_RESUME_EXTENSIONS, 'resume');
    expect(name).not.toBeNull();
    expect(name).toMatch(/^resume-\d+-[0-9a-f]{16}\.pdf$/);
  });

  it('returns null for disallowed extensions', () => {
    expect(generateSafeFilename('evil.exe', ALLOWED_RESUME_EXTENSIONS)).toBeNull();
  });

  it('generates unique names for identical inputs', () => {
    const a = generateSafeFilename('a.pdf', ALLOWED_RESUME_EXTENSIONS);
    const b = generateSafeFilename('a.pdf', ALLOWED_RESUME_EXTENSIONS);
    expect(a).not.toBe(b);
  });
});

describe('isAllowedMimeType', () => {
  it('accepts allowed MIME types', () => {
    expect(isAllowedMimeType('application/pdf', ALLOWED_RESUME_MIME_TYPES)).toBe(true);
    expect(isAllowedMimeType('image/jpeg', ALLOWED_IMAGE_MIME_TYPES)).toBe(true);
    expect(isAllowedMimeType('IMAGE/PNG', ALLOWED_IMAGE_MIME_TYPES)).toBe(true);
  });

  it('rejects disallowed and missing MIME types', () => {
    expect(isAllowedMimeType('text/html', ALLOWED_IMAGE_MIME_TYPES)).toBe(false);
    expect(isAllowedMimeType('application/octet-stream', ALLOWED_RESUME_MIME_TYPES)).toBe(false);
    expect(isAllowedMimeType('', ALLOWED_RESUME_MIME_TYPES)).toBe(false);
  });
});

describe('matchesMagicBytes', () => {
  it('accepts a real PDF header', () => {
    expect(matchesMagicBytes(Buffer.from('%PDF-1.7 rest of file'), '.pdf')).toBe(true);
  });

  it('rejects an HTML file renamed to .pdf', () => {
    expect(matchesMagicBytes(Buffer.from('<!DOCTYPE html><html>'), '.pdf')).toBe(false);
  });

  it('validates PNG and JPEG signatures', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
    expect(matchesMagicBytes(png, '.png')).toBe(true);
    expect(matchesMagicBytes(jpg, '.jpg')).toBe(true);
    expect(matchesMagicBytes(jpg, '.jpeg')).toBe(true);
    expect(matchesMagicBytes(png, '.jpg')).toBe(false);
    expect(matchesMagicBytes(jpg, '.png')).toBe(false);
  });

  it('validates DOC/DOCX container signatures', () => {
    const docx = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    const doc = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(matchesMagicBytes(docx, '.docx')).toBe(true);
    expect(matchesMagicBytes(doc, '.doc')).toBe(true);
    expect(matchesMagicBytes(Buffer.from('plain text'), '.docx')).toBe(false);
  });

  it('rejects truncated files', () => {
    expect(matchesMagicBytes(Buffer.from([0xff]), '.jpg')).toBe(false);
    expect(matchesMagicBytes(Buffer.alloc(0), '.png')).toBe(false);
  });
});

describe('UPLOAD_LIMITS', () => {
  it('keeps multipart and media processing bounded', () => {
    expect(UPLOAD_LIMITS).toMatchObject({
      resumeBytes: 10 * 1024 * 1024,
      photoBytes: 25 * 1024 * 1024,
      maxFields: 20,
      maxParts: 25,
      maxImagePixels: 20_000_000,
      maxPreviewPages: 5,
    });
  });
});
