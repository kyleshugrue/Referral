import * as React from "react"
import { getDeviceInfo } from './use-user-agent-detection';

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState(() => {
    // Initialize with User-Agent detection
    if (typeof window !== 'undefined') {
      const deviceInfo = getDeviceInfo();
      return deviceInfo.isMobile;
    }
    return false;
  });
  
  React.useEffect(() => {
    function updateMobileStatus() {
      const deviceInfo = getDeviceInfo();
      
      // Use only User-Agent detection
      setIsMobile(deviceInfo.isMobile);
    }
    
    // Initial check
    updateMobileStatus();
    
    // Note: No resize listener needed since User-Agent doesn't change
  }, []);
  
  return isMobile;
}