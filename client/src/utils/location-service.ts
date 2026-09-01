import { Capacitor } from '@capacitor/core';
import type { GeolocationPlugin } from '@capacitor/geolocation';

export interface LocationCoordinates {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

export interface LocationPermissionResult {
  state: 'granted' | 'denied' | 'prompt';
}

/**
 * Platform-aware location service that uses:
 * - Web Geolocation API for web browsers
 * - Capacitor Geolocation for native iOS/Android apps
 */
class LocationService {
  private isNative: boolean;
  private nativeGeolocation: GeolocationPlugin | null = null;

  constructor() {
    this.isNative = Capacitor.isNativePlatform();
  }

  private async getNativeGeolocation(): Promise<GeolocationPlugin> {
    if (!this.nativeGeolocation) {
      const { Geolocation } = await import('@capacitor/geolocation');
      this.nativeGeolocation = Geolocation;
    }
    return this.nativeGeolocation;
  }

  /**
   * Check location permissions
   */
  async checkPermissions(): Promise<LocationPermissionResult> {
    console.log('[LocationService] checkPermissions called, isNative:', this.isNative);
    
    if (this.isNative) {
      // Use Capacitor for native apps
      console.log('[LocationService] Using Capacitor for permissions check');
      const permissions = await (await this.getNativeGeolocation()).checkPermissions();
      const result = {
        state: permissions.location === 'granted' ? 'granted' as const : 
               permissions.location === 'denied' ? 'denied' as const : 'prompt' as const
      };
      console.log('[LocationService] Capacitor permissions result:', result);
      return result;
    } else {
      // Use Web API for browsers
      console.log('[LocationService] Using Web API for permissions check');
      if (!navigator.permissions) {
        console.log('[LocationService] navigator.permissions not available, returning prompt');
        return { state: 'prompt' };
      }

      try {
        const permission = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
        console.log('[LocationService] Web permissions result:', { state: permission.state });
        return { state: permission.state };
      } catch (error) {
        console.warn('[LocationService] Could not check geolocation permissions:', error);
        return { state: 'prompt' };
      }
    }
  }

  /**
   * Request location permissions
   */
  async requestPermissions(): Promise<LocationPermissionResult> {
    console.log('[LocationService] requestPermissions called, isNative:', this.isNative);
    
    if (this.isNative) {
      // Use Capacitor for native apps
      console.log('[LocationService] Using Capacitor to request permissions');
      const result = await (await this.getNativeGeolocation()).requestPermissions();
      const permissionResult = {
        state: result.location === 'granted' ? 'granted' as const : 
               result.location === 'denied' ? 'denied' as const : 'prompt' as const
      };
      console.log('[LocationService] Capacitor permission request result:', permissionResult);
      return permissionResult;
    } else {
      // For web, permissions are requested automatically when getCurrentPosition is called
      // So we just check current permissions
      console.log('[LocationService] Web platform - permissions requested automatically with getCurrentPosition');
      return this.checkPermissions();
    }
  }

  /**
   * Get current location coordinates
   */
  async getCurrentPosition(options?: {
    enableHighAccuracy?: boolean;
    timeout?: number;
    maximumAge?: number;
  }): Promise<LocationCoordinates> {
    const defaultOptions = {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 600000, // 10 minutes (optimized for performance)
      ...options
    };

    console.log('[LocationService] getCurrentPosition called, isNative:', this.isNative, 'options:', defaultOptions);

    if (this.isNative) {
      // Use Capacitor for native apps
      console.log('[LocationService] Using Capacitor to get position');
      const position = await (await this.getNativeGeolocation()).getCurrentPosition(defaultOptions);
      const result = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy
      };
      console.log('[LocationService] Capacitor position result:', result);
      return result;
    } else {
      // Use Web Geolocation API for browsers
      console.log('[LocationService] Using Web Geolocation API');
      
      if (!navigator.geolocation) {
        console.error('[LocationService] navigator.geolocation is not available');
        throw new Error('Geolocation is not supported by this browser');
      }

      console.log('[LocationService] navigator.geolocation is available, making request...');
      
      return new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const result = {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: position.coords.accuracy
            };
            console.log('[LocationService] Web geolocation success:', result);
            resolve(result);
          },
          (error) => {
            console.error('[LocationService] Web geolocation error:', error);
            let errorMessage = 'Failed to get location';
            switch (error.code) {
              case error.PERMISSION_DENIED:
                errorMessage = 'Location access denied by user';
                break;
              case error.POSITION_UNAVAILABLE:
                errorMessage = 'Location information unavailable';
                break;
              case error.TIMEOUT:
                errorMessage = 'Location request timed out';
                break;
            }
            console.error('[LocationService] Rejected with message:', errorMessage);
            reject(new Error(errorMessage));
          },
          defaultOptions
        );
      });
    }
  }

  /**
   * Watch position changes (useful for real-time location tracking)
   */
  async watchPosition(
    callback: (position: LocationCoordinates) => void,
    errorCallback?: (error: Error) => void,
    options?: {
      enableHighAccuracy?: boolean;
      timeout?: number;
      maximumAge?: number;
    }
  ): Promise<string> {
    const defaultOptions = {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 600000, // 10 minutes
      ...options
    };

    if (this.isNative) {
      // Use Capacitor for native apps
      const watchId = await (await this.getNativeGeolocation()).watchPosition(defaultOptions, (position) => {
        if (position) {
          callback({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy
          });
        }
      });
      return watchId;
    } else {
      // Use Web Geolocation API for browsers
      if (!navigator.geolocation) {
        throw new Error('Geolocation is not supported by this browser');
      }

      const watchId = navigator.geolocation.watchPosition(
        (position) => {
          callback({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy
          });
        },
        (error) => {
          let errorMessage = 'Failed to watch location';
          switch (error.code) {
            case error.PERMISSION_DENIED:
              errorMessage = 'Location access denied by user';
              break;
            case error.POSITION_UNAVAILABLE:
              errorMessage = 'Location information unavailable';
              break;
            case error.TIMEOUT:
              errorMessage = 'Location request timed out';
              break;
          }
          errorCallback?.(new Error(errorMessage));
        },
        defaultOptions
      );
      
      return watchId.toString();
    }
  }

  /**
   * Clear position watcher
   */
  async clearWatch(watchId: string): Promise<void> {
    if (this.isNative) {
      // Use Capacitor for native apps
      await (await this.getNativeGeolocation()).clearWatch({ id: watchId });
    } else {
      // Use Web Geolocation API for browsers
      if (navigator.geolocation) {
        navigator.geolocation.clearWatch(parseInt(watchId));
      }
    }
  }

  /**
   * Get platform information
   */
  getPlatformInfo() {
    return {
      isNative: this.isNative,
      platform: Capacitor.getPlatform(),
      isWeb: !this.isNative
    };
  }
}

// Export singleton instance
export const locationService = new LocationService();
export default locationService;