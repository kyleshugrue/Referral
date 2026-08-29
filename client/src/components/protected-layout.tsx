import { useEffect, useRef } from "react";
import { useLocation } from "wouter"; 
import MobileNav from "./mobile-nav";
import DesktopNav from "./desktop-nav";
import { useDeviceType } from "@/hooks/use-device-type";

interface ProtectedLayoutProps {
  children: React.ReactNode;
}

export default function ProtectedLayout({ children }: ProtectedLayoutProps) {
  const [location] = useLocation();
  const lastPathRef = useRef(location);
  const deviceType = useDeviceType();

  useEffect(() => {
    // Force scroll to top on genuine path changes
    if (lastPathRef.current !== location) {
      console.log('Route changed:', { from: lastPathRef.current, to: location });
      console.log('Scroll position before reset:', window.scrollY);

      window.scrollTo({
        top: 0,
        behavior: 'instant'
      });

      // Verify scroll position after reset
      requestAnimationFrame(() => {
        console.log('Scroll position after reset:', window.scrollY);
      });

      lastPathRef.current = location;
    }
  }, [location]);

  return (
    <div className="min-h-screen flex flex-col">
      {deviceType === 'mobile' ? (
        <MobileNav>{children}</MobileNav>
      ) : (
        <DesktopNav>{children}</DesktopNav>
      )}
    </div>
  );
}