import { Share2, Users2, MessageSquare } from "lucide-react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { SynergyIcon } from "./icons/synergy-icon";
import { useState, useEffect, useRef } from "react";
import { useNotificationCounts } from "@/hooks/use-notifications";
import { UserAvatar } from "@/components/user-avatar";
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { logger } from "@/lib/logger";
import { useProfileState } from "@/contexts/profile-state-context";

interface MobileNavProps {
  children: React.ReactNode;
}

export default function MobileNav({ children }: MobileNavProps) {
  const [location] = useLocation();
  const { user } = useAuth();
  const { currentProfileTab, setCurrentProfileTab, setProfileCropperActive } = useProfileState();
  
  // Track if keyboard is visible
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  
  // Get notification counts
  const { data: notificationCounts, isLoading: notificationsLoading } = useNotificationCounts();
  
  // Check if we're running on native iOS
  const [isNativeIOSApp, setIsNativeIOSApp] = useState(false);
  
  // Track previous notification counts to trigger haptic only on new notifications
  const prevNotificationCountsRef = useRef<{ messages: number; connectionRequests: number; newConnections: number } | null>(null);
  
  useEffect(() => {
    // Check if we're running in a native iOS Capacitor app
    const isIOS = Capacitor.getPlatform() === 'ios' && Capacitor.isNativePlatform();
    setIsNativeIOSApp(isIOS);
  }, []);

  // Trigger haptic feedback when notification counts increase (new match request, new match, or new message)
  useEffect(() => {
    if (!isNativeIOSApp || notificationsLoading || !notificationCounts) return;
    
    const prev = prevNotificationCountsRef.current;
    
    // Only trigger haptic if we have previous counts to compare against
    if (prev !== null) {
      const hasNewConnectionRequest = notificationCounts.connectionRequests > prev.connectionRequests;
      const hasNewConnection = notificationCounts.newConnections > prev.newConnections;
      const hasNewMessage = notificationCounts.messages > prev.messages;
      
      if (hasNewConnectionRequest || hasNewConnection || hasNewMessage) {
        // Trigger haptic feedback for new notifications
        Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {
          // Haptic feedback not available, continue silently
        });
        logger.debug('[MobileNav] Haptic triggered for new notification:', {
          newRequest: hasNewConnectionRequest,
          newConnection: hasNewConnection,
          newMessage: hasNewMessage
        });
      }
    }
    
    // Update the ref with current counts
    prevNotificationCountsRef.current = {
      messages: notificationCounts.messages,
      connectionRequests: notificationCounts.connectionRequests,
      newConnections: notificationCounts.newConnections
    };
  }, [isNativeIOSApp, notificationsLoading, notificationCounts]);
  
  // Listen for keyboard visibility events
  useEffect(() => {
    const handleKeyboardVisibilityChange = (event: Event) => {
      const isVisible = (event as CustomEvent).detail;
      logger.debug("[MobileNav] Keyboard visibility event received:", isVisible);
      
      // This is the core line that controls nav bar visibility
      setIsKeyboardVisible(isVisible);
    };
    
    logger.debug("[MobileNav] Adding keyboard visibility event listener");
    window.addEventListener('keyboard-visibility-change', handleKeyboardVisibilityChange);
    
    return () => {
      logger.debug("[MobileNav] Removing keyboard visibility event listener");
      window.removeEventListener('keyboard-visibility-change', handleKeyboardVisibilityChange);
    };
  }, []);
  
  // Check if we're in edit mode any time location changes
  useEffect(() => {
    const isProfilePage = location.startsWith('/profile');
    
    // If we navigate to profile page, ensure the keyboard is marked as not visible
    // This ensures the nav bar and save button are definitely visible
    if (isProfilePage) {
      // Force reset keyboard visibility state when navigating to profile page
      logger.debug("[MobileNav] Navigated to profile page, resetting keyboard visibility state");
      setIsKeyboardVisible(false);
      
      // Also dispatch the event to ensure consistency across components
      window.dispatchEvent(new CustomEvent('keyboard-visibility-change', { 
        detail: false 
      }));
      
      // First check URL params - this takes precedence over any other state
      if (location.includes('?')) {
        const [, params] = location.split('?');
        const urlParams = new URLSearchParams(params || '');
        const tabParam = urlParams.get('tab');
        const isEditFromUrl = tabParam === null || tabParam === 'edit';
        logger.debug('Tab from URL params:', tabParam, 'Edit mode:', isEditFromUrl);
        
        // Update context state to match URL parameters
        const newTab = isEditFromUrl ? 'edit' : 'preview';
        setCurrentProfileTab(newTab);
        
        // Also dispatch an event to update other components
        const tabChangeEvent = new CustomEvent('profile-tab-changed', { detail: newTab });
        window.dispatchEvent(tabChangeEvent);
      } else {
        // If we're on profile page with no params, just sync with the current context state
        // Don't force it to any particular value - let the profile page component manage it
        logger.debug('No URL params, syncing with current context state:', currentProfileTab);
      }
    }
    
    // Listen for tab change events
    const handleTabChange = (event: Event) => {
      if (isProfilePage) {
        const tabValue = (event as CustomEvent).detail;
        logger.debug('Tab change event detected:', tabValue);
      }
    };
    
    // Add event listener for tab changes
    window.addEventListener('profile-tab-changed', handleTabChange);
    
    // Initial check once on component mount
    setTimeout(() => {
      if (isProfilePage) {
        logger.debug('Initial tab check:', currentProfileTab);
      }
    }, 100);
    
    return () => {
      window.removeEventListener('profile-tab-changed', handleTabChange);
    };
  }, [location, currentProfileTab, setCurrentProfileTab]);
  
  // Listen for cropper status changes via events instead of polling
  useEffect(() => {
    const handleCropperStatusChange = (event: Event) => {
      const isActive = (event as CustomEvent).detail;
      logger.debug('[MobileNav] Cropper status change event received:', isActive);
      setProfileCropperActive(isActive);
    };
    
    window.addEventListener('profile-cropper-status-change', handleCropperStatusChange);
    
    return () => {
      window.removeEventListener('profile-cropper-status-change', handleCropperStatusChange);
    };
  }, [setProfileCropperActive]);

  // Create navigation items
  const navItems = [
    { icon: SynergyIcon, label: "Synergy AI", href: "/matches/suggestions" },
    { icon: Share2, label: "Network", href: "/" },
    { icon: Users2, label: "Requests", href: "/requests" },
    { icon: MessageSquare, label: "Connections", href: "/connections" },
    { href: "/profile", label: "Profile", isAvatar: true }
  ];

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      {/* Header with safe area insets - z-index below dialogs (z-50) but above regular content */}
      <header className="fixed top-0 left-0 right-0 z-30 transition-all duration-300 ease-in-out bg-background/95 backdrop-blur-sm">
        {/* iOS status bar padding */}
        <div className="h-[env(safe-area-inset-top)]" />
        
        {/* First row: Referral title */}
        <div className="h-10 flex items-center px-4">
          <h1 className="text-lg font-semibold text-primary">Referral</h1>
        </div>
        
        {/* Second row: Removed duplicate titles for shared-interests and shared-experience */}
      </header>

      {/* Main content area with adjusted padding */}
      {/* Network pages need scrolling enabled for iOS Capacitor */}
      <main className={cn(
        "flex-1 pb-0",
        (location === "/network/search" || 
         location === "/network/shared-interests" || 
         location === "/network/shared-experience")
          ? "network-scroll-enabled overflow-y-auto overflow-x-hidden"
          : "overflow-hidden"
      )}
      style={
        (location === "/network/search" || 
         location === "/network/shared-interests" || 
         location === "/network/shared-experience")
          ? { WebkitOverflowScrolling: 'touch', overscrollBehavior: 'none' }
          : undefined
      }
      >
        <div className={cn(
          (location === "/network/search" || 
           location === "/network/shared-interests" || 
           location === "/network/shared-experience")
            ? "overflow-y-auto overflow-x-hidden h-full"
            : "overflow-hidden",
          location === "/profile" 
            ? "pt-[env(safe-area-inset-top)]" 
            : location === "/" 
              ? "pt-[calc(1rem+env(safe-area-inset-top))]" 
              : location === "/network/search"
                ? "pt-[calc(2.5rem+env(safe-area-inset-top))]"
              : (location === "/network/shared-interests" || 
                 location === "/network/shared-experience") 
                ? "pt-[calc(2.5rem+env(safe-area-inset-top))]" 
                : "pt-[calc(3.5rem+env(safe-area-inset-top))]"
        )}
        style={
          (location === "/network/search" || 
           location === "/network/shared-interests" || 
           location === "/network/shared-experience")
            ? { WebkitOverflowScrolling: 'touch', overscrollBehavior: 'none' }
            : undefined
        }
        >
          {children}
        </div>
      </main>

      {/* Profile Save Button was removed since profile changes are now auto-saved */}
      
      {/* Bottom Navigation - z-index 180 to appear above profile dialog but still below other high-priority dialogs */}
      <nav 
        className={`fixed left-0 right-0 bottom-0 z-[180] bg-[hsl(215,25%,27%)] transition-transform transition-opacity duration-300 ease-in-out ${
          isKeyboardVisible 
            ? 'opacity-0 transform translate-y-full pointer-events-none' 
            : 'opacity-100 transform translate-y-0 pointer-events-auto'
        }`}
      >
        <div className={cn(
          "grid grid-cols-5 w-full h-16",
          // iOS native - position icons higher like Hinge, but keep them aligned with each other
          isNativeIOSApp ? "items-start pt-2" : "items-center"
        )}>
          {navItems.map((item) => {
            // Check if the current location is a network-related page for the Network icon
            const isNetworkPage = item.href === "/" && 
              (location === "/" || location.startsWith("/network/"));
            
            // For other icons, just check for exact match but don't let it affect the badge visibility
            // Using a separate variable for visual active state vs. badge visibility
            const isActive = item.href !== "/" ? 
              location === item.href : 
              isNetworkPage;
              
            if (item.isAvatar) {
              return (
                <div key={item.href} className="relative flex items-center justify-center">
                  <Link
                    href={item.href}
                    aria-label={item.label}
                    className={cn(
                      "flex items-center justify-center w-10 h-10",
                      isActive ? "text-white" : "text-[hsl(215,20%,65%)]",
                      "hover:text-white transition-colors",
                      "touch-manipulation active:scale-95"
                    )}
                  >
                    <UserAvatar 
                      user={user} 
                      className={cn(
                        "h-8 w-8 rounded-full transition-all duration-200",
                        isActive && "ring-2 ring-white ring-offset-2"
                      )}
                      fallbackClassName="text-xs font-medium bg-white text-primary"
                    />
                  </Link>
                </div>
              );
            }
            const Icon = item.icon!;
            
            // Determine if we need to show a notification badge
            let notificationCount = 0;
            
            // Always show notification badges when counts are greater than zero
            // This ensures badges persist regardless of active/inactive state
            if (item.href === "/requests") {
              // For connection requests, always show the badge if count > 0
              notificationCount = notificationCounts?.connectionRequests || 0;
            } else if (item.href === "/connections") {
              // For connections, show combined count of messages and new connections
              notificationCount = (notificationCounts?.messages || 0) + (notificationCounts?.newConnections || 0);
            }
            
            return (
              <div key={item.href} className="relative flex items-center justify-center">
                <Link
                  href={item.href}
                  aria-label={item.label}
                  className={cn(
                    "flex items-center justify-center w-10 h-10",
                    isActive ? "text-white" : "text-[hsl(215,20%,65%)]",
                    "hover:text-white transition-colors",
                    "touch-manipulation active:scale-95"
                  )}
                >
                  <div className="relative">
                    <Icon className={cn(
                      "h-6 w-6 transition-colors duration-200",
                      isActive ? "text-white" : "text-[hsl(215,20%,65%)]"
                    )} />
                    
                    {/* Notification Badge - Positioned directly over icon - always show if count > 0, regardless of active state */}
                    {!notificationsLoading && notificationCount > 0 && (
                      <div className="absolute -top-2 -right-2 flex items-center justify-center min-w-[16px] h-[16px] rounded-full bg-red-500 text-white text-[10px] font-semibold p-0.5 z-10">
                        {notificationCount}
                      </div>
                    )}
                  </div>
                </Link>
              </div>
            );
          })}
        </div>
        {/* iOS safe area padding */}
        <div className={cn(
          "bg-[hsl(215,25%,27%)]", 
          // iOS native - reduce safe area padding to sit closer to bottom like Hinge
          isNativeIOSApp 
            ? "h-[calc(env(safe-area-inset-bottom)*0.5)]" 
            : "h-[env(safe-area-inset-bottom)]"
        )} />
      </nav>
    </div>
  );
}