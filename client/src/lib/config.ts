/**
 * Configuration management for different environments
 * Handles API endpoints and security settings for development vs production
 */

import { Capacitor } from '@capacitor/core';

interface AppConfig {
  apiBaseUrl: string;
  environment: 'development' | 'production';
  isSecureContext: boolean;
  firebase: {
    apiKey: string;
    projectId: string;
    appId: string;
    storageBucket: string;
  };
}

/**
 * Production backend URL for native iOS/Android apps
 */
const PRODUCTION_BACKEND_URL = 'https://referral-mobile-app-kylejshugrue.replit.app';

/**
 * Detect environment and configure API endpoints
 */
function getEnvironmentConfig(): AppConfig {
  // Check if running on native platform (iOS/Android via Capacitor)
  const isNativePlatform = Capacitor.isNativePlatform();
  
  // For native platforms, always use the production backend URL
  if (isNativePlatform) {
    return {
      apiBaseUrl: PRODUCTION_BACKEND_URL,
      environment: 'production',
      isSecureContext: true,
      firebase: {
        apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
        projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
        appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
        storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 
                      `${import.meta.env.VITE_FIREBASE_PROJECT_ID}.appspot.com`
      }
    };
  }
  
  // For web platforms, use the existing logic
  const isDevelopment = 
    window.location.hostname === 'localhost' || 
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname.includes('replit.dev');

  const isSecure = window.location.protocol === 'https:' || isDevelopment;

  // Base URL configuration for web
  let apiBaseUrl: string;
  
  if (isDevelopment) {
    // Development: use current origin (localhost or replit dev)
    apiBaseUrl = window.location.origin;
  } else {
    // Production: use environment variable or fallback to current origin
    apiBaseUrl = import.meta.env.VITE_API_BASE_URL || window.location.origin;
  }

  return {
    apiBaseUrl,
    environment: isDevelopment ? 'development' : 'production',
    isSecureContext: isSecure,
    firebase: {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
      appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 
                    `${import.meta.env.VITE_FIREBASE_PROJECT_ID}.appspot.com`
    }
  };
}

export const config = getEnvironmentConfig();

export default config;