import { Capacitor } from '@capacitor/core';
import { NativeGeocoder, ForwardOptions, ReverseOptions } from '@capgo/nativegeocoder';
import { locationService } from '@/utils/location-service';
import config from '@/lib/config';

export interface LocationCoordinates {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

export interface LocationSearchResult {
  description: string;
  coordinates?: LocationCoordinates;
  place_id?: string;
  structured_formatting?: {
    main_text: string;
    secondary_text: string;
  };
}

export interface GeocodingResult {
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  formattedAddress?: string;
}

interface USCitySearchResult {
  formatted: string;
  name: string;
  state: string;
  lat?: string;
  lng?: string;
}

/**
 * Platform-specific location options optimized for different use cases
 */
const IOS_NATIVE_CURRENT_LOCATION_OPTIONS = {
  // Fast WiFi/cellular triangulation for instant city-level location
  // GPS not needed for "Use Current Location" button - user just needs city name
  enableHighAccuracy: false,
  timeout: 3000,        // Fail fast - 3 seconds is plenty for WiFi/cellular
  maximumAge: 30000     // Fresh data - 30 second cache for current location button
};

const WEB_CURRENT_LOCATION_OPTIONS = {
  // Web uses GPS for better accuracy since it's already slower
  enableHighAccuracy: true,
  timeout: 8000,        // Web GPS can be slower, keep reasonable timeout
  maximumAge: 600000    // 10 minute cache is fine for web
};

/**
 * Hybrid Location Service that uses:
 * - Apple MapKit (via @capgo/nativegeocoder) for iOS Capacitor apps (FREE)
 * - Google Maps API for web browsers (cost per request)
 * 
 * This provides significant cost savings for iOS users while maintaining
 * full functionality across all platforms
 * 
 * PERFORMANCE OPTIMIZATIONS:
 * - iOS native uses WiFi/cellular triangulation for 1-3 second response time
 * - Web uses GPS for better accuracy with longer timeout
 */
class HybridLocationService {
  private isIOSNative: boolean;
  private isWebPlatform: boolean;
  private googleMapsLoaded: boolean = false;
  private autocompleteService: google.maps.places.AutocompleteService | null = null;
  private geocoder: google.maps.Geocoder | null = null;

  constructor() {
    const platform = Capacitor.getPlatform();
    const isNativePlatform = Capacitor.isNativePlatform();
    
    // CRITICAL FIX: Only use Apple Maps on actual iOS native Capacitor apps
    // Web browsers (including iOS Safari/Chrome) must always use Google Maps
    this.isIOSNative = platform === 'ios' && isNativePlatform;
    this.isWebPlatform = !isNativePlatform; // Any non-native environment is web
    
    console.log('[HybridLocationService] Initialized:', {
      platform: Capacitor.getPlatform(),
      isNativePlatform: isNativePlatform,
      isIOSNative: this.isIOSNative,
      isWebPlatform: this.isWebPlatform,
      userAgent: navigator.userAgent,
      usingAppleMaps: this.isIOSNative,
      usingGoogleMaps: this.isWebPlatform
    });
  }

  /**
   * Initialize Google Maps services for web platform
   */
  private async initializeGoogleMaps(): Promise<void> {
    if (!this.isWebPlatform || this.googleMapsLoaded) return;

    try {
      // Import and initialize Google Maps
      const { Loader } = await import('@googlemaps/js-api-loader');
      const loader = new Loader({
        apiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "",
        version: "weekly",
        libraries: ["places"]
      });

      await loader.load();
      
      if (window.google?.maps?.places) {
        this.autocompleteService = new window.google.maps.places.AutocompleteService();
        this.geocoder = new window.google.maps.Geocoder();
        this.googleMapsLoaded = true;
        console.log('[HybridLocationService] Google Maps initialized successfully');
      }
    } catch (error) {
      console.error('[HybridLocationService] Failed to initialize Google Maps:', error);
       throw new Error('Failed to initialize Google Maps services', { cause: error });
    }
  }

