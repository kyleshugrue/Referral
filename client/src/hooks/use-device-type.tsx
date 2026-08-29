import { useState, useEffect } from 'react';
import { getDeviceInfo } from './use-user-agent-detection';

export type DeviceType = 'mobile' | 'desktop';

/**
 * Hook to detect device type using User-Agent string only
 * This provides accurate device detection based on actual device type
 */
export function useDeviceType(): DeviceType {
  const [deviceType, setDeviceType] = useState<DeviceType>(() => {
    // Initialize with User-Agent detection
    if (typeof window !== 'undefined') {
      const deviceInfo = getDeviceInfo();
      // Map tablet to desktop for backward compatibility
      return deviceInfo.deviceType === 'tablet' ? 'desktop' : deviceInfo.deviceType;
    }
    return 'mobile';
  });
  
  useEffect(() => {
    function updateDeviceType() {
      const deviceInfo = getDeviceInfo();
      
      // Use only User-Agent detection
      if (deviceInfo.isMobile) {
        setDeviceType('mobile');
      } else {
        // Tablets and desktops are considered desktop
        setDeviceType('desktop');
      }
    }
    
    // Set initial value
    updateDeviceType();
    
    // Note: No resize listener needed since User-Agent doesn't change
  }, []);
  
  return deviceType;
}