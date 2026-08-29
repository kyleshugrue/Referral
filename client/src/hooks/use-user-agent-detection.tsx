import { useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';

export type DeviceType = 'mobile' | 'desktop' | 'tablet';
export type OSType = 'ios' | 'android' | 'windows' | 'macos' | 'linux' | 'unknown';
export type BrowserType = 'safari' | 'chrome' | 'firefox' | 'edge' | 'opera' | 'capacitor' | 'unknown';

export interface DeviceInfo {
  deviceType: DeviceType;
  os: OSType;
  browser: BrowserType;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
}

/**
 * Parses User-Agent string to detect device information
 */
function parseUserAgent(userAgent: string): DeviceInfo {
  const ua = userAgent.toLowerCase();
  
  // Device type detection
  let deviceType: DeviceType = 'desktop';
  let isMobile = false;
  let isTablet = false;
  
  // Check for mobile devices
  if (/(iphone|ipod|android.*mobile|blackberry|iemobile|windows phone)/i.test(userAgent)) {
    deviceType = 'mobile';
    isMobile = true;
  }
  // Check for tablets
  else if (/(ipad|android(?!.*mobile)|tablet)/i.test(userAgent)) {
    deviceType = 'tablet';
    isTablet = true;
  }
  
  // OS detection
  let os: OSType = 'unknown';
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) {
    os = 'ios';
  } else if (ua.includes('android')) {
    os = 'android';
  } else if (ua.includes('windows')) {
    os = 'windows';
  } else if (ua.includes('mac')) {
    os = 'macos';
  } else if (ua.includes('linux')) {
    os = 'linux';
  }
  
  // Browser detection
  let browser: BrowserType = 'unknown';
  if (ua.includes('safari') && !ua.includes('chrome')) {
    browser = 'safari';
  } else if (ua.includes('chrome')) {
    browser = 'chrome';
  } else if (ua.includes('firefox')) {
    browser = 'firefox';
  } else if (ua.includes('edge')) {
    browser = 'edge';
  } else if (ua.includes('opera')) {
    browser = 'opera';
  }
  
  return {
    deviceType,
    os,
    browser,
    isMobile,
    isTablet,
    isDesktop: deviceType === 'desktop'
  };
}

/**
 * Hook to detect device information based on User-Agent string
 * More accurate than screen size as it detects actual device type
 */
export function useUserAgentDetection(): DeviceInfo {
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo>(() => {
    // Initialize with default values for SSR
    if (typeof window === 'undefined') {
      return {
        deviceType: 'desktop',
        os: 'unknown',
        browser: 'unknown',
        isMobile: false,
        isTablet: false,
        isDesktop: true
      };
    }
    
    // Check if we're running in iOS native Capacitor app first for initial state
    try {
      if (Capacitor.getPlatform() === 'ios' && Capacitor.isNativePlatform()) {
        return {
          deviceType: 'mobile',
          os: 'ios',
          browser: 'capacitor',
          isMobile: true,
          isTablet: false,
          isDesktop: false
        };
      }
    } catch {
      // Capacitor not available, continue with normal detection
    }
    
    return parseUserAgent(navigator.userAgent);
  });
  
  useEffect(() => {
    // Only run on client side
    if (typeof window !== 'undefined') {
      // Check if we're running in iOS native Capacitor app first
      // If so, always force mobile view regardless of device size
      try {
        if (Capacitor.getPlatform() === 'ios' && Capacitor.isNativePlatform()) {
          setDeviceInfo({
            deviceType: 'mobile',
            os: 'ios',
            browser: 'capacitor',
            isMobile: true,
            isTablet: false,
            isDesktop: false
          });
          return;
        }
      } catch {
        // Capacitor not available, continue with normal detection
      }
      
      const info = parseUserAgent(navigator.userAgent);
      setDeviceInfo(info);
    }
  }, []);
  
  return deviceInfo;
}

/**
 * Simple hook that returns just the device type (mobile/tablet/desktop)
 * Compatible with existing useDeviceType hook
 */
export function useDeviceTypeUA(): DeviceType {
  const { deviceType } = useUserAgentDetection();
  return deviceType;
}

/**
 * Simple hook that returns whether device is mobile
 * Compatible with existing useIsMobile hook
 */
export function useIsMobileUA(): boolean {
  const { isMobile } = useUserAgentDetection();
  return isMobile;
}

/**
 * Utility function to get device info synchronously (for use in components)
 * Use this for one-time checks where you don't need reactive updates
 */
export function getDeviceInfo(): DeviceInfo {
  if (typeof window === 'undefined') {
    return {
      deviceType: 'desktop',
      os: 'unknown',
      browser: 'unknown',
      isMobile: false,
      isTablet: false,
      isDesktop: true
    };
  }
  
  // Check if we're running in iOS native Capacitor app
  // If so, always force mobile view regardless of device size
  try {
    const platform = Capacitor.getPlatform();
    const isNative = Capacitor.isNativePlatform();
    
    if (platform === 'ios' && isNative) {
      return {
        deviceType: 'mobile',
        os: 'ios',
        browser: 'capacitor',
        isMobile: true,
        isTablet: false,
        isDesktop: false
      };
    }
  } catch {
    // Capacitor not available, continue with normal detection
  }
  
  return parseUserAgent(navigator.userAgent);
}