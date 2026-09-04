/**
 * Geocoding service for converting city names to coordinates
 * and calculating distances between locations
 * Now includes ZIP code approximation for 90% cost reduction
 */

import { zipCodeGeocoder } from './zip-code-geocoder';
import {
  readBoundedResponseBody,
  validateAllowedOutboundUrl,
} from '../lib/outbound-network';

interface Coordinates {
  lat: number;
  lng: number;
}

class GeocodingService {
  private readonly cache = new Map<string, { value: Coordinates | null; expiresAt: number }>();
  private readonly inFlight = new Map<string, Promise<Coordinates | null>>();
  private providerFailures = 0;
  private providerOpenUntil = 0;
  private readonly cacheTtlMs = 15 * 60_000;
  private readonly negativeCacheTtlMs = 60_000;
  private readonly maxCacheEntries = 1000;
  private readonly providerTimeoutMs = 5000;
  private readonly circuitFailureThreshold = 5;
  private readonly circuitOpenMs = 30_000;

  /**
   * Convert a city name to coordinates using optimal geocoding strategy
   * 1. Check local cache first
   * 2. Try ZIP code approximation (90% cost savings)
   * 3. Fall back to Google Geocoding API if needed
   */
  async geocodeLocation(location: string): Promise<Coordinates | null> {
    if (!location?.trim() || location.trim().length > 200) return null;

    const normalizedLocation = location.trim().toLowerCase();
    const cached = this.cache.get(normalizedLocation);
    if (cached) {
      if (cached.expiresAt > Date.now()) return cached.value;
      this.cache.delete(normalizedLocation);
    }

    const pending = this.inFlight.get(normalizedLocation);
    if (pending) return pending;

    const operation = this.geocodeLocationUncached(location, normalizedLocation);
    this.inFlight.set(normalizedLocation, operation);
    try {
      return await operation;
    } finally {
      this.inFlight.delete(normalizedLocation);
    }
  }

