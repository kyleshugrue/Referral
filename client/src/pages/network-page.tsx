import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useLocation } from "wouter";
import { Search, MapPin, Clock, Building2, Briefcase, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type User } from "@shared/schema";
import { useState, useEffect, useMemo } from "react";
import { Loader2 } from "lucide-react";
import { SynergyIcon } from "@/components/icons/synergy-icon";
import { useDeviceType } from "@/hooks/use-device-type";
import { useUserAgentDetection } from "@/hooks/use-user-agent-detection";
import { useGlobalWebSocket } from "@/hooks/use-global-websocket";
import { Capacitor } from '@capacitor/core';
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { UserAvatar } from "@/components/user-avatar";
import useEmblaCarousel from 'embla-carousel-react';
import ProfileDialog from "@/components/profile-dialog";
import { 
  isPendingResponse, 
  getMatchDisplayState,
  MATCHES_QUERY_KEY
} from "@/lib/match-query-utils";
import { useMatchGenerationFlag } from "@/hooks/use-match-generation-flag";
import { connectionRequestCache } from "@/hooks/use-profiles.tsx";

interface MatchWithDescription extends User {
  matchDescription?: string;
  matchScore?: number;
  matchReasons?: string[];
  jobTitle?: string;
  location?: string;
}

interface MatchesResponse {
  matches: MatchWithDescription[];
  apiConnectionIssue: boolean;
}

interface PendingResponse {
  pending: true;
  reason: string;
  message: string;
}

type MatchesOrPendingResponse = MatchesResponse | PendingResponse;

