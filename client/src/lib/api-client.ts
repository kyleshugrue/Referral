/**
 * Secure API client for production use
 * Routes sensitive API calls through our server proxy instead of directly to external APIs
 * 
 * NOTE: AI matching is handled exclusively by the Worker VM through background job processing.
 * Direct AI match description generation has been removed from the main app for security.
 */

import config from './config.js';
import { logger } from './logger';

interface GeocodingResponse {
  success: boolean;
  coordinates?: {
    lat: number;
    lng: number;
  };
  address: string;
  error?: string;
  fallback?: boolean;
}

interface APIStatusResponse {
  api_proxy: string;
  services: {
    geocoding: { available: boolean; service: string };
    ai_matching: { available: boolean; service: string };
    firebase: { available: boolean; service: string };
  };
  timestamp: string;
}

class APIClient {
  private baseUrl: string;

  constructor() {
    // Use configuration management for base URL
    this.baseUrl = config.apiBaseUrl;
  }

  /**
   * Geocode an address using our server proxy
   * This keeps the Google Maps API key secure on the server
   */
  async geocodeAddress(address: string): Promise<GeocodingResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/api/proxy/geocode?address=${encodeURIComponent(address)}`);
      const data = await response.json();
      
      if (!response.ok) {
        logger.warn('[API Client] Geocoding failed:', data.error);
        return {
          success: false,
          address,
          error: data.error,
          fallback: true
        };
      }
      
      return data;
    } catch (error) {
      logger.error('[API Client] Geocoding request failed:', error);
      return {
        success: false,
        address,
        error: 'Network error',
        fallback: true
      };
    }
  }

  /**
   * Check API service status
   */
  async getAPIStatus(): Promise<APIStatusResponse | null> {
    try {
      const response = await fetch(`${this.baseUrl}/api/proxy/status`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      logger.error('[API Client] Status check failed:', error);
      return null;
    }
  }

  /**
   * Set base URL for production deployment
   */
  setBaseUrl(url: string) {
    this.baseUrl = url;
  }
}

// Export singleton instance
export const apiClient = new APIClient();

// For backwards compatibility, export individual functions
export const geocodeAddress = (address: string) => apiClient.geocodeAddress(address);
export const getAPIStatus = () => apiClient.getAPIStatus();