  private async geocodeLocationUncached(location: string, normalizedLocation: string): Promise<Coordinates | null> {
    // Try ZIP code approximation first (massive cost savings)
    try {
      const zipCoordinates = await zipCodeGeocoder.geocodeByZip(location);
      if (zipCoordinates && this.isValidCoordinates(zipCoordinates)) {
        this.setCache(normalizedLocation, zipCoordinates);
        return zipCoordinates;
      }
    } catch (error) {
      console.warn('[GeocodingService] ZIP approximation failed', {
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      });
    }

    const fallback = this.getFallbackCoordinates(location);
    const apiKey = process.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!apiKey || Date.now() < this.providerOpenUntil) {
      this.setCache(normalizedLocation, fallback);
      return fallback;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.providerTimeoutMs);
    try {
      const requestUrl = new URL('https://maps.googleapis.com/maps/api/geocode/json');
      requestUrl.searchParams.set('address', location);
      requestUrl.searchParams.set('key', apiKey);
      validateAllowedOutboundUrl(requestUrl.toString(), ['https://maps.googleapis.com']);

      const response = await fetch(requestUrl, {
        signal: controller.signal,
        redirect: 'error',
      });
      const body = await readBoundedResponseBody(response, 64 * 1024);
      const data = JSON.parse(body) as {
        status?: string;
        results?: Array<{ geometry?: { location?: { lat?: number; lng?: number } } }>;
      };
      const providerCoordinates = data.results?.[0]?.geometry?.location;
      if (response.ok && data.status === 'OK' && providerCoordinates && this.isValidCoordinates(providerCoordinates)) {
        this.providerFailures = 0;
        this.setCache(normalizedLocation, providerCoordinates);
        return providerCoordinates;
      }
      throw new Error(`Geocoder returned ${data.status || response.status}`);
    } catch (error) {
      this.providerFailures++;
      if (this.providerFailures >= this.circuitFailureThreshold) {
        this.providerOpenUntil = Date.now() + this.circuitOpenMs;
      }
      console.warn('[GeocodingService] Provider request failed', {
        errorClass: error instanceof Error ? error.name : 'UnknownError',
        circuitOpen: Date.now() < this.providerOpenUntil,
      });
      this.setCache(normalizedLocation, fallback);
      return fallback;
    } finally {
      clearTimeout(timeout);
    }
  }

  private setCache(key: string, value: Coordinates | null): void {
    if (this.cache.size >= this.maxCacheEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + (value ? this.cacheTtlMs : this.negativeCacheTtlMs),
    });
  }

  private isValidCoordinates(value: Partial<Coordinates>): value is Coordinates {
    return Number.isFinite(value.lat) &&
      Number.isFinite(value.lng) &&
      value.lat! >= -90 &&
      value.lat! <= 90 &&
      value.lng! >= -180 &&
      value.lng! <= 180;
  }

  /**
   * Calculate the distance between two coordinates using the Haversine formula
   * Returns distance in miles
   */
  calculateDistance(coord1: Coordinates, coord2: Coordinates): number {
    const R = 3959; // Earth's radius in miles
    const dLat = this.toRadians(coord2.lat - coord1.lat);
    const dLng = this.toRadians(coord2.lng - coord1.lng);
    
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(coord1.lat)) * Math.cos(this.toRadians(coord2.lat)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    
    return Math.round(distance * 100) / 100; // Round to 2 decimal places
  }

  /**
   * Check if two locations are within the specified radius
   */
  async isWithinRadius(location1: string, location2: string, radiusMiles: number): Promise<boolean> {
    if (!location1 || !location2 || radiusMiles < 0) return false;
    
    // Exact match always counts as within radius
    if (location1.toLowerCase().trim() === location2.toLowerCase().trim()) {
      return true;
    }

    const coord1 = await this.geocodeLocation(location1);
    const coord2 = await this.geocodeLocation(location2);
    
    if (!coord1 || !coord2) {
      console.warn('[GeocodingService] Could not geocode one or more locations');
      // Fall back to exact string matching if geocoding fails
      return location1.toLowerCase().trim() === location2.toLowerCase().trim();
    }
    
    const distance = this.calculateDistance(coord1, coord2);
    console.log(`[GeocodingService] Distance between ${location1} and ${location2}: ${distance} miles (radius: ${radiusMiles})`);
    
    return distance <= radiusMiles;
  }

  /**
   * Check if any location in the desired locations array is within radius of the current location
   */
  async isAnyLocationWithinRadius(currentLocation: string, desiredLocations: string[], radiusMiles: number): Promise<boolean> {
    if (!currentLocation || !desiredLocations?.length || radiusMiles < 0) return false;

    for (const desiredLocation of desiredLocations) {
      const isWithin = await this.isWithinRadius(currentLocation, desiredLocation, radiusMiles);
      if (isWithin) {
        console.log(`[GeocodingService] ${currentLocation} is within ${radiusMiles} miles of ${desiredLocation}`);
        return true;
      }
    }
    
    return false;
  }

  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  /**
   * Get ZIP code geocoding statistics
   */
  getZipCodeStats(): { totalZipCodes: number; initialized: boolean } {
    return zipCodeGeocoder.getStats();
  }

  /**
   * Check if location has ZIP code for optimization tracking
   */
  hasZipCode(location: string): boolean {
    return zipCodeGeocoder.hasZipCode(location);
  }

  /**
   * Fallback coordinates for major cities when geocoding fails
   */
  private getFallbackCoordinates(location: string): Coordinates | null {
    const fallbackCoordinates: Record<string, Coordinates> = {
      'new york, ny, usa': { lat: 40.7128, lng: -74.0060 },
      'los angeles, ca, usa': { lat: 34.0522, lng: -118.2437 },
      'chicago, il, usa': { lat: 41.8781, lng: -87.6298 },
      'houston, tx, usa': { lat: 29.7604, lng: -95.3698 },
      'phoenix, az, usa': { lat: 33.4484, lng: -112.0740 },
      'philadelphia, pa, usa': { lat: 39.9526, lng: -75.1652 },
      'san antonio, tx, usa': { lat: 29.4241, lng: -98.4936 },
      'san diego, ca, usa': { lat: 32.7157, lng: -117.1611 },
      'dallas, tx, usa': { lat: 32.7767, lng: -96.7970 },
      'san jose, ca, usa': { lat: 37.3382, lng: -121.8863 },
      'austin, tx, usa': { lat: 30.2672, lng: -97.7431 },
      'fort worth, tx, usa': { lat: 32.7555, lng: -97.3308 },
      'columbus, oh, usa': { lat: 39.9612, lng: -82.9988 },
      'charlotte, nc, usa': { lat: 35.2271, lng: -80.8431 },
      'san francisco, ca, usa': { lat: 37.7749, lng: -122.4194 },
      'indianapolis, in, usa': { lat: 39.7684, lng: -86.1581 },
      'seattle, wa, usa': { lat: 47.6062, lng: -122.3321 },
      'denver, co, usa': { lat: 39.7392, lng: -104.9903 },
      'washington, dc, usa': { lat: 38.9072, lng: -77.0369 },
      'boston, ma, usa': { lat: 42.3601, lng: -71.0589 },
      'el paso, tx, usa': { lat: 31.7619, lng: -106.4850 },
      'detroit, mi, usa': { lat: 42.3314, lng: -83.0458 },
      'nashville, tn, usa': { lat: 36.1627, lng: -86.7816 },
      'portland, or, usa': { lat: 45.5152, lng: -122.6784 },
      'oklahoma city, ok, usa': { lat: 35.4676, lng: -97.5164 },
      'las vegas, nv, usa': { lat: 36.1699, lng: -115.1398 },
      'louisville, ky, usa': { lat: 38.2527, lng: -85.7585 },
      'baltimore, md, usa': { lat: 39.2904, lng: -76.6122 },
      'milwaukee, wi, usa': { lat: 43.0389, lng: -87.9065 },
      'albuquerque, nm, usa': { lat: 35.0844, lng: -106.6504 },
      'tucson, az, usa': { lat: 32.2226, lng: -110.9747 },
      'fresno, ca, usa': { lat: 36.7378, lng: -119.7871 },
      'sacramento, ca, usa': { lat: 38.5816, lng: -121.4944 },
      'kansas city, mo, usa': { lat: 39.0997, lng: -94.5786 },
      'mesa, az, usa': { lat: 33.4152, lng: -111.8315 },
      'atlanta, ga, usa': { lat: 33.7490, lng: -84.3880 },
      'virginia beach, va, usa': { lat: 36.8529, lng: -75.9780 },
      'omaha, ne, usa': { lat: 41.2565, lng: -95.9345 },
      'colorado springs, co, usa': { lat: 38.8339, lng: -104.8214 },
      'raleigh, nc, usa': { lat: 35.7796, lng: -78.6382 },
      'miami, fl, usa': { lat: 25.7617, lng: -80.1918 },
      'oakland, ca, usa': { lat: 37.8044, lng: -122.2712 },
      'minneapolis, mn, usa': { lat: 44.9778, lng: -93.2650 },
      'tulsa, ok, usa': { lat: 36.1540, lng: -95.9928 },
      'cleveland, oh, usa': { lat: 41.4993, lng: -81.6944 },
      'wichita, ks, usa': { lat: 37.6872, lng: -97.3301 },
      'arlington, tx, usa': { lat: 32.7357, lng: -97.1081 },
      'new orleans, la, usa': { lat: 29.9511, lng: -90.0715 },
      'bakersfield, ca, usa': { lat: 35.3733, lng: -119.0187 },
      'tampa, fl, usa': { lat: 27.9506, lng: -82.4572 },
      'honolulu, hi, usa': { lat: 21.3099, lng: -157.8581 },
      'aurora, co, usa': { lat: 39.7294, lng: -104.8319 },
      'anaheim, ca, usa': { lat: 33.8366, lng: -117.9143 },
      'santa ana, ca, usa': { lat: 33.7455, lng: -117.8677 },
      'st. louis, mo, usa': { lat: 38.6270, lng: -90.1994 },
      'riverside, ca, usa': { lat: 33.9533, lng: -117.3961 },
      'corpus christi, tx, usa': { lat: 27.8006, lng: -97.3964 },
      'lexington, ky, usa': { lat: 38.0406, lng: -84.5037 },
      'pittsburgh, pa, usa': { lat: 40.4406, lng: -79.9959 },
      'anchorage, ak, usa': { lat: 61.2181, lng: -149.9003 },
      'stockton, ca, usa': { lat: 37.9577, lng: -121.2908 },
      'cincinnati, oh, usa': { lat: 39.1031, lng: -84.5120 },
      'st. paul, mn, usa': { lat: 44.9537, lng: -93.0900 },
      'toledo, oh, usa': { lat: 41.6528, lng: -83.5379 },
      'greensboro, nc, usa': { lat: 36.0726, lng: -79.7920 },
      'newark, nj, usa': { lat: 40.7357, lng: -74.1724 },
      'plano, tx, usa': { lat: 33.0198, lng: -96.6989 },
      'henderson, nv, usa': { lat: 36.0395, lng: -114.9817 },
      'lincoln, ne, usa': { lat: 40.8136, lng: -96.7026 },
      'buffalo, ny, usa': { lat: 42.8864, lng: -78.8784 },
      'jersey city, nj, usa': { lat: 40.7178, lng: -74.0431 },
      'chula vista, ca, usa': { lat: 32.6401, lng: -117.0842 },
      'fort wayne, in, usa': { lat: 41.0793, lng: -85.1394 },
      'orlando, fl, usa': { lat: 28.5383, lng: -81.3792 },
      'st. petersburg, fl, usa': { lat: 27.7676, lng: -82.6403 },
      'chandler, az, usa': { lat: 33.3062, lng: -111.8413 },
      'laredo, tx, usa': { lat: 27.5306, lng: -99.4803 },
      'norfolk, va, usa': { lat: 36.8468, lng: -76.2852 },
      'durham, nc, usa': { lat: 35.9940, lng: -78.8986 },
      'madison, wi, usa': { lat: 43.0731, lng: -89.4012 },
      'lubbock, tx, usa': { lat: 33.5779, lng: -101.8552 },
      'irvine, ca, usa': { lat: 33.6846, lng: -117.8265 },
      'winston-salem, nc, usa': { lat: 36.0999, lng: -80.2442 },
      'glendale, az, usa': { lat: 33.5387, lng: -112.1860 },
      'garland, tx, usa': { lat: 32.9126, lng: -96.6389 },
      'hialeah, fl, usa': { lat: 25.8576, lng: -80.2781 },
      'reno, nv, usa': { lat: 39.5296, lng: -119.8138 },
      'chesapeake, va, usa': { lat: 36.7682, lng: -76.2875 },
      'gilbert, az, usa': { lat: 33.3528, lng: -111.7890 },
      'baton rouge, la, usa': { lat: 30.4515, lng: -91.1871 },
      'irving, tx, usa': { lat: 32.8140, lng: -96.9489 },
      'scottsdale, az, usa': { lat: 33.4942, lng: -111.9261 },
      'north las vegas, nv, usa': { lat: 36.1989, lng: -115.1175 },
      'fremont, ca, usa': { lat: 37.5485, lng: -121.9886 },
      'boise, id, usa': { lat: 43.6150, lng: -116.2023 },
      'richmond, va, usa': { lat: 37.5407, lng: -77.4360 },
      'san bernardino, ca, usa': { lat: 34.1083, lng: -117.2898 },
      'birmingham, al, usa': { lat: 33.5186, lng: -86.8104 },
      'spokane, wa, usa': { lat: 47.6587, lng: -117.4260 },
      'rochester, ny, usa': { lat: 43.1566, lng: -77.6088 },
      'des moines, ia, usa': { lat: 41.5868, lng: -93.6250 },
      'modesto, ca, usa': { lat: 37.6391, lng: -120.9969 },
      'fayetteville, nc, usa': { lat: 35.0527, lng: -78.8784 },
      'tacoma, wa, usa': { lat: 47.2529, lng: -122.4443 },
      'oxnard, ca, usa': { lat: 34.1975, lng: -119.1771 },
      'fontana, ca, usa': { lat: 34.0922, lng: -117.4350 },
      'columbus, ga, usa': { lat: 32.4609, lng: -84.9877 },
      'montgomery, al, usa': { lat: 32.3617, lng: -86.2792 },
      'moreno valley, ca, usa': { lat: 33.9425, lng: -117.2297 },
      'shreveport, la, usa': { lat: 32.5252, lng: -93.7502 },
      'aurora, il, usa': { lat: 41.7606, lng: -88.3201 },
      'yonkers, ny, usa': { lat: 40.9312, lng: -73.8988 },
      'akron, oh, usa': { lat: 41.0814, lng: -81.5190 },
      'huntington beach, ca, usa': { lat: 33.6603, lng: -117.9992 },
      'little rock, ar, usa': { lat: 34.7465, lng: -92.2896 },
      'augusta, ga, usa': { lat: 33.4735, lng: -82.0105 },
      'amarillo, tx, usa': { lat: 35.2220, lng: -101.8313 },
      'glendale, ca, usa': { lat: 34.1425, lng: -118.2551 },
      'mobile, al, usa': { lat: 30.6954, lng: -88.0399 },
      'grand rapids, mi, usa': { lat: 42.9634, lng: -85.6681 },
      'salt lake city, ut, usa': { lat: 40.7608, lng: -111.8910 },
      'tallahassee, fl, usa': { lat: 30.4518, lng: -84.2807 },
      'huntsville, al, usa': { lat: 34.7304, lng: -86.5861 },
      'grand prairie, tx, usa': { lat: 32.7460, lng: -97.0281 },
      'knoxville, tn, usa': { lat: 35.9606, lng: -83.9207 },
      'worcester, ma, usa': { lat: 42.2626, lng: -71.8023 },
      'newport news, va, usa': { lat: 37.0871, lng: -76.4730 },
      'brownsville, tx, usa': { lat: 25.9018, lng: -97.4975 },
      'overland park, ks, usa': { lat: 38.9822, lng: -94.6708 },
      'santa clarita, ca, usa': { lat: 34.3917, lng: -118.5426 },
      'providence, ri, usa': { lat: 41.8240, lng: -71.4128 },
      'garden grove, ca, usa': { lat: 33.7739, lng: -117.9415 },
      'chattanooga, tn, usa': { lat: 35.0456, lng: -85.3097 },
      'oceanside, ca, usa': { lat: 33.1959, lng: -117.3795 },
      'jackson, ms, usa': { lat: 32.2988, lng: -90.1848 },
      'fort lauderdale, fl, usa': { lat: 26.1224, lng: -80.1373 },
      'santa rosa, ca, usa': { lat: 38.4404, lng: -122.7144 },
      'rancho cucamonga, ca, usa': { lat: 34.1064, lng: -117.5931 },
      'port st. lucie, fl, usa': { lat: 27.2730, lng: -80.3582 },
      'tempe, az, usa': { lat: 33.4255, lng: -111.9400 },
      'ontario, ca, usa': { lat: 34.0633, lng: -117.6509 },
      'vancouver, wa, usa': { lat: 45.6387, lng: -122.6615 },
      'cape coral, fl, usa': { lat: 26.5629, lng: -81.9495 },
      'sioux falls, sd, usa': { lat: 43.5446, lng: -96.7311 },
      'springfield, mo, usa': { lat: 37.2153, lng: -93.2982 },
      'peoria, az, usa': { lat: 33.5806, lng: -112.2374 },
      'pembroke pines, fl, usa': { lat: 26.0070, lng: -80.2962 },
      'elk grove, ca, usa': { lat: 38.4088, lng: -121.3716 },
      'rockford, il, usa': { lat: 42.2711, lng: -89.0940 },
      'palm bay, fl, usa': { lat: 28.0345, lng: -80.5887 },
      'corona, ca, usa': { lat: 33.8753, lng: -117.5664 },
      'eugene, or, usa': { lat: 44.0521, lng: -123.0868 },
      'salem, or, usa': { lat: 44.9429, lng: -123.0351 },
      'lancaster, ca, usa': { lat: 34.6868, lng: -118.1542 },
      'salinas, ca, usa': { lat: 36.6777, lng: -121.6555 },
      'springfield, ma, usa': { lat: 42.1015, lng: -72.5898 },
      'pasadena, ca, usa': { lat: 34.1478, lng: -118.1445 },
      'fort collins, co, usa': { lat: 40.5853, lng: -105.0844 },
      'hayward, ca, usa': { lat: 37.6688, lng: -122.0808 },
      'pomona, ca, usa': { lat: 34.0555, lng: -117.7500 },
      'cary, nc, usa': { lat: 35.7915, lng: -78.7811 },
      'rockville, md, usa': { lat: 39.0840, lng: -77.1528 },
      'sandy springs, ga, usa': { lat: 33.9304, lng: -84.3733 },
      'surprise, az, usa': { lat: 33.6292, lng: -112.3679 },
      'west valley city, ut, usa': { lat: 40.6916, lng: -112.0011 },
      'torrance, ca, usa': { lat: 33.8358, lng: -118.3406 },
      'olathe, ks, usa': { lat: 38.8814, lng: -94.8191 },
      'hartford, ct, usa': { lat: 41.7658, lng: -72.6734 },
      'bridgeport, ct, usa': { lat: 41.1865, lng: -73.1952 },
      'murfreesboro, tn, usa': { lat: 35.8456, lng: -86.3903 },
      'mcallen, tx, usa': { lat: 26.2034, lng: -98.2300 },
      'thornton, co, usa': { lat: 39.8681, lng: -104.9719 },
      'concord, ca, usa': { lat: 37.9780, lng: -122.0311 },
      'paterson, nj, usa': { lat: 40.9168, lng: -74.1718 },
      'fullerton, ca, usa': { lat: 33.8704, lng: -117.9242 },
      'mesquite, tx, usa': { lat: 32.7668, lng: -96.5992 },
      'sterling heights, mi, usa': { lat: 42.5803, lng: -83.0302 },
      'carrollton, tx, usa': { lat: 32.9537, lng: -96.8903 },
      'coral springs, fl, usa': { lat: 26.2710, lng: -80.2706 },
      'stamford, ct, usa': { lat: 41.0534, lng: -73.5387 },
      'thousand oaks, ca, usa': { lat: 34.1706, lng: -118.8376 },
      'vallejo, ca, usa': { lat: 38.1041, lng: -122.2566 },
      'columbia, sc, usa': { lat: 34.0007, lng: -81.0348 },
      'abilene, tx, usa': { lat: 32.4487, lng: -99.7331 },
      'pearland, tx, usa': { lat: 29.5636, lng: -95.2861 },
      'ann arbor, mi, usa': { lat: 42.2808, lng: -83.7430 },
      'redding, ca, usa': { lat: 40.5865, lng: -122.3917 },
      'norman, ok, usa': { lat: 35.2226, lng: -97.4395 },
      'centennial, co, usa': { lat: 39.5807, lng: -104.8760 },
      'high point, nc, usa': { lat: 35.9557, lng: -80.0053 },
      'columbia, mo, usa': { lat: 38.9517, lng: -92.3341 },
      'inglewood, ca, usa': { lat: 33.9617, lng: -118.3531 },
      'richardson, tx, usa': { lat: 32.9483, lng: -96.7299 },
      'arvada, co, usa': { lat: 39.8028, lng: -105.0875 },
      'downey, ca, usa': { lat: 33.9401, lng: -118.1325 },
      'evansville, in, usa': { lat: 37.9716, lng: -87.5710 },
      'round rock, tx, usa': { lat: 30.5083, lng: -97.6789 },
      'clearwater, fl, usa': { lat: 27.9659, lng: -82.8001 },
      'peoria, il, usa': { lat: 40.6936, lng: -89.5890 },
      'carlsbad, ca, usa': { lat: 33.1581, lng: -117.3506 },
      'westminster, co, usa': { lat: 39.8367, lng: -105.0372 },
      'north charleston, sc, usa': { lat: 32.8546, lng: -79.9748 },
      'west palm beach, fl, usa': { lat: 26.7153, lng: -80.0534 },
      'lowell, ma, usa': { lat: 42.6334, lng: -71.3162 },
      'temecula, ca, usa': { lat: 33.4936, lng: -117.1484 },
      'las cruces, nm, usa': { lat: 32.3199, lng: -106.7637 },
      'miami gardens, fl, usa': { lat: 25.9420, lng: -80.2456 },
      'odessa, tx, usa': { lat: 31.8457, lng: -102.3676 },
      'midland, tx, usa': { lat: 31.9974, lng: -102.0779 },
      'manchester, nh, usa': { lat: 42.9956, lng: -71.4548 },
      'pueblo, co, usa': { lat: 38.2544, lng: -104.6091 },
      'antioch, ca, usa': { lat: 37.9785, lng: -121.8058 },
      'daly city, ca, usa': { lat: 37.7058, lng: -122.4619 },
      'frisco, tx, usa': { lat: 33.1507, lng: -96.8236 },
      'sandy, ut, usa': { lat: 40.5649, lng: -111.8389 },
      'charleston, sc, usa': { lat: 32.7765, lng: -79.9311 }
    };

    const normalizedLocation = location.toLowerCase().trim();
    const coords = fallbackCoordinates[normalizedLocation];
    
    if (coords) {
      this.setCache(normalizedLocation, coords);
      return coords;
    }
    
    console.warn('[GeocodingService] No fallback coordinates found');
    return null;
  }
}

export const geocodingService = new GeocodingService();
export { GeocodingService };