  /**
   * Get current location using the appropriate platform service
   * OPTIMIZED FOR SPEED on iOS native - uses WiFi/cellular instead of GPS
   */
  async getCurrentLocation(): Promise<LocationCoordinates> {
    const startTime = Date.now();
    console.log('[HybridLocationService] getCurrentLocation called, platform:', {
      isIOSNative: this.isIOSNative,
      isWebPlatform: this.isWebPlatform
    });
    
    // Platform-specific options for optimal performance
    const options = this.isIOSNative 
      ? IOS_NATIVE_CURRENT_LOCATION_OPTIONS 
      : WEB_CURRENT_LOCATION_OPTIONS;
    
    console.log('[HybridLocationService] Using options:', options);
    
    try {
      const coordinates = await locationService.getCurrentPosition(options);
      const duration = Date.now() - startTime;
      
      console.log(`[HybridLocationService] ✓ Location acquired in ${duration}ms`, coordinates);
      
      return coordinates;
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`[HybridLocationService] ✗ Location failed after ${duration}ms:`, error);
      throw error;
    }
  }

  /**
   * Reverse geocoding: Convert coordinates to address
   * Uses Apple MapKit for iOS, Google Maps for web
   */
  async reverseGeocode(coordinates: LocationCoordinates): Promise<GeocodingResult | null> {
    console.log('[HybridLocationService] reverseGeocode called:', coordinates);

    if (this.isIOSNative) {
      try {
        console.log('[HybridLocationService] Using Apple MapKit for reverse geocoding');
        
        // Additional safety check - verify we're actually in a native environment
        if (typeof NativeGeocoder === 'undefined') {
          console.error('[HybridLocationService] NativeGeocoder not available - falling back to Google Maps');
          return this.reverseGeocodeWithGoogleMaps(coordinates);
        }
        
        const options: ReverseOptions = {
          latitude: coordinates.latitude,
          longitude: coordinates.longitude,
          useLocale: true,
          maxResults: 1
        };

        const response = await NativeGeocoder.reverseGeocode(options);
        
        if (response.addresses && response.addresses.length > 0) {
          const result = response.addresses[0];
          console.log('[HybridLocationService] Apple MapKit result:', result);
          
          return {
            city: result.locality || result.subAdministrativeArea,
            state: result.administrativeArea,
            country: result.countryName,
            postalCode: result.postalCode,
            formattedAddress: `${result.locality || result.subAdministrativeArea}, ${result.administrativeArea}, ${result.countryName}`
          };
        }
        
        return null;
      } catch (error) {
        console.error('[HybridLocationService] Apple MapKit reverse geocoding failed:', error);
        console.log('[HybridLocationService] Falling back to Google Maps due to Apple MapKit error');
        return this.reverseGeocodeWithGoogleMaps(coordinates);
      }
    } else {
      // Web platform - use Google Maps
      return this.reverseGeocodeWithGoogleMaps(coordinates);
    }
  }

  /**
   * Dedicated Google Maps reverse geocoding method
   */
  private async reverseGeocodeWithGoogleMaps(coordinates: LocationCoordinates): Promise<GeocodingResult | null> {
    console.log('[HybridLocationService] Using Google Maps for reverse geocoding');
    
    await this.initializeGoogleMaps();
    
    if (!this.geocoder) {
      throw new Error('Google Maps geocoding service not available');
    }

    try {
      const results = await this.geocoder.geocode({
        location: { lat: coordinates.latitude, lng: coordinates.longitude }
      });

      if (results.results.length > 0) {
        const result = results.results[0];
        console.log('[HybridLocationService] Google Maps result:', result);
        
        const cityComponent = result.address_components.find(
          component => component.types.includes('locality')
        );
        const stateComponent = result.address_components.find(
          component => component.types.includes('administrative_area_level_1')
        );
        const countryComponent = result.address_components.find(
          component => component.types.includes('country')
        );
        const postalComponent = result.address_components.find(
          component => component.types.includes('postal_code')
        );

        return {
          city: cityComponent?.long_name,
          state: stateComponent?.short_name,
          country: countryComponent?.long_name,
          postalCode: postalComponent?.long_name,
          formattedAddress: result.formatted_address
        };
      }
      
      return null;
    } catch (error) {
      console.error('[HybridLocationService] Google Maps reverse geocoding failed:', error);
      return null;
    }
  }

