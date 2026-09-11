export class ProfileVersionConflictError extends Error {
  readonly expectedProfileVersion: number;
  readonly actualProfileVersion?: number;

  constructor(expectedProfileVersion: number, actualProfileVersion?: number) {
    super('Profile changed since this edit was started');
    this.name = 'ProfileVersionConflictError';
    this.expectedProfileVersion = expectedProfileVersion;
    this.actualProfileVersion = actualProfileVersion;
  }
}