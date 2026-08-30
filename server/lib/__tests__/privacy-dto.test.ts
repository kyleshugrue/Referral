import { describe, expect, it } from 'vitest';
import type { Message, User } from '@shared/schema';
import {
  toMatchDto,
  toMessageDto,
  toPublicProfileDto,
  toSelfUserDto,
} from '../privacy-dto';

const user = {
  id: 7,
  email: 'person@example.com',
  fullName: 'Example Person',
  birthday: '1990-01-01',
  title: 'Engineer',
  currentLocation: 'New York',
  currentLocationLat: '40.7',
  currentLocationLng: '-74',
  firebaseUid: 'firebase-secret',
  desiredLocations: ['Boston'],
  desiredLocationCoords: ['forbidden'],
  industry: 'Technology',
  currentCompany: 'Example Co',
  desiredCompanies: ['Other Co'],
  matchingRadius: 50,
  yearsOfExperience: 5,
  bio: 'Bio',
  photo: '/api/media/photo',
  resumeUrl: '/api/media/resume',
  resumePreviewUrls: ['/api/media/preview'],
  interests: ['Running'],
  professionalInterests: ['Systems'],
  languages: ['English'],
  educationLevel: 'Bachelor\'s Degree',
  institution: 'Example University',
  profileVisible: true,
  emailNotifications: true,
  readReceipts: true,
  emailVerificationStarted: true,
  emailVerified: true,
  registrationCompleted: true,
  hasMinimumMatchData: true,
  profileVersion: 3,
  currentSnapshotId: 10,
  initialMatchJobsQueued: true,
  initialMatchJobsQueuedAt: '2026-08-29T00:00:00.000Z',
} as User;

describe('privacy response DTOs', () => {
  it('keeps peer profiles free of identity, exact location, media, and internal fields', () => {
    const profile = toPublicProfileDto(user);

    expect(profile).toEqual({
      id: 7,
      fullName: 'Example Person',
      title: 'Engineer',
      currentLocation: 'New York',
      industry: 'Technology',
      currentCompany: 'Example Co',
      desiredLocations: ['Boston'],
      desiredCompanies: ['Other Co'],
      yearsOfExperience: 5,
      bio: 'Bio',
      photo: '/api/media/photo',
      interests: ['Running'],
      professionalInterests: ['Systems'],
      languages: ['English'],
      educationLevel: 'Bachelor\'s Degree',
      institution: 'Example University',
    });
    expect(profile).not.toHaveProperty('email');
    expect(profile).not.toHaveProperty('firebaseUid');
    expect(profile).not.toHaveProperty('resumeUrl');
    expect(profile).not.toHaveProperty('currentLocationLat');
    expect(profile).not.toHaveProperty('profileVersion');
  });

  it('allows the owner DTO to include only owner-facing private fields', () => {
    const self = toSelfUserDto(user);

    expect(self.email).toBe(user.email);
    expect(self.resumeUrl).toBe(user.resumeUrl);
    expect(self).not.toHaveProperty('firebaseUid');
    expect(self).not.toHaveProperty('currentLocationLat');
    expect(self).not.toHaveProperty('currentSnapshotId');
    expect(self).not.toHaveProperty('initialMatchJobsQueuedAt');
  });

  it('does not spread internal match or message rows', () => {
    const match = toMatchDto({
      ...user,
      matchDescription: 'Good fit',
      matchScore: 90,
      matchReasons: ['Shared interests'],
      scoreEvidence: 'secret evidence',
      generationJobKey: 'secret job',
    } as User & Record<string, unknown>);
    expect(match.matchDescription).toBe('Good fit');
    expect(match).not.toHaveProperty('scoreEvidence');
    expect(match).not.toHaveProperty('generationJobKey');

    const message = toMessageDto({
      id: 1,
      conversationId: 2,
      senderId: 7,
      receiverId: 8,
      content: 'Hello',
      createdAt: '2026-08-29T00:00:00.000Z',
      sender: user,
      receiver: { ...user, id: 8, email: 'other@example.com' },
    } as Message & { sender: User; receiver: User });
    expect(message.sender).toEqual({ id: 7, fullName: 'Example Person', photo: '/api/media/photo' });
    expect(message.sender).not.toHaveProperty('email');
    expect(message).not.toHaveProperty('firebaseUid');
  });
});