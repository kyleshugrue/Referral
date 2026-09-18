import { describe, expect, it } from 'vitest';
import {
  firebaseStorageService,
  extractManagedMediaObjectKey,
  isMissingStorageObjectError,
  isManagedMediaObjectKey,
  ownedMediaPrefixesForUser,
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

  it('includes migrated legacy media in the bounded erasure prefixes', () => {
    expect(ownedMediaPrefixesForUser(7)).toEqual([
      'profile-pictures/user-7-',
      'resumes/user-7-',
      'resume-previews/resumes/user-7-',
      'legacy/user-7/',
    ]);
  });

  it('rejects arbitrary URLs when extracting deletion candidates', () => {
    expect(firebaseStorageService.extractFileName(
      'https://attacker.invalid/profile-pictures/photo.jpg',
    )).toBeNull();
    expect(extractManagedMediaObjectKey(
      'https://storage.googleapis.com/referral-bucket/resumes/user-7-resume.pdf',
      'referral-bucket',
    )).toBe('resumes/user-7-resume.pdf');
    expect(extractManagedMediaObjectKey(
      'https://storage.googleapis.com/other-bucket/resumes/user-7-resume.pdf',
      'referral-bucket',
    )).toBeNull();
    expect(extractManagedMediaObjectKey(
      'https://firebasestorage.googleapis.com/v0/b/referral-bucket/o/legacy%2Fuser-7%2Fphoto.jpg',
      'referral-bucket',
    )).toBe('legacy/user-7/photo.jpg');
    expect(extractManagedMediaObjectKey(
      'https://firebasestorage.googleapis.com/v0/b/other-bucket/o/resumes%2Fuser-7-resume.pdf',
      'referral-bucket',
    )).toBeNull();
  });

  it('rejects traversal when erasing legacy local media references', async () => {
    await expect(firebaseStorageService.deleteLegacyLocalMediaForUser([
      '/uploads/../outside.txt',
    ])).rejects.toThrow('Invalid legacy media reference');
  });

  it('recognizes only provider not-found errors as already-cleaned objects', () => {
    expect(isMissingStorageObjectError({ code: 404 })).toBe(true);
    expect(isMissingStorageObjectError({ statusCode: '404' })).toBe(true);
    expect(isMissingStorageObjectError({ code: 500 })).toBe(false);
    expect(isMissingStorageObjectError(new Error('not found'))).toBe(false);
  });
});