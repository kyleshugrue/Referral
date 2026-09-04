import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GeocodingService } from './geocoding';

describe('GeocodingService provider boundary', () => {
  const originalApiKey = process.env.VITE_GOOGLE_MAPS_API_KEY;
  const originalFetch = globalThis.fetch;
  let service: GeocodingService;

  beforeEach(() => {
    process.env.VITE_GOOGLE_MAPS_API_KEY = 'test-key';
    service = new GeocodingService();
  });

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.VITE_GOOGLE_MAPS_API_KEY;
    } else {
      process.env.VITE_GOOGLE_MAPS_API_KEY = originalApiKey;
    }
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('uses the fixed provider origin and disables redirects', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      status: 'OK',
      results: [{ geometry: { location: { lat: 40.7, lng: -74 } } }],
    }), {
      status: 200,
      headers: { 'content-length': '80' },
    }));
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(service.geocodeLocation('unlisted place 1')).resolves.toEqual({
      lat: 40.7,
      lng: -74,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: 'https://maps.googleapis.com',
        pathname: '/maps/api/geocode/json',
      }),
      expect.objectContaining({ redirect: 'error' }),
    );
  });

  it('fails closed to fallback coordinates on an oversized provider response', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', {
      status: 200,
      headers: { 'content-length': String(64 * 1024 + 1) },
    }));
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(service.geocodeLocation('unlisted place 2')).resolves.toBeNull();
  });

  it('fails closed to fallback coordinates when the provider aborts', async () => {
    const fetchMock = vi.fn(async () => {
      throw new DOMException('aborted', 'AbortError');
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(service.geocodeLocation('unlisted place 3')).resolves.toBeNull();
  });
});