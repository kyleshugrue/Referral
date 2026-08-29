import { useState, useEffect, useCallback, useMemo } from 'react';
import { locationService, LocationCoordinates } from '@/utils/location-service';

export interface UseLocationOptions {
  enableHighAccuracy?: boolean;
  timeout?: number;
  maximumAge?: number;
  watch?: boolean;
}

export interface UseLocationResult {
  position: LocationCoordinates | null;
  error: string | null;
  loading: boolean;
  supported: boolean;
  permissions: 'granted' | 'denied' | 'prompt' | 'unknown';
  getCurrentLocation: () => Promise<void>;
  requestPermissions: () => Promise<void>;
  clearError: () => void;
  platformInfo: {
    isNative: boolean;
    platform: string;
    isWeb: boolean;
  };
}

/**
 * React hook for managing location services across web and native platforms
 * Automatically handles platform detection and uses appropriate APIs
 */
export function useLocation(options: UseLocationOptions = {}): UseLocationResult {
  const [position, setPosition] = useState<LocationCoordinates | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [permissions, setPermissions] = useState<'granted' | 'denied' | 'prompt' | 'unknown'>('unknown');
  const [watchId, setWatchId] = useState<string | null>(null);

  const defaultOptions = useMemo(() => ({
    enableHighAccuracy: options.enableHighAccuracy ?? true,
    timeout: options.timeout ?? 15000,
    maximumAge: options.maximumAge ?? 600000, // 10 minutes (optimized)
    watch: options.watch
  }), [options.enableHighAccuracy, options.timeout, options.maximumAge, options.watch]);

  // Check if geolocation is supported
  const supported = typeof navigator !== 'undefined' && 'geolocation' in navigator;

  // Get platform information
  const platformInfo = locationService.getPlatformInfo();

  // Check permissions on mount
  useEffect(() => {
    const checkInitialPermissions = async () => {
      try {
        const result = await locationService.checkPermissions();
        setPermissions(result.state);
      } catch (err) {
        console.warn('Could not check location permissions:', err);
        setPermissions('unknown');
      }
    };

    if (supported) {
      checkInitialPermissions();
    }
  }, [supported]);

  // Set up position watching if enabled
  useEffect(() => {
    if (defaultOptions.watch && permissions === 'granted' && !watchId) {
      const startWatching = async () => {
        try {
          const id = await locationService.watchPosition(
            (newPosition) => {
              setPosition(newPosition);
              setError(null);
            },
            (watchError) => {
              setError(watchError.message);
            },
            defaultOptions
          );
          setWatchId(id);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to start watching location');
        }
      };

      startWatching();
    }

    // Cleanup watch on unmount or when watch is disabled
    return () => {
      if (watchId) {
        locationService.clearWatch(watchId);
        setWatchId(null);
      }
    };
  }, [defaultOptions, permissions, watchId]);

  const getCurrentLocation = useCallback(async () => {
    if (!supported) {
      setError('Geolocation is not supported by this browser');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Check permissions first
      const permissionResult = await locationService.checkPermissions();
      setPermissions(permissionResult.state);

      if (permissionResult.state === 'denied') {
        throw new Error('Location access denied. Please enable location access in your device settings.');
      }

      // Request permissions if needed
      if (permissionResult.state !== 'granted') {
        const requestResult = await locationService.requestPermissions();
        setPermissions(requestResult.state);
        
        if (requestResult.state !== 'granted') {
          throw new Error('Location permission required to access your location.');
        }
      }

      // Get current position
      const currentPosition = await locationService.getCurrentPosition(defaultOptions);
      setPosition(currentPosition);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to get location';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [supported, defaultOptions]);

  const requestPermissions = useCallback(async () => {
    if (!supported) {
      setError('Geolocation is not supported by this browser');
      return;
    }

    try {
      const result = await locationService.requestPermissions();
      setPermissions(result.state);
      
      if (result.state === 'denied') {
        setError('Location access denied. Please enable location access in your device settings.');
      } else {
        setError(null);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to request permissions';
      setError(errorMessage);
    }
  }, [supported]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    position,
    error,
    loading,
    supported,
    permissions,
    getCurrentLocation,
    requestPermissions,
    clearError,
    platformInfo,
  };
}

export default useLocation;