  /**
   * Forward geocoding: Convert address to coordinates
   * Uses Apple MapKit for iOS, Google Maps for web
   */
  async forwardGeocode(address: string): Promise<LocationCoordinates | null> {
    console.log('[HybridLocationService] forwardGeocode called:', address);

    if (this.isIOSNative) {
      try {
        console.log('[HybridLocationService] Using Apple MapKit for forward geocoding');
        
        // Additional safety check - verify we're actually in a native environment
        if (typeof NativeGeocoder === 'undefined') {
          console.error('[HybridLocationService] NativeGeocoder not available - falling back to Google Maps');
          return this.forwardGeocodeWithGoogleMaps(address);
        }
        
        const options: ForwardOptions = {
          addressString: address
        };

        const response = await NativeGeocoder.forwardGeocode(options);
        
        if (response.addresses && response.addresses.length > 0) {
          const result = response.addresses[0];
          console.log('[HybridLocationService] Apple MapKit result:', result);
          
          return {
            latitude: result.latitude,
            longitude: result.longitude
          };
        }
        
        return null;
      } catch (error) {
        console.error('[HybridLocationService] Apple MapKit forward geocoding failed:', error);
        console.log('[HybridLocationService] Falling back to Google Maps due to Apple MapKit error');
        return this.forwardGeocodeWithGoogleMaps(address);
      }
    } else {
      // Web platform - use Google Maps
      return this.forwardGeocodeWithGoogleMaps(address);
    }
  }

  /**
   * Dedicated Google Maps forward geocoding method
   */
  private async forwardGeocodeWithGoogleMaps(address: string): Promise<LocationCoordinates | null> {
    console.log('[HybridLocationService] Using Google Maps for forward geocoding');
    
    await this.initializeGoogleMaps();
    
    if (!this.geocoder) {
      throw new Error('Google Maps geocoding service not available');
    }

    try {
      const results = await this.geocoder.geocode({ address });

      if (results.results.length > 0) {
        const location = results.results[0].geometry.location;
        console.log('[HybridLocationService] Google Maps result:', location);
        
        return {
          latitude: location.lat(),
          longitude: location.lng()
        };
      }
      
      return null;
    } catch (error) {
      console.error('[HybridLocationService] Google Maps forward geocoding failed:', error);
      return null;
    }
  }

  /**
   * Search for places/locations with autocomplete
   * Uses Apple MapKit for iOS, Google Maps for web
   */
  async searchPlaces(query: string, options?: { types?: string[]; country?: string }): Promise<LocationSearchResult[]> {
    console.log('[HybridLocationService] searchPlaces called:', query);

    if (!query || query.trim().length < 2) {
      return [];
    }

    if (this.isIOSNative) {
      try {
        console.log('[HybridLocationService] Using server US cities API for iOS native place search');
        
        // Use server API for US cities autocomplete on iOS native
        return await this.searchUSCitiesAPI(query);
      } catch (error) {
        console.error('[HybridLocationService] Server US cities API failed:', error);
        console.log('[HybridLocationService] Falling back to Google Places due to server API error');
        return this.searchPlacesWithGoogleMaps(query, options);
      }
    } else {
      // Web platform - use Google Places API
      return this.searchPlacesWithGoogleMaps(query, options);
    }
  }