export default function NetworkPage() {
  const [, setLocation] = useLocation();
  const deviceType = useDeviceType();
  useUserAgentDetection();
  const queryClient = useQueryClient();
  
  // Initialize WebSocket for real-time match updates
  useGlobalWebSocket();
  
  // Track match generation flag from localStorage for immediate generating state display
  const { isGenerationFlagSet, clearFlag: clearGenerationFlag } = useMatchGenerationFlag();
  
  // Push notification setup for iOS native only
  const { 
    initializePushNotifications, 
    shouldShowRegistrationPopup, 
    markRegistrationPopupShown 
  } = usePushNotifications();
  
  // Detect specifically native iOS app (not mobile web)
  const isNativeIOSApp = Capacitor.getPlatform() === 'ios' && Capacitor.isNativePlatform();
  
  // Request push notification permissions only once after registration completion (iOS native only)
  useEffect(() => {
    if (isNativeIOSApp && shouldShowRegistrationPopup()) {
      console.log('[Push Notifications] Auto-requesting push notification permissions after registration completion');
      markRegistrationPopupShown();
      
      // Directly request push notification permissions without custom popup
      initializePushNotifications().then((success) => {
        if (success) {
          console.log('[Push Notifications] Successfully initialized push notifications');
        } else {
          console.log('[Push Notifications] Push notification initialization failed or denied');
        }
      }).catch((error) => {
        console.error('[Push Notifications] Error initializing push notifications:', error);
      });
    }
  }, [isNativeIOSApp, shouldShowRegistrationPopup, markRegistrationPopupShown, initializePushNotifications]);
  const [selectedProfile, setSelectedProfile] = useState<User | null>(null);
  const [, setConnectingIds] = useState<number[]>([]);
  const [emblaRef, emblaApi] = useEmblaCarousel({ 
    align: 'start',
    loop: false,
    dragFree: true,
    skipSnaps: false,
    containScroll: 'trimSnaps',
    breakpoints: {
      '(min-width: 1280px)': { slidesToScroll: 3 },
      '(min-width: 768px)': { slidesToScroll: 2 }
    }
  });
  
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(true);

  // Update scroll button states
  useEffect(() => {
    if (!emblaApi) return;
    
    const onSelect = () => {
      setCanScrollPrev(emblaApi.canScrollPrev());
      setCanScrollNext(emblaApi.canScrollNext());
    };
    
    // Update scroll state on various events
    emblaApi.on("select", onSelect);
    emblaApi.on("reInit", onSelect);
    emblaApi.on("resize", onSelect);
    
    // Initial check
    onSelect();
    
    return () => {
      emblaApi.off("select", onSelect);
      emblaApi.off("reInit", onSelect);
      emblaApi.off("resize", onSelect);
    };
  }, [emblaApi]);

  // Get current user for displaying information
  const { isLoading } = useQuery<User>({
    queryKey: ["/api/user"],
  });
  

  // Get Synergy AI match results
  const { data: matchesData, isLoading: isLoadingMatches, isError: isMatchesError, isFetching: isFetchingMatches, refetch: refetchMatches } = useQuery<MatchesOrPendingResponse>({
    queryKey: MATCHES_QUERY_KEY,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
    retry: (failureCount, error: unknown) => {
      const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
      if (status === 202) return false;
      return failureCount < 3;
    },
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  });

  // Use the centralized display state logic - shows cached matches during refetch
  // CRITICAL: Pass isGenerationFlagSet to immediately show generating state when profile was edited
  // This prevents stale cached matches from flashing before the refetch completes
  const matchDisplayState = useMemo(() => 
    getMatchDisplayState(queryClient, {
      isLoading: isLoadingMatches,
      isFetching: isFetchingMatches,
      data: matchesData,
      isError: isMatchesError
    }, { isGenerationFlagSet }), 
    [queryClient, isLoadingMatches, isFetchingMatches, matchesData, isMatchesError, isGenerationFlagSet]
  );
  
  // Only show generating state when:
  // 1. Generation flag is set (profile was edited)
  // 2. Backend says pending
  // 3. Truly loading with no cache
  const shouldShowGenerating = matchDisplayState.shouldShowGenerating;
  
  // Clear generation flag when backend returns non-pending data (generation complete)
  useEffect(() => {
    if (!isLoadingMatches && matchesData && !isPendingResponse(matchesData)) {
      if (isGenerationFlagSet) {
        console.log('[NetworkPage] Backend returned non-pending data, clearing generation flag');
        clearGenerationFlag();
      }
    }
  }, [isLoadingMatches, matchesData, isGenerationFlagSet, clearGenerationFlag]);
  
  // Determine if we're in a pending state for polling purposes
  const isPendingGeneration = isGenerationFlagSet || matchDisplayState.isBackendGenerating || (isLoadingMatches && !matchDisplayState.cachedMatches);
  
  // For timeout tracking - only track when genuinely waiting for generation
  const isRefreshingMatches = isLoadingMatches || isFetchingMatches;

  // Reinitialize carousel when matches data changes to ensure all slides are visible
  useEffect(() => {
    if (!emblaApi) return;
    
    if (matchDisplayState.currentMatches.length > 0) {
      const timer = setTimeout(() => {
        emblaApi.reInit();
        console.log('[NetworkPage] Carousel reinitialized with', matchDisplayState.currentMatches.length, 'matches');
      }, 100);
      
      return () => clearTimeout(timer);
    }
  }, [emblaApi, matchDisplayState.currentMatches]);
  
  // Timeout state for Synergy AI matches - shows "failed to connect" after 30 seconds
  const [hasMatchesTimedOut, setHasMatchesTimedOut] = useState(false);
  
  // Handle 30-second timeout for matches loading
  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    
    if (isRefreshingMatches) {
      // Reset timeout state when loading starts
      setHasMatchesTimedOut(false);
      
      // Set timeout for 30 seconds
      timeoutId = setTimeout(() => {
        setHasMatchesTimedOut(true);
      }, 30000); // 30 seconds
    } else {
      // Clear timeout if loading stops
      setHasMatchesTimedOut(false);
    }
    
    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [isRefreshingMatches]);

  // Listen for custom matchesUpdated events from WebSocket handler
  // This is the PRIMARY mechanism for receiving real-time match updates from the worker VM
  useEffect(() => {
    const handleMatchesUpdated = () => {
      console.log('[NetworkPage] Received matchesUpdated event from WebSocket - refreshing matches immediately');
      refetchMatches();
    };

    window.addEventListener('matchesUpdated', handleMatchesUpdated);

    return () => {
      window.removeEventListener('matchesUpdated', handleMatchesUpdated);
    };
  }, [refetchMatches]);

  // Fallback polling for matches when in pending state
  // WebSocket events provide instant updates, but polling ensures we don't miss anything
  useEffect(() => {
    if (!isPendingGeneration) {
      return;
    }

    console.log('[NetworkPage] Matches are pending, starting fallback polling...');
    
    // Poll every 5 seconds while in pending state (WebSocket is primary update mechanism)
    const pollInterval = setInterval(() => {
      console.log('[NetworkPage] Fallback poll for match updates...');
      refetchMatches();
    }, 5000);

    return () => {
      console.log('[NetworkPage] Stopping fallback polling');
      clearInterval(pollInterval);
    };
  }, [isPendingGeneration, refetchMatches]);

  // CRITICAL: Force initial match check on component mount
  // This catches matches that completed while user was navigating or page was loading
  // The WebSocket might not have been connected when matches_ready NOTIFY was sent
  useEffect(() => {
    // Small delay to ensure WebSocket connection is established
    const initialCheckTimeout = setTimeout(() => {
      console.log('[NetworkPage] Initial mount - checking for ready matches...');
      refetchMatches();
    }, 1000);

    return () => clearTimeout(initialCheckTimeout);
  }, [refetchMatches]);
  
  // Interface for outgoing connection requests (matches API response)
  interface OutgoingRequest {
    id: number;
    senderId: number;
    receiverId: number;
    status: string;
    createdAt: string;
  }

  // Interface for incoming connection requests
  interface IncomingRequest {
    id: number;
    senderId: number;
    status: string;
    sender: User;
  }

  // Query to get outgoing connection requests
  const { data: outgoingRequests = [], isFetching: isFetchingOutgoing } = useQuery<OutgoingRequest[]>({
    queryKey: ["/api/connections/outgoing"],
    retry: 3,
    refetchInterval: 10000,
    refetchOnWindowFocus: true,
    staleTime: 0
  });

  // Query to get incoming connection requests
  const { data: incomingRequests = [], refetch: refetchIncomingRequests } = useQuery<IncomingRequest[]>({
    queryKey: ["/api/connections/requests"],
    retry: 3,
    refetchInterval: 10000,
    refetchOnWindowFocus: true,
    staleTime: 0
  });

  // Load pending connection requests from cache on mount
  useEffect(() => {
    const cachedIds = connectionRequestCache.getPendingRequests();
    if (cachedIds.length > 0) {
      setConnectingIds(cachedIds);
    }
  }, []);

  // Subscribe to cache updates for immediate UI refresh when WebSocket notifications arrive
  useEffect(() => {
    const unsubscribe = connectionRequestCache.subscribe((updatedUserIds) => {
      console.log('[NetworkPage] Cache subscription triggered, updating connectingIds:', updatedUserIds);
      setConnectingIds(updatedUserIds);
    });
    return unsubscribe;
  }, []);

  // Sync cache with server data when outgoing requests are fetched
  // Wait until isFetching is false to ensure we have fresh server data, not stale TanStack cache
  useEffect(() => {
    // Only sync when we have fresh data (not currently fetching)
    // This prevents syncing with stale cached data from previous sessions
    if (isFetchingOutgoing) {
      console.log('[NetworkPage] Skipping sync - still fetching from server');
      return;
    }
    
    // Sync cache with server data - this prunes stale entries
    const receiverIds = outgoingRequests
      .filter(req => req.status === 'requested')
      .map(req => req.receiverId);
    console.log('[NetworkPage] Syncing cache with fresh server data, receiverIds:', receiverIds);
    connectionRequestCache.syncWithServerData(receiverIds);
    
    // Update local state from the now-synced cache
    const cachedPendingIds = connectionRequestCache.getPendingRequests();
    setConnectingIds(cachedPendingIds);
  }, [outgoingRequests, isFetchingOutgoing]);

  // Helper function to find incoming request from selected profile
  const getIncomingRequestFromProfile = (profileId: number) => {
    return incomingRequests.find(req => req.senderId === profileId && req.status === 'requested');
  };

  // Callback to refresh incoming requests after handling
  const handleRequestHandled = () => {
    refetchIncomingRequests();
    queryClient.invalidateQueries({ queryKey: ["/api/connections/requests"] });
  };

  // Log mount/unmount for debugging and handle mobile scroll disabling
  useEffect(() => {
    const scrollPos = window.scrollY;
    console.log('NetworkPage mounted, scroll position:', scrollPos);

    // Disable scrolling on mobile devices
    if (deviceType === 'mobile') {
      document.documentElement.classList.add('mobile-no-scroll');
      document.body.classList.add('mobile-no-scroll');
    }

    return () => {
      console.log('NetworkPage unmounted, final scroll position:', window.scrollY);
      // Re-enable scrolling when leaving the page
      if (deviceType === 'mobile') {
        document.documentElement.classList.remove('mobile-no-scroll');
        document.body.classList.remove('mobile-no-scroll');
      }
    };
  }, [deviceType]);

  // Ensure page resets to top when loaded
  useEffect(() => {
    console.log('Page number changed, resetting scroll');
    window.scrollTo(0, 0);
  }, []);

  // Function to handle connection status changes from the dialog
  const handleConnectionStatusChange = (profileId: number, isPending: boolean) => {
    console.log(`NetworkPage - Connection status changed for ${profileId}: ${isPending ? 'pending' : 'not pending'}`);
    
    if (isPending) {
      setConnectingIds(prev => prev.includes(profileId) ? prev : [...prev, profileId]);
    } else {
      setConnectingIds(prev => prev.filter(id => id !== profileId));
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-4rem)]">
        <Loader2 className="h-8 w-8 animate-spin mb-4 text-primary" />
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  // Render the desktop layout
  if (deviceType === 'desktop') {
    return (
      <>
        {/* Profile dialog for desktop view */}
        {selectedProfile && (
          <ProfileDialog
            profile={selectedProfile}
            open={!!selectedProfile}
            onOpenChange={(open) => {
              if (!open) setSelectedProfile(null);
            }}
            requestPending={outgoingRequests.some((request) => 
              request.receiverId === selectedProfile.id && request.status === 'requested'
            )}
            onConnectionStatusChange={handleConnectionStatusChange}
            hasIncomingRequest={!!getIncomingRequestFromProfile(selectedProfile.id)}
            incomingRequestId={getIncomingRequestFromProfile(selectedProfile.id)?.id}
            onRequestHandled={handleRequestHandled}
          />
        )}
        
        <div className="flex flex-col w-full items-center p-6 pt-4 space-y-4 mt-0 pb-0">
          <div className="w-full flex flex-col gap-4">
            {/* Two column layout for main content */}
            <div className="w-full flex flex-row justify-between gap-6">
              {/* Left column - Network Search and Personalized Matching */}
              <div className="w-[33%] flex flex-col space-y-4 pt-0 relative">
                {/* Translucent bubble background - right margin reduced to ensure 1px min gap with Synergy bubble */}
                <div className="absolute inset-0 rounded-[1.25rem] bg-gradient-to-br from-primary/20 to-primary/10 backdrop-blur-sm -ml-3 -mr-[11.5px] -my-2 mt-0.5 p-1 z-0"></div>
                {/* Network Search title */}
                <h1 className="text-2xl font-bold text-primary pl-4 pt-1 relative z-10">Network Search</h1>
                
                {/* Network search card - width now matches specialty cards */}
                <Card 
                  className="cursor-pointer hover:shadow-md transition-shadow rounded-xl border-0"
                  onClick={() => setLocation('/network/search')}
                  style={{
                    backgroundColor: 'hsl(215, 20%, 65%)'
                  }}
                >
                  <CardContent className="p-4 flex items-center gap-4">
                    <Search className="h-6 w-6 text-white" />
                    <p className="text-white text-sm">
                      Browse all professionals on the platform
                    </p>
                  </CardContent>
                </Card>
                
                {/* Personalized Matching title */}
                <h1 className="text-2xl font-bold text-primary pl-4 mt-2 pt-1 relative z-10">Personalized Matching</h1>
                
                {/* Shared interests card */}
                <Card 
                  className={`cursor-pointer hover:shadow-md transition-shadow rounded-xl overflow-hidden border-0 ${deviceType === 'desktop' ? 'h-64' : 'h-60'}`}
                  onClick={() => setLocation('/network/shared-interests')}
                  style={{
                    background: 'linear-gradient(to bottom, hsl(215, 20%, 65%), hsl(215, 25%, 27%))',
                    color: 'white'
                  }}
                >
                  <CardContent className="p-4 flex flex-col h-full relative">
                    {/* Large icon centered in top 75% of button */}
                    <div className="absolute top-0 left-0 right-0 h-3/4 flex items-center justify-center">
                      <MapPin className="h-28 w-28 text-white opacity-20" />
                    </div>
                    
                    {/* Text at bottom left with lower title */}
                    <div className="mt-auto">
                      {/* No extra padding needed with smaller card height */}
                      <h2 className="text-lg font-medium mb-1">Shared Interests</h2>
                      <p className="text-white/90 text-sm">
                        People in your area with shared professional interests and hobbies
                      </p>
                    </div>
                  </CardContent>
                </Card>

                {/* Shared experience card */}
                <Card 
                  className={`cursor-pointer hover:shadow-md transition-shadow rounded-xl overflow-hidden border-0 ${deviceType === 'desktop' ? 'h-64' : 'h-60'}`}
                  onClick={() => setLocation('/network/shared-experience')}
                  style={{
                    background: 'linear-gradient(to bottom, hsl(215, 20%, 65%), hsl(215, 25%, 27%))',
                    color: 'white'
                  }}
                >
                  <CardContent className="p-4 flex flex-col h-full relative">
                    {/* Large icon centered */}
                    <div className="absolute top-0 left-0 right-0 h-3/4 flex items-center justify-center">
                      <Clock className="h-28 w-28 text-white opacity-20" />
                    </div>
                    
                    {/* Text at bottom left */}
                    <div className="mt-auto">
                      {/* No extra padding needed with smaller card height */}
                      <h2 className="text-lg font-medium mb-1">Shared Experience</h2>
                      <p className="text-white/90 text-sm">
                        Professionals in your industry with similar experience and career paths
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Right column - Synergy AI */}
              <div className={`w-[65%] flex flex-col space-y-2 pt-0 relative ${deviceType === 'desktop' ? '[&>*]:border-0 [&>*]:border-none' : ''}`}>
                {/* Translucent bubble background for Synergy AI - left margin reduced to ensure 1px min gap with Network Search bubble */}
                <div className="absolute inset-0 rounded-[1.25rem] bg-gradient-to-br from-primary/20 to-primary/10 backdrop-blur-sm -mr-3 -ml-[11.5px] -my-2 mt-0.5 p-1 z-0 border-0"></div>
                {/* Synergy AI Title - aligned with Network Search */}
                <h1 className="text-2xl font-bold text-primary pl-4 pt-1 flex items-center gap-2 relative z-10">
                  <SynergyIcon style={{ height: '28px', width: '28px' }} />
                  <span>Synergy AI</span>
                </h1>
                <p className="text-muted-foreground text-sm pl-4 -mt-2 mb-0 relative z-10">
                  AI-powered matching to connect with industry professionals who share your location interests or work at companies you're interested in joining
                </p>
                
                {/* Synergy AI content */}
                <Card 
                  className={`w-full ${deviceType === 'desktop' ? 'border-0 !border-none [border:none]' : 'border-0'} bg-transparent ${deviceType === 'desktop' ? 'p-0 m-0' : 'p-2'} pt-0 rounded-xl`}
                  style={deviceType === 'desktop' ? { border: 'none', borderWidth: '0', boxShadow: 'none', padding: '0', margin: '0' } : {}}
                >
                  {/* Loading state - only show when backend says generating OR truly loading with no cached data */}
                  {shouldShowGenerating && !hasMatchesTimedOut && (
                    <div className="flex justify-center items-center h-[400px]">
                      <div className="flex flex-col items-center gap-3 bg-white/80 p-6 rounded-xl backdrop-blur-sm">
                        <SynergyIcon style={{ height: '40px', width: '40px' }} className="animate-pulse text-primary" />
                        <p className="text-muted-foreground text-sm">Generating your Synergy AI matches...</p>
                      </div>
                    </div>
                  )}
                  
                  {/* Error state - show for API errors OR timeout */}
                  {(isMatchesError || hasMatchesTimedOut) && (
                    <div className="flex justify-center items-center h-[400px]">
                      <div className="flex flex-col items-center gap-3 max-w-md text-center bg-white/80 p-6 rounded-xl backdrop-blur-sm">
                        <SynergyIcon style={{ height: '64px', width: '64px' }} className="text-muted-foreground" />
                        <h3 className="text-xl font-semibold text-destructive">Failed to connect to Synergy AI</h3>
                        <p className="text-muted-foreground">
                          {hasMatchesTimedOut 
                            ? "Connection is taking longer than expected. Please check your internet connection and try again."
                            : "We can't show your matches right now due to an AI connection issue. Please try again later."
                          }
                        </p>
                        <Button 
                          variant="default" 
                          className="mt-2"
                          onClick={() => {
                            console.log("Retry connection clicked from network page");
                            setHasMatchesTimedOut(false); // Reset timeout state on retry
                            queryClient.invalidateQueries({ queryKey: ["/api/matches/synergy"] });
                          }}
                          disabled={isRefreshingMatches && !hasMatchesTimedOut}
                        >
                          {(isRefreshingMatches && !hasMatchesTimedOut) ? (
                            <span className="flex items-center">
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Retrying...
                            </span>
                          ) : (
                            <span className="flex items-center">
                              <RefreshCw className="mr-2 h-4 w-4" /> Retry Connection
                            </span>
                          )}
                        </Button>
                      </div>
                    </div>
                  )}
                  
                  {/* Matches carousel - show cached matches during background refetch */}
                  {!shouldShowGenerating && !isMatchesError && !hasMatchesTimedOut && matchDisplayState.currentMatches.length > 0 && (
                    <>
                      {/* Match cards carousel with side navigation */}
                      <div className={`relative overflow-hidden ${deviceType === 'desktop' ? 'border-0 !border-none mx-0 px-0 -mx-3' : ''}`} ref={emblaRef} style={deviceType === 'desktop' ? { border: 'none', margin: '0 -12px', padding: 0 } : {}}>
                        {/* Left arrow - only shows when scrolling left is possible */}
                        {canScrollPrev && (
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => emblaApi?.scrollPrev()}
                            aria-label="Previous match"
                            className="absolute left-2 top-1/2 -translate-y-1/2 z-10 rounded-full h-10 w-10 p-0 bg-white/80 shadow-md"
                          >
                            <ChevronLeft className="h-5 w-5" />
                          </Button>
                        )}
                        
                        {/* Right arrow - only shows when scrolling right is possible */}
                        {canScrollNext && (
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => emblaApi?.scrollNext()}
                            aria-label="Next match"
                            className="absolute right-2 top-1/2 -translate-y-1/2 z-10 rounded-full h-10 w-10 p-0 bg-white/80 shadow-md"
                          >
                            <ChevronRight className="h-5 w-5" />
                          </Button>
                        )}
                        <div className={`flex gap-6 ${deviceType === 'desktop' ? 'px-0 py-0 m-0 border-0 !border-none' : 'px-4 py-1'}`} style={deviceType === 'desktop' ? { border: 'none', margin: 0, padding: 0 } : {}}>
                          {matchDisplayState.currentMatches.map((match: MatchWithDescription, index: number) => (
                            <div 
                              key={match.id} 
                              role="button"
                              tabIndex={0}
                              aria-label={`View match profile for ${match.fullName || 'this match'}`}
                              className="flex-[0_0_380px] md:flex-[0_0_400px] relative cursor-pointer touch-manipulation active:scale-95 transition-all duration-200"
                              onClick={() => setSelectedProfile(match)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  setSelectedProfile(match);
                                }
                              }}
                            >
                              <div className={`relative ${deviceType === 'desktop' ? (index === 0 ? 'ml-8 mr-8 my-10' : 'mx-8 my-10') : 'mx-2 my-2'}`}>
                                <div className={`relative ${deviceType === 'desktop' ? 'h-[580px]' : 'h-[580px]'} rounded-lg ${deviceType === 'desktop' ? 'shadow-[0_0_25px_5px_hsl(215,20%,65%),0_0_35px_10px_hsl(215,20%,65%)]' : 'shadow-[0_0_20px_0px_hsl(215,20%,65%),0_0_30px_0px_hsl(215,20%,65%)]'}`}>
                                  {/* Match card content */}
                                  <div className="absolute inset-0 rounded-lg overflow-hidden">
                                    {/* Main container */}
                                    <div className="h-full w-full bg-white flex flex-col overflow-hidden relative rounded-lg">
                                      {/* Border overlay - z-[3] to sit above shadow but below banner */}
                                      <div className={`absolute inset-0 pointer-events-none z-[3] border-[4px] border-[hsl(215,20%,65%)] rounded-lg overflow-hidden`}></div>
                                      
                                      {/* Profile image section */}
                                      <div className="relative overflow-hidden h-[380px] rounded-t-lg">
                                        {/* Use consistent UserAvatar component */}
                                        <div className="w-full h-full overflow-hidden relative rounded-t-lg">
                                          <UserAvatar 
                                            user={match}
                                            className="w-full h-full"
                                            fallbackClassName="text-6xl font-bold bg-primary text-white rounded-t-lg"
                                            circular={false}
                                          />
                                          <div className="absolute inset-0" 
                                            style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0) 25%)' }}>
                                          </div>
                                        </div>
                                        
                                        <div className="absolute bottom-4 left-0 right-0 px-3 text-white">
                                          <h2 className="text-2xl font-bold drop-shadow-md">{match.fullName}</h2>
                                          <p className="text-base text-white/90 drop-shadow-md">{match.jobTitle || match.title || 'Professional'}</p>
                                        </div>
                                      </div>
                                      
                                      <div className="p-3 space-y-2 overflow-y-hidden flex-1 mt-1 z-[3] relative">
                                        <div className="flex flex-col gap-1.5 bg-muted/10 rounded-lg p-2">
                                          <div className="flex items-center gap-1.5">
                                            <MapPin className="w-4 h-4 text-muted-foreground" />
                                            <span className="text-sm text-muted-foreground">{match.currentLocation || match.location || "Location not specified"}</span>
                                          </div>
                                          <div className="flex items-center gap-1.5">
                                            <Building2 className="w-4 h-4 text-muted-foreground" />
                                            <span className="text-sm text-muted-foreground">{match.currentCompany || "Company not specified"}</span>
                                          </div>
                                          <div className="flex items-center gap-1.5">
                                            <Briefcase className="w-4 h-4 text-muted-foreground" />
                                            <span className="text-sm text-muted-foreground">
                                              {match.industry ? `${match.industry.charAt(0).toUpperCase() + match.industry.slice(1).toLowerCase()} - ${match.yearsOfExperience} years` : "Industry not specified"}
                                            </span>
                                          </div>
                                        </div>
                                      </div>
                                      
                                      <div className="mt-auto w-full relative">
                                        {/* Shadow element at z-[2] - below the border (z-[3]) */}
                                        <div 
                                          className="absolute inset-0 z-[2] rounded-b-[5px] pointer-events-none"
                                          style={{ 
                                            boxShadow: '0 -3px 8px 0px rgba(0, 0, 0, 0.18)'
                                          }}
                                        />
                                        {/* Banner content at z-[4] - above the border (z-[3]) */}
                                        <div 
                                          className="flex flex-col items-center justify-center min-h-[4rem] py-3 overflow-hidden w-full relative z-[4] rounded-b-[5px]" 
                                          style={{ 
                                            background: 'linear-gradient(to top, hsl(215,25%,45%) 0%, hsl(215,25%,45%) 20%, hsl(215,20%,65%) 100%)'
                                          }}
                                        >
                                          <p className="text-xs sm:text-sm text-white leading-tight text-center px-4"> 
                                            {match.matchDescription?.replace(/^\[AI_GENERATED\]/, '').replace(/^DESCRIPTION_[AB]:\s*/i, '') || `Professional with matching interests in ${match.industry || 'your industry'}`}
                                          </p>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                  

                  {/* No matches state - only show when not generating and truly have no matches */}
                  {!shouldShowGenerating && !isMatchesError && !hasMatchesTimedOut && matchDisplayState.shouldShowEmpty && (
                    <div className="flex-1 flex justify-center items-center" style={{ minHeight: '60vh' }}>
                      <div className="flex flex-col items-center gap-3 max-w-md text-center bg-white/80 p-6 rounded-xl backdrop-blur-sm">
                        <SynergyIcon className="h-10 w-10 text-muted-foreground" />
                        <h3 className="text-xl font-semibold">No matches found</h3>
                        <p className="text-muted-foreground">The Referral network is still growing. Come back later or update your preferences to find new connections!</p>
                        <div className="flex gap-2 mt-2">
                          <Button 
                            variant="outline" 
                            onClick={() => {
                              console.log('[NetworkPage] Manual refresh triggered from No Matches state');
                              queryClient.invalidateQueries({ queryKey: MATCHES_QUERY_KEY });
                            }}
                            disabled={isRefreshingMatches}
                          >
                            {isRefreshingMatches ? (
                              <span className="flex items-center">
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Searching...
                              </span>
                            ) : (
                              <span className="flex items-center">
                                <RefreshCw className="mr-2 h-4 w-4" /> Try Again
                              </span>
                            )}
                          </Button>
                          <Button 
                            variant="default" 
                            onClick={() => setLocation('/profile')}
                          >
                            Update Profile
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </Card>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  // Mobile layout for smaller screens
  return (
    <>
      {/* Profile dialog for mobile view */}
      {selectedProfile && (
        <ProfileDialog
          profile={selectedProfile}
          open={!!selectedProfile}
          onOpenChange={(open) => {
            if (!open) setSelectedProfile(null);
          }}
          requestPending={outgoingRequests.some((request) => 
            request.receiverId === selectedProfile.id && request.status === 'requested'
          )}
          onConnectionStatusChange={handleConnectionStatusChange}
          hasIncomingRequest={!!getIncomingRequestFromProfile(selectedProfile.id)}
          incomingRequestId={getIncomingRequestFromProfile(selectedProfile.id)?.id}
          onRequestHandled={handleRequestHandled}
        />
      )}
      
      <div 
        className="flex flex-col max-w-lg mx-auto overflow-hidden"
        style={{ height: '100vh', overflowY: 'hidden' }}
      >
        {/* Content area that fills available space above bottom nav */}
        <div 
          className="flex flex-col p-4 pt-5 overflow-hidden"
          style={{ height: 'calc(100vh - 80px)', overflowY: 'hidden' }} // Account for mobile nav
        >
          {/* Search all users - full width */}
          <div className="w-full">
            <h1 className="text-2xl font-bold mb-2 text-primary">Network Search</h1>
            <Card 
              className="cursor-pointer hover:shadow-md transition-shadow rounded-xl border-0 w-full"
              onClick={() => setLocation('/network/search')}
              style={{
                backgroundColor: 'hsl(215, 20%, 65%)'
              }}
            >
              <CardContent className="p-4 flex items-center gap-3">
                <Search className="h-5 w-5 text-white" />
                <p className="text-white text-sm">
                  Browse all professionals on the platform
                </p>
              </CardContent>
            </Card>
          </div>
          
          {/* Personalized Matching section with direct margin spacing */}
          <div className="w-full mt-4 flex flex-col">
            <h1 className="text-2xl font-bold mb-0 text-primary">Personalized Matching</h1>
            <Card 
              className="w-full cursor-pointer hover:shadow-md transition-shadow rounded-xl border-0 relative overflow-hidden"
              onClick={() => setLocation('/matches/suggestions')}
              style={{
                background: 'hsl(215, 20%, 65%)',
                color: 'white',
                minHeight: '220px'
              }}
            >
              <CardContent className="flex flex-col p-4 justify-between h-full items-center">
                {/* Icons and title container with relative positioning */}
                <div className="relative w-full h-32 mb-4 flex items-center justify-center">
                  {/* Three overlapping Synergy AI icons with increasing opacity in a straight line - touching at borders */}
                  <div className="absolute inset-0">
                    {/* Left icon - 30% opacity */}
                    <div className="absolute left-[calc(50%-125px)] top-1/2 -translate-y-1/2 opacity-30">
                      <SynergyIcon size={125} className="text-[hsl(215,25%,27%)]" />
                    </div>
                    
                    {/* Middle icon - 60% opacity - centered */}
                    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-60">
                      <SynergyIcon size={125} className="text-[hsl(215,25%,27%)]" />
                    </div>
                    
                    {/* Right icon - 90% opacity */}
                    <div className="absolute left-[calc(50%)] top-1/2 -translate-y-1/2 opacity-90">
                      <SynergyIcon size={125} className="text-[hsl(215,25%,27%)]" />
                    </div>
                  </div>
                  
                  {/* Title centered in the icons container */}
                  <div className="z-10">
                    <h2 className="text-xl font-bold text-white">Synergy AI</h2>
                  </div>
                </div>
                
                {/* Description below the icon container */}
                <p className="text-sm text-white/90 text-center z-10">
                  AI-powered matching to connect with professionals based on your goals
                </p>
              </CardContent>
            </Card>
            
            {/* Two-column layout for the tall cards with calculated height to fit above nav bar */}
            <div 
              className={`grid grid-cols-2 gap-4 mt-2 ${isNativeIOSApp ? 'mb-3' : 'mb-6'}`} 
              style={{ 
                height: isNativeIOSApp 
                  ? 'calc(100vh - 484px - env(safe-area-inset-top) - env(safe-area-inset-bottom))' 
                  : 'calc(100vh - 500px - env(safe-area-inset-top) - env(safe-area-inset-bottom))'
              }}
            >
            {/* Shared interests - Left tall card */}
            <Card 
              className="cursor-pointer hover:shadow-md transition-shadow rounded-xl overflow-hidden border-0 h-full"
              onClick={() => setLocation('/network/shared-interests')}
              style={{
                background: 'linear-gradient(to bottom, hsl(215, 20%, 65%), hsl(215, 25%, 27%))',
                color: 'white'
              }}
            >
              <CardContent className="p-4 sm:p-6 flex flex-col h-full relative">
                {/* Icon centered in top 75% as a watermark */}
                <div className="absolute top-0 left-0 right-0 h-3/4 flex items-center justify-center">
                  <MapPin className="text-white opacity-20" style={{ height: '125px', width: '125px' }} />
                </div>
                
                {/* Text at bottom left */}
                <div className="mt-auto">
                  <h2 className="font-medium leading-tight text-left" style={{ 
                    fontSize: 'clamp(1rem, 4.5vw, 1.125rem)'
                  }}>
                    Shared<br/>Interests
                  </h2>
                </div>
              </CardContent>
            </Card>

            {/* Shared experience - Right tall card */}
            <Card 
              className="cursor-pointer hover:shadow-md transition-shadow rounded-xl overflow-hidden border-0 h-full"
              onClick={() => setLocation('/network/shared-experience')}
              style={{
                background: 'linear-gradient(to bottom, hsl(215, 20%, 65%), hsl(215, 25%, 27%))',
                color: 'white'
              }}
            >
              <CardContent className="p-4 sm:p-6 flex flex-col h-full relative">
                {/* Icon centered in top 75% as a watermark */}
                <div className="absolute top-0 left-0 right-0 h-3/4 flex items-center justify-center">
                  <Clock className="text-white opacity-20" style={{ height: '125px', width: '125px' }} />
                </div>
                
                {/* Text at bottom left */}
                <div className="mt-auto">
                  <h2 className="font-medium leading-tight text-left" style={{ 
                    fontSize: 'clamp(1rem, 4.5vw, 1.125rem)'
                  }}>
                    Shared<br/>Experience
                  </h2>
                </div>
              </CardContent>
            </Card>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}