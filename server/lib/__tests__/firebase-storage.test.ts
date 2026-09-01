import { describe, expect, it } from 'vitest';
import {
  firebaseStorageService,
  isManagedMediaObjectKey,
} from '../../services/firebase-storage';

describe('managed media object boundary', () => {
  it('accepts only supported private object prefixes and safe path components', () => {
    expect(isManagedMediaObjectKey('profile-pictures/user-7-photo.jpg')).toBe(true);
    expect(isManagedMediaObjectKey('resumes/user-7-resume.pdf')).toBe(true);
    expect(isManagedMediaObjectKey('resume-previews/user-7-page-1.jpg')).toBe(true);
    expect(isManagedMediaObjectKey('legacy/imported-photo.jpg')).toBe(true);

    expect(isManagedMediaObjectKey('../profile-pictures/photo.jpg')).toBe(false);
    expect(isManagedMediaObjectKey('profile-pictures/../photo.jpg')).toBe(false);
    expect(isManagedMediaObjectKey('/profile-pictures/photo.jpg')).toBe(false);
    expect(isManagedMediaObjectKey('profile-pictures\\photo.jpg')).toBe(false);
    expect(isManagedMediaObjectKey('profile-pictures/photo\0.jpg')).toBe(false);
    expect(isManagedMediaObjectKey('public/photo.jpg')).toBe(false);
  });

  it('round-trips stable private media references without exposing object keys', () => {
    const reference = firebaseStorageService.getPrivateMediaUrl(
      'resumes/user-7-resume.pdf',
    );
    const mediaId = reference.slice('/api/media/'.length);

    expect(reference).toMatch(/^\/api\/media\/[A-Za-z0-9_-]+$/);
    expect(firebaseStorageService.getFileNameForMediaId(mediaId))
      .toBe('resumes/user-7-resume.pdf');
    expect(() => firebaseStorageService.getFileNameForMediaId('../not-media'))
      .toThrow('Invalid managed media identifier');
  });

  it('rejects arbitrary URLs when extracting deletion candidates', () => {
    expect(firebaseStorageService.extractFileName(
      'https://attacker.invalid/profile-pictures/photo.jpg',
    )).toBeNull();
    expect(firebaseStorageService.extractFileName(
      'https://storage.googleapis.com/bucket/resumes/user-7-resume.pdf',
    )).toBe('resumes/user-7-resume.pdf');
  });
});