  /**
   * Search US cities using the server API (for iOS native)
   */
  private async searchUSCitiesAPI(query: string): Promise<LocationSearchResult[]> {
    try {
      const apiUrl = `${config.apiBaseUrl}/api/locations/search?q=${encodeURIComponent(query)}`;
      console.log('[HybridLocationService] Fetching from URL:', apiUrl);
      
      const response = await fetch(apiUrl);
      
      if (!response.ok) {
        throw new Error(`Server API error: ${response.status}`);
      }
      
      const results = await response.json();
      console.log('[HybridLocationService] US cities API results:', results.length);
      
      // Convert server results to LocationSearchResult format
      return results.map((city: USCitySearchResult) => ({
        description: city.formatted,
        coordinates: city.lat && city.lng ? {
          latitude: parseFloat(city.lat),
          longitude: parseFloat(city.lng)
        } : undefined,
        structured_formatting: {
          main_text: city.name,
          secondary_text: `${city.state}, US`
        }
      }));
    } catch (error) {
      console.error('[HybridLocationService] US cities API search failed:', error);
      throw error;
    }
  }

  /**
   * Dedicated Google Places search method
   */
  private async searchPlacesWithGoogleMaps(query: string, options?: { types?: string[]; country?: string }): Promise<LocationSearchResult[]> {
    console.log('[HybridLocationService] Using Google Places API for search');
    
    await this.initializeGoogleMaps();
    
    if (!this.autocompleteService) {
      throw new Error('Google Places service not available');
    }

    try {
      const request: google.maps.places.AutocompletionRequest = {
        input: query,
        types: options?.types || ['(cities)'],
        componentRestrictions: options?.country ? { country: options.country } : { country: 'us' }
      };

      const response = await new Promise<google.maps.places.AutocompletePrediction[]>((resolve, reject) => {
        this.autocompleteService!.getPlacePredictions(
          request,
          (predictions, status) => {
            if (status === google.maps.places.PlacesServiceStatus.OK && predictions) {
              resolve(predictions);
            } else {
              reject(new Error(`Places API error: ${status}`));
            }
          }
        );
      });

      console.log('[HybridLocationService] Google Places results:', response.length);

      return response.map(prediction => ({
        description: prediction.description,
        place_id: prediction.place_id,
        structured_formatting: {
          main_text: prediction.structured_formatting.main_text,
          secondary_text: prediction.structured_formatting.secondary_text
        }
      }));
    } catch (error) {
      console.error('[HybridLocationService] Google Places search failed:', error);
      return [];
    }
  }

  /**
   * Get coordinates for a place (used after selecting from search results)
   */
  async getPlaceCoordinates(placeId?: string, description?: string): Promise<LocationCoordinates | null> {
    if (this.isIOSNative) {
      // For iOS, use the description for forward geocoding
      if (description) {
        return await this.forwardGeocode(description);
      }
      return null;
    } else {
      // For web, use Google Places service if we have a place_id
      if (placeId) {
        await this.initializeGoogleMaps();
        
        if (!this.geocoder) {
          throw new Error('Google Maps service not available');
        }

        try {
          const results = await this.geocoder.geocode({ placeId });
          
          if (results.results.length > 0) {
            const location = results.results[0].geometry.location;
            return {
              latitude: location.lat(),
              longitude: location.lng()
            };
          }
        } catch (error) {
          console.error('[HybridLocationService] Failed to get place coordinates:', error);
        }
      }
      
      // Fallback to forward geocoding with description
      if (description) {
        return await this.forwardGeocode(description);
      }
      
      return null;
    }
  }

  /**
   * Get platform information
   */
  getPlatformInfo() {
    return {
      platform: Capacitor.getPlatform(),
      isIOSNative: this.isIOSNative,
      isWebPlatform: this.isWebPlatform,
      usingAppleMaps: this.isIOSNative,
      usingGoogleMaps: this.isWebPlatform
    };
  }

  /**
   * Check if location services are available
   */
  async checkAvailability(): Promise<boolean> {
    if (this.isIOSNative) {
      // Check if native geocoder is available
      // NativeGeocoder is available when the native plugin is installed.
      return true;
    } else {
      // Check if Google Maps can be loaded
      try {
        await this.initializeGoogleMaps();
        return this.googleMapsLoaded;
      } catch (error) {
        console.error('[HybridLocationService] Google Maps not available:', error);
        return false;
      }
    }
  }
}

// Export singleton instance
export const hybridLocationService = new HybridLocationService();
export default hybridLocationService;