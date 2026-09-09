import { describe, expect, it } from 'vitest';
import { zipCodeGeocoder } from './zip-code-geocoder';

describe('zipCodeGeocoder ZIP parsing', () => {
  it('recognizes plain and ZIP+4 values without repeated regex scans', () => {
    expect(zipCodeGeocoder.hasZipCode('New York, NY 10001')).toBe(true);
    expect(zipCodeGeocoder.hasZipCode('Beverly Hills, CA 90210-1234')).toBe(true);
    expect(zipCodeGeocoder.hasZipCode('London, UK')).toBe(false);
  });

  it('bounds adversarially long location input', () => {
    expect(zipCodeGeocoder.hasZipCode(`${'x'.repeat(513)} 10001`)).toBe(false);
  });
});