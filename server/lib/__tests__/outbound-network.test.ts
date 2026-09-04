import { describe, expect, it } from 'vitest';
import {
  readBoundedResponseBody,
  validateAllowedOutboundUrl,
} from '../outbound-network';

describe('outbound network boundaries', () => {
  it.each([
    'http://127.0.0.1:8080/metadata',
    'http://169.254.169.254/latest/meta-data',
    'http://10.0.0.7/internal',
    'http://192.168.1.20/admin',
    'ftp://maps.googleapis.com/resource',
    'not-a-url',
  ])('rejects forbidden destination %s', (value) => {
    expect(() => validateAllowedOutboundUrl(value, ['https://maps.googleapis.com'])).toThrow(
      'Outbound URL is not an allowed public service',
    );
  });

  it('rejects credentials and accepts only the exact provider origin', () => {
    expect(() => validateAllowedOutboundUrl(
      'https://user:password@maps.googleapis.com/maps/api/geocode/json',
      ['https://maps.googleapis.com'],
    )).toThrow();

    expect(validateAllowedOutboundUrl(
      'https://maps.googleapis.com/maps/api/geocode/json?address=New%20York',
      ['https://maps.googleapis.com'],
    ).origin).toBe('https://maps.googleapis.com');
  });

  it('bounds response bodies using both advertised and actual size', async () => {
    await expect(readBoundedResponseBody(
      new Response('small', { headers: { 'content-length': '100' } }),
      10,
    )).rejects.toThrow('Outbound response too large');

    await expect(readBoundedResponseBody(
      new Response('this body is too large'),
      10,
    )).rejects.toThrow('Outbound response too large');
  });
});