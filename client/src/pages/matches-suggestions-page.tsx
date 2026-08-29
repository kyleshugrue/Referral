import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, MapPin, Building2, Briefcase, FileText, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import { type User } from "@shared/schema";
import ProfileDialog from "@/components/profile-dialog";
import { getInitials } from "@/lib/avatar-utils";
import { useState, useEffect, useCallback, useMemo } from "react";
import { SynergyIcon } from "@/components/icons/synergy-icon";
import useEmblaCarousel from 'embla-carousel-react';
import { Badge } from "@/components/ui/badge";
import ReactMarkdown from 'react-markdown';
import { apiRequest, QUERY_CONFIGS } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { connectionRequestCache } from "@/hooks/use-profiles.tsx";
import { useDeviceType } from "@/hooks/use-device-type";
import { 
  getMatchDisplayState,
  MATCHES_QUERY_KEY,
  isPendingResponse
} from "@/lib/match-query-utils";
import { useMatchGenerationFlag } from "@/hooks/use-match-generation-flag";

interface MatchWithDescription extends User {
  matchDescription?: string;
  matchScore?: number;
  matchReasons?: string[];
}

interface MatchesResponse {
  matches: MatchWithDescription[];
  apiConnectionIssue: boolean;
  pending?: boolean;
  reason?: string;
  message?: string;
}

export default function MatchesSuggestionsPage() {
  const [selectedProfile, setSelectedProfile] = useState<User | null>(null);
  const [connectingIds, setConnectingIds] = useState<number[]>([]);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Keep track of currently mutating IDs to prevent multiple clicks
  const [, setMutatingIds] = useState<{[key: number]: boolean}>({});
  
  // Calculate content visibility based on viewport height
  const [viewportHeight, setViewportHeight] = useState(window.innerHeight);
  
  useEffect(() => {
    const handleResize = () => setViewportHeight(window.innerHeight);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Determine which content sections to show based on available space - more aggressive hiding
  const getContentVisibility = () => {
    const availableHeight = viewportHeight - 180; // Account for header and margins
    
    if (availableHeight >= 700) {
      return {
        showEducation: true,
        showBio: true,
        showInterests: true,
        showHobbies: true,
        showLanguages: true,
        showResume: false // Always hidden on mobile
      };
    } else if (availableHeight >= 600) {
      return {
        showEducation: true,
        showBio: true,
        showInterests: false,
        showHobbies: false,
        showLanguages: false,
        showResume: false
      };
    } else if (availableHeight >= 500) {
      return {
        showEducation: true,
        showBio: false,
        showInterests: false,
        showHobbies: false,
        showLanguages: false,
        showResume: false
      };
    } else if (availableHeight >= 450) {
      return {
        showEducation: false,
        showBio: false,
        showInterests: false,
        showHobbies: false,
        showLanguages: false,
        showResume: false
      };
    } else {
      return {
        showEducation: false,
        showBio: false,
        showInterests: false,
        showHobbies: false,
        showLanguages: false,
        showResume: false
      };
    }
  };

  // Function to handle connection status changes from the dialog
  const handleConnectionStatusChange = (profileId: number, isPending: boolean) => {
    console.log(`MatchesSuggestionsPage - Connection status changed for ${profileId}: ${isPending ? 'pending' : 'not pending'}`);

    if (isPending) {
      setConnectingIds(prev => prev.includes(profileId) ? prev : [...prev, profileId]);
    } else {
      setConnectingIds(prev => prev.filter(id => id !== profileId));
    }
  };

  const [emblaRef, emblaApi] = useEmblaCarousel({ 
    align: 'start',
    loop: false,
    dragFree: true,
    watchDrag: true,
    watchResize: true,
    skipSnaps: false,
    containScroll: 'trimSnaps',
    breakpoints: {
      '(min-width: 640px)': { slidesToScroll: 2 },
      '(min-width: 1024px)': { slidesToScroll: 3 }
    }
  });
  
  const deviceType = useDeviceType();
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
    
    // Window resize handler to ensure carousel navigation updates when window size changes
    const handleWindowResize = () => {
      setTimeout(() => {
        if (emblaApi) {
          emblaApi.reInit();
          onSelect();
        }
      }, 200); // Small delay to ensure DOM has updated
    };
    
    window.addEventListener("resize", handleWindowResize);
    
    // Initial check
    onSelect();
    
    return () => {
      emblaApi.off("select", onSelect);
      emblaApi.off("reInit", onSelect);
      emblaApi.off("resize", onSelect);
      window.removeEventListener("resize", handleWindowResize);
    };
  }, [emblaApi]);

  // Disable vertical scrolling on mobile devices
  useEffect(() => {
    if (deviceType === 'mobile') {
      document.documentElement.classList.add('mobile-no-scroll');
      document.body.classList.add('mobile-no-scroll');
    }

    return () => {
      if (deviceType === 'mobile') {
        document.documentElement.classList.remove('mobile-no-scroll');
        document.body.classList.remove('mobile-no-scroll');
      }
    };
  }, [deviceType]);

  useQuery<User>({
    queryKey: ["/api/user"],
  });

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
    createdAt: string;
    sender?: User;
  }

  // Query to get outgoing requests
  const { data: outgoingRequests = [], isFetching: isFetchingOutgoing } = useQuery<OutgoingRequest[]>({
    queryKey: ["/api/connections/outgoing"],
    ...QUERY_CONFIGS.CONNECTION_DATA
  });

  // Query to get incoming requests
  const { data: incomingRequests = [] } = useQuery<IncomingRequest[]>({
    queryKey: ["/api/connections/requests"],
    ...QUERY_CONFIGS.CONNECTION_DATA
  });

  // Load cached pending requests on mount
  useEffect(() => {
    const cachedIds = connectionRequestCache.getPendingRequests();
    if (cachedIds.length > 0) {
      setConnectingIds(cachedIds);
    }
  }, []);

  // Subscribe to cache updates for immediate UI refresh when WebSocket notifications arrive
  useEffect(() => {
    const unsubscribe = connectionRequestCache.subscribe((updatedUserIds) => {
      console.log('[MatchesSuggestionsPage] Cache subscription triggered, updating connectingIds:', updatedUserIds);
      setConnectingIds(updatedUserIds);
    });
    return unsubscribe;
  }, []);

  // Sync connectingIds state with outgoing requests from the server
  // Wait until isFetching is false to ensure we have fresh server data
  useEffect(() => {
    if (isFetchingOutgoing) {
      console.log('[MatchesSuggestionsPage] Skipping sync - still fetching from server');
      return;
    }
    
    if (Array.isArray(outgoingRequests)) {
      // Sync cache with server data - this prunes stale entries
      const receiverIds = outgoingRequests
        .filter(req => req.status === 'requested')
        .map(req => req.receiverId);
      console.log('[MatchesSuggestionsPage] Syncing cache with fresh server data, receiverIds:', receiverIds);
      connectionRequestCache.syncWithServerData(receiverIds);
      
      // Update local state from the now-synced cache
      const cachedPendingIds = connectionRequestCache.getPendingRequests();
      setConnectingIds(cachedPendingIds);
    }
  }, [outgoingRequests, isFetchingOutgoing]);

  // Track manual refetch loading state
  const [isRefetching, setIsRefetching] = useState(false);
  // Regeneration loading state
  const [isRegenerating, setIsRegenerating] = useState(false);
  
  // Track match generation flag from localStorage for immediate generating state display
  // This hook handles all localStorage flag management, timeout clearing, and event listening
  const { isGenerationFlagSet, clearFlag: clearGenerationFlag } = useMatchGenerationFlag();
  
  const { data, isLoading, isError, error, isFetching, refetch: refetchMatchesOriginal } = useQuery<MatchesResponse>({
    queryKey: MATCHES_QUERY_KEY,
    refetchOnMount: "always",
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
  
  // Use centralized display state logic - shows cached matches during refetch
  // CRITICAL: Pass isGenerationFlagSet to immediately show generating state when profile was edited
  // This prevents stale cached matches from flashing before the refetch completes
  const matchDisplayState = useMemo(() => 
    getMatchDisplayState(queryClient, {
      isLoading,
      isFetching,
      data,
      isError
    }, { isGenerationFlagSet }), 
    [queryClient, isLoading, isFetching, data, isError, isGenerationFlagSet]
  );
  
  // Only show generating state when:
  // 1. Generation flag is set (profile was edited)
  // 2. Backend says pending
  // 3. Truly loading with no cache
  const shouldShowGenerating = matchDisplayState.shouldShowGenerating;
  
  // Clear generation flag when backend returns non-pending data (generation complete)
  useEffect(() => {
    if (!isLoading && data && !isPendingResponse(data)) {
      if (isGenerationFlagSet) {
        console.log('[MatchesSuggestions] Backend returned non-pending data, clearing generation flag');
        clearGenerationFlag();
      }
    }
  }, [isLoading, data, isGenerationFlagSet, clearGenerationFlag]);
  
  // Wrap the refetch function to track loading state
  const refetchMatches = useCallback(() => {
    setIsRefetching(true);
    refetchMatchesOriginal().then(() => {
      setIsRefetching(false);
    }).catch(() => {
      setIsRefetching(false);
    });
  }, [refetchMatchesOriginal]);
  
  // Extract API connection status and pending message from the response
  const apiConnectionIssue = data?.apiConnectionIssue || false;
  const isPending = data?.pending || false;
  const pendingReason = data?.reason || '';
  const pendingMessage = data?.message || '';
  
  // Use matches from display state (includes cached matches during refetch)
  const matches = matchDisplayState.currentMatches;
  
  // Performance tracking: log when matches are received
  useEffect(() => {
    // Log completion whenever we transition out of pending, regardless of match count
    if (!isPending) {
      const perfEnd = performance.now();
      const perfStart = parseFloat(localStorage.getItem('match_gen_start') || '0');
      if (perfStart > 0) {
        const totalTime = perfEnd - perfStart;
        const matchCount = matches.length;
        const reason = pendingReason || 'unknown';
        console.log(`[PERF] Match generation complete: ${totalTime.toFixed(0)}ms (${(totalTime/1000).toFixed(2)}s) - ${matchCount} matches (${reason})`);
        localStorage.removeItem('match_gen_start');
      }
    }
  }, [isPending, matches.length, pendingReason]);
  
  // Mutation for regenerating matches
  const regenerateMatchesMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest(
        "POST",
        "/api/matches/synergy/regenerate"
      );
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to regenerate matches");
      }
      return response.json();
    },
    onMutate: () => {
      // Performance timing
      const perfStart = performance.now();
      console.log(`[PERF] Match generation started at ${perfStart}ms (manual regenerate)`);
      localStorage.setItem('match_gen_start', perfStart.toString());
      
      // Optimistic update: immediately show "generating" status
      queryClient.setQueryData<MatchesResponse>(MATCHES_QUERY_KEY, (old: MatchesResponse | undefined) => ({
        ...old,
        pending: true,
        apiConnectionIssue: old?.apiConnectionIssue ?? false,
        reason: 'manual_regenerate',
        message: 'Regenerating your synergy matches...',
        matches: old?.matches || []
      }));
      setIsRegenerating(true);
    },
    onSuccess: () => {
      toast({
        title: "Matches regenerated",
        description: "Your synergy matches have been refreshed with the latest data."
      });
      
      // Refetch matches to show the newly generated ones
      refetchMatches();
      setIsRegenerating(false);
    },
    onError: (error) => {
      console.error("Error regenerating matches:", error);
      
      // Clear performance timer on error to prevent contaminating next measurement
      localStorage.removeItem('match_gen_start');
      
      toast({
        title: "Failed to regenerate matches",
        description: "Please try again later.",
        variant: "destructive"
      });
      setIsRegenerating(false);
    }
  });
  
  // CRITICAL FIX: Poll for matches when in pending state
  // This ensures the frontend automatically updates when worker VM completes match generation
  // even if WebSocket notifications fail to arrive
  useEffect(() => {
    if (!isPending) {
      return;
    }

    console.log('[MatchesSuggestions] Matches are pending, starting polling...');
    
    // Poll every 3 seconds while in pending state
    const pollInterval = setInterval(() => {
      console.log('[MatchesSuggestions] Polling for match updates...');
      refetchMatchesOriginal();
    }, 3000);

    // Cleanup interval when component unmounts or when no longer pending
    return () => {
      console.log('[MatchesSuggestions] Stopping polling (pending state changed)');
      clearInterval(pollInterval);
    };
  }, [isPending, refetchMatchesOriginal]);
  
  // Auto-regenerate if we're seeing API connection issues 
  // This will trigger one rebuild automatically if we detect all fallbacks
  useEffect(() => {
    if (apiConnectionIssue && !isRegenerating && !isRefetching) {
      console.log("[SynergyAI] Detected all fallback descriptions, automatically triggering regeneration");
      regenerateMatchesMutation.mutate();
    }
  }, [apiConnectionIssue, isRegenerating, isRefetching, regenerateMatchesMutation]);
  
  // Check for reopening profile dialog when returning from resume view
  useEffect(() => {
    // First access to matches data needs to be conditional
    if (!matches || matches.length === 0) return;

    // Check if we should be restoring a profile dialog (coming back from resume view)
    const instantReopenProfile = sessionStorage.getItem('instantReopenProfile');
    const reopenProfileId = sessionStorage.getItem('reopenProfileId');
    const returnPathSource = sessionStorage.getItem('returnPathSource');
    
    // Only proceed if we have conditions for reopening:
    // 1. instantReopenProfile flag is set to 'true'
    // 2. We have a valid profile ID
    // 3. We're returning from a matching path (contains '/matches/suggestions')
    if (
      instantReopenProfile === 'true' && 
      reopenProfileId && 
      returnPathSource && 
      returnPathSource.includes('/matches/suggestions')
    ) {
      console.log('Reopening profile dialog on Synergy AI page for profile:', reopenProfileId);
      
      // Find the profile to reopen in the matches data
      const profileId = parseInt(reopenProfileId, 10);
      
      // Set a small timeout to make sure the matches data is loaded
      setTimeout(() => {
        // Find the profile in the matches data
        const matchToReopen = matches.find(match => match.id === profileId);
        if (matchToReopen) {
          setSelectedProfile(matchToReopen);
          console.log('Found and reopened profile in matches:', matchToReopen.fullName);
        } else {
          console.log('Could not find profile in matches with ID:', profileId);
        }
        
        // Clear session storage to prevent reopening on subsequent navigations
        sessionStorage.removeItem('instantReopenProfile');
        sessionStorage.removeItem('reopenProfileId');
        sessionStorage.removeItem('returnPathSource');
      }, 100);
    }
  }, [matches]); // Run when matches data changes

  useMutation({
    mutationFn: async (userId: number) => {
      const response = await apiRequest(
        "DELETE",
        `/api/connections/request/${userId}`
      );
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to cancel request");
      }
      return { userId, status: "success" };
    },
    onMutate: (userId) => {
      setMutatingIds(prev => ({...prev, [userId]: true}));
      setConnectingIds(prev => prev.filter(id => id !== userId));

      // Remove from shared cache
      connectionRequestCache.removePendingRequest(userId);
    },
    onSuccess: (result) => {
      const { userId } = result;
      setMutatingIds(prev => {
        const updated = {...prev};
        delete updated[userId];
        return updated;
      });

      toast({
        title: "Request canceled",
        description: "Your connection request has been canceled."
      });

      queryClient.invalidateQueries({ queryKey: ["/api/connections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/connections/requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/connections/outgoing"] });
    },
    onError: (error, userId) => {
      console.error("Error canceling request:", error);
      setConnectingIds(prev => [...prev, userId]);

      // Add back to shared cache
      connectionRequestCache.addPendingRequest(userId);

      setMutatingIds(prev => {
        const updated = {...prev};
        delete updated[userId];
        return updated;
      });

      toast({
        title: "Failed to cancel request",
        description: "Please try again later.",
        variant: "destructive"
      });
    }
  });

  useMutation({
    mutationFn: async (userId: number) => {
      try {
        await apiRequest(
          "POST",
          `/api/connections/request/${userId}`
        );
        return { userId, status: "success" };
      } catch (error) {
        if (error instanceof Error && error.message.includes("DUPLICATE_REQUEST")) {
          return { userId, status: "duplicate" };
        }
        throw error;
      }
    },
    onMutate: (userId) => {
      setMutatingIds(prev => ({...prev, [userId]: true}));
      setConnectingIds(prev => [...prev, userId]);

      // Add to shared cache
      connectionRequestCache.addPendingRequest(userId);
    },
    onSuccess: (result) => {
      const { userId, status } = result;
      setMutatingIds(prev => {
        const updated = {...prev};
        delete updated[userId];
        return updated;
      });

      if (status === "duplicate") {
        toast({
          title: "Connection already requested",
          description: "You've already sent a connection request to this user."
        });
      } else {
        toast({
          title: "Connection request sent",
          description: "The user will be notified of your request."
        });
      }

      queryClient.invalidateQueries({ queryKey: ["/api/connections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/connections/requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/connections/outgoing"] });
    },
    onError: (error, userId) => {
      console.error("Connection error:", error);
      setMutatingIds(prev => {
        const updated = {...prev};
        delete updated[userId];
        return updated;
      });

      if (!(error instanceof Error && error.message.includes("DUPLICATE_REQUEST"))) {
        setConnectingIds(prev => prev.filter(id => id !== userId));

        // Remove from shared cache
        connectionRequestCache.removePendingRequest(userId);

        toast({
          title: "Failed to send request",
          description: "Please try again later.",
          variant: "destructive"
        });
      }
    }
  });

  // Only show generating screen when backend says pending OR truly loading with no cached data
  if (shouldShowGenerating) {
    return (
      <div style={{ 
        display: 'flex',
        flexDirection: 'column',
        height: deviceType === 'mobile' ? '100vh' : 'fit-content',
        overflow: 'hidden',
        overflowY: deviceType === 'mobile' ? 'hidden' : 'auto',
        backgroundColor: 'white'
      }}>
        {/* Header - Using exact same layout as loaded screen */}
        <div className="w-full pt-2 px-4">
          <h1 className="text-2xl font-bold mb-2 text-primary flex items-center gap-2">
            <SynergyIcon style={{ height: '28px', width: '28px' }} />
            <span>Synergy AI</span>
          </h1>
          <p className="text-sm text-muted-foreground">
            AI-powered matching to connect with industry professionals who share your location interests or work at companies you're interested in joining
          </p>
        </div>
        
        {/* Content area - flex spacer */}
        <div style={{ 
          flex: 1,
          overflowY: deviceType === 'mobile' ? 'hidden' : 'auto', 
          padding: '8px 0 0 0',
          position: 'relative'
        }}>
          {/* Loading animation - absolutely centered on entire page */}
          <div style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            zIndex: 20
          }}>
            <div className="animate-pulse">
              <SynergyIcon className="h-16 w-16 text-primary" />
            </div>
            <p className="mt-4 text-muted-foreground text-sm">
              {pendingMessage || 'Generating your Synergy AI matches...'}
            </p>
          </div>
        </div>
      </div>
    );
  }
  
  // Capture the error and API connection issue state, but we'll still render the regular page layout
  if (isError) {
    console.error("Error fetching synergy matches:", error);
  } else if (apiConnectionIssue) {
    console.warn("API connection issue detected with Anthropic API");
  }

  return (
    <div style={{ 
        display: 'flex',
        flexDirection: 'column',
        height: deviceType === 'mobile' ? '100vh' : 'fit-content',
        overflow: 'hidden',
        overflowY: deviceType === 'mobile' ? 'hidden' : 'auto',
        backgroundColor: 'white'
      }}>
      {/* Header - Using same layout as Network Search title in mobile view */}
      <div className="w-full pt-2 px-4">
        <h1 className="text-2xl font-bold mb-2 text-primary flex items-center gap-2">
          <SynergyIcon style={{ height: '28px', width: '28px' }} />
          <span>Synergy AI</span>
        </h1>
        <p className="text-sm text-muted-foreground">
          AI-powered matching to connect with industry professionals who share your location interests or work at companies you're interested in joining
        </p>
      </div>
      
      {/* We removed the top warning banner since we now show the error in the content area */}

      {/* Content container - fills available space without causing scroll */}
      <div style={{ 
        flex: 1,
        overflowY: deviceType === 'mobile' ? 'hidden' : 'auto', 
        padding: '8px 0 0 0',
        position: 'relative'
      }}>
        {/* Large error display instead of cards for API connection issues */}
        {(isError || apiConnectionIssue) ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 mt-4">
            <div className="flex flex-col items-center justify-center w-full max-w-md mx-auto p-6 rounded-xl bg-white/95 shadow-lg border border-destructive/20">
              <SynergyIcon className="h-16 w-16 text-muted-foreground" />
              <h2 className="text-xl font-semibold text-destructive mt-4">Failed to connect to Synergy AI</h2>
              <p className="mt-2 text-center text-muted-foreground">
                We can't show your matches right now due to an AI connection issue. Please try again later.
              </p>
              <Button 
                variant="default" 
                className="mt-6" 
                onClick={() => {
                  console.log("Retry connection clicked");
                  refetchMatches();
                }}
                disabled={isLoading || isRefetching}
              >
                {(isLoading || isRefetching) ? (
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
        ) : matches.length > 0 ? (
          <div className={`relative px-0 ${deviceType === 'mobile' ? 'h-full' : ''}`}>
            {/* Carousel navigation buttons - only shown on larger screens (sm and up) */}
            <>
              {canScrollPrev && (
                <button 
                  className="absolute left-4 top-1/2 z-10 hidden sm:flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/80 shadow-md hover:bg-white opacity-100 cursor-pointer"
                  onClick={() => emblaApi?.scrollPrev()}
                  aria-label="Previous slide"
                >
                  <ChevronLeft className="h-6 w-6 text-gray-700" />
                </button>
              )}
              {canScrollNext && (
                <button 
                  className="absolute right-4 top-1/2 z-10 hidden sm:flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/80 shadow-md hover:bg-white opacity-100 cursor-pointer"
                  onClick={() => emblaApi?.scrollNext()}
                  aria-label="Next slide"
                >
                  <ChevronRight className="h-6 w-6 text-gray-700" />
                </button>
              )}
            </>
            <div className="overflow-hidden h-full" ref={emblaRef}>
              <div className={`flex gap-6 px-4 h-full ${deviceType === 'mobile' ? '' : 'py-4'}`}>
                {matches.map((match) => (
                  <div 
                    key={match.id} 
                    className="flex-[0_0_calc(100%-2rem)] sm:flex-[0_0_300px] md:flex-[0_0_350px] lg:flex-[0_0_400px] min-w-0 relative cursor-pointer touch-manipulation active:scale-95 transition-all duration-200"
                    onClick={() => setSelectedProfile(match)}
                    style={{
                      // Calculate card height based on viewport, being very conservative for mobile
                      // Account for header, mobile nav, safe areas, margins, and extra buffer
                      height: deviceType === 'mobile' ? 'calc(100vh - 380px)' : undefined
                    }}
                  >
                    <div className="relative mx-2 h-full" style={{ 
                      marginTop: '1.5rem', 
                      marginBottom: deviceType === 'mobile' ? '20px' : '1.5rem' 
                    }}>
                      <div className={`relative h-full rounded-lg ${deviceType === 'desktop' ? 'shadow-[0_0_25px_5px_hsl(215,20%,65%),0_0_35px_10px_hsl(215,20%,65%)]' : 'shadow-[0_0_20px_-2px_hsl(215,20%,65%),0_0_30px_-5px_hsl(215,20%,65%)]'} min-h-[400px]`}>
                        {/* Background container without border */}
                        <div className="absolute inset-0 rounded-lg overflow-hidden">
                          {/* White inner content container */}
                          <div className="h-full w-full bg-white flex flex-col overflow-hidden relative rounded-lg">
                            {/* Inset border with z-index above shadow but below banner - using border instead of box-shadow for consistent corners */}
                            <div className={`absolute inset-0 pointer-events-none z-[3] ${deviceType === 'desktop' ? 'border-0' : 'border-[3px] border-[hsl(215,20%,65%)]'} rounded-lg overflow-hidden`}
                            ></div>
                            {/* Profile image section - fixed height like desktop, only shrink as last resort */}
                            <div 
                              className="relative overflow-hidden rounded-t-lg"
                              style={{
                                // Image section maintains fixed height like desktop - content should shrink first
                                height: deviceType === 'mobile' 
                                  ? viewportHeight >= 450 ? '320px' 
                                    : '280px' // Only shrink when very limited space
                                  : '300px',
                                minHeight: deviceType === 'mobile' ? '280px' : '200px'
                              }}
                            >
                              {/* Check for valid photo (not placeholder) */}
                              {match.photo && 
                               !match.photo.includes('placeholder') && 
                               match.photo !== '/placeholder.jpg' ? (
                                <div className="w-full h-full overflow-hidden relative rounded-t-lg">
                                  <img
                                    src={match.photo}
                                    alt={match.fullName}
                                    className="w-full h-full object-cover object-top"
                                    style={{ borderTopLeftRadius: '5px', borderTopRightRadius: '5px' }}
                                  />
                                  {/* Image gradient overlay */}
                                  <div className="absolute inset-0 rounded-t-lg" 
                                    style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0) 25%)' }}>
                                  </div>
                                </div>
                              ) : (
                                <div className="w-full h-full bg-primary flex items-center justify-center relative rounded-t-lg">
                                  <span className="text-white text-6xl font-bold">
                                    {getInitials(match.fullName)}
                                  </span>
                                  <div className="absolute inset-0 rounded-t-lg"
                                    style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0) 100%)' }}>
                                  </div>
                                </div>
                              )}
                              
                              {/* Name and title overlay */}
                              <div className="absolute bottom-4 left-0 right-0 px-3 text-white">
                                <h2 className="text-2xl font-bold drop-shadow-md">{match.fullName}</h2>
                                <p className="text-base text-white/90 drop-shadow-md">{match.title}</p>
                              </div>
                            </div>
                            
                            {/* Content section - shrinks aggressively first before image section shrinks */}
                            <div 
                              className="p-3 space-y-2 overflow-y-hidden mt-1"
                              style={{
                                // Content section shrinks much more aggressively before image section is affected
                                flex: deviceType === 'mobile' ? '0 1 auto' : '1',
                                minHeight: deviceType === 'mobile' ? '0' : 'auto',
                                maxHeight: deviceType === 'mobile' 
                                  ? viewportHeight >= 700 ? 'calc(50% - 120px)'
                                    : viewportHeight >= 600 ? 'calc(35% - 100px)'
                                    : viewportHeight >= 500 ? 'calc(25% - 80px)'
                                    : 'calc(15% - 60px)' // Very aggressive shrinking
                                  : 'none'
                              }}
                            >
                              {/* Basic info section */}
                              <div className="flex flex-col gap-1.5 bg-muted/10 rounded-lg p-2">
                                <div className="flex items-center gap-1.5">
                                  <MapPin className="w-4 h-4 text-muted-foreground" />
                                  <span className="text-sm text-muted-foreground">{match.currentLocation || "Location not specified"}</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <Building2 className="w-4 h-4 text-muted-foreground" />
                                  <span className="text-sm text-muted-foreground">{match.currentCompany || "Company not specified"}</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <Briefcase className="w-4 h-4 text-muted-foreground" />
                                  <span className="text-sm text-muted-foreground">
                                    {match.industry ? `${match.industry} - ${match.yearsOfExperience} years` : "Industry not specified"}
                                  </span>
                                </div>
                              </div>
                              
                              {/* Content sections with responsive hiding based on available space */}
                              {(() => {
                                const visibility = deviceType === 'mobile' ? getContentVisibility() : {
                                  showEducation: true,
                                  showBio: true,
                                  showInterests: true,
                                  showHobbies: true,
                                  showLanguages: true,
                                  showResume: true
                                };
                                
                                return (
                                  <>
                                    {/* Priority 1: Education (shows first when space allows) */}
                                    {match.institution && visibility.showEducation && (
                                      <div className="space-y-2">
                                        <h3 className="text-base font-semibold">Education</h3>
                                        <div className="text-sm text-muted-foreground">
                                          <p>{match.institution}</p>
                                        </div>
                                      </div>
                                    )}
                                    
                                    {/* Priority 2: Bio Section */}
                                    {match.bio && visibility.showBio && (
                                      <div className="space-y-2">
                                        <h3 className="text-base font-semibold">About Me</h3>
                                        <div className="prose prose-sm max-w-none text-muted-foreground line-clamp-2">
                                          <ReactMarkdown 
                                            allowedElements={['p', 'strong', 'em', 'ul', 'ol', 'li']}
                                            unwrapDisallowed
                                          >
                                            {match.bio}
                                          </ReactMarkdown>
                                        </div>
                                      </div>
                                    )}
                                    
                                    {/* Priority 3: Professional Interests */}
                                    {match.professionalInterests && match.professionalInterests.length > 0 && visibility.showInterests && (
                                      <div className="space-y-2">
                                        <h3 className="text-base font-semibold">Professional Interests</h3>
                                        <div className="flex flex-wrap gap-2">
                                          {match.professionalInterests.slice(0, 4).map((interest, index) => (
                                            <Badge key={`professional-${index}`} variant="outline">
                                              {interest}
                                            </Badge>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    
                                    {/* Priority 4: Hobbies */}
                                    {match.interests && match.interests.length > 0 && visibility.showHobbies && (
                                      <div className="space-y-2">
                                        <h3 className="text-base font-semibold">Hobbies</h3>
                                        <div className="flex flex-wrap gap-2">
                                          {match.interests.slice(0, 3).map((interest, index) => (
                                            <Badge key={`hobbies-${index}`} variant="outline">
                                              {interest}
                                            </Badge>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    
                                    {/* Priority 5: Languages */}
                                    {match.languages && match.languages.length > 0 && visibility.showLanguages && (
                                      <div className="space-y-2">
                                        <h3 className="text-base font-semibold">Languages</h3>
                                        <div className="flex flex-wrap gap-2">
                                          {match.languages.slice(0, 3).map((language, index) => (
                                            <Badge key={`language-${index}`} variant="outline">
                                              {language}
                                            </Badge>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    
                                    {/* Priority 6: Resume Section */}
                                    {match.resumePreviewUrls && match.resumePreviewUrls.length > 0 && visibility.showResume && (
                                      <div className="space-y-2">
                                        <h3 className="text-base font-semibold">Resume</h3>
                                        <div className="grid gap-4">
                                          {match.resumePreviewUrls.slice(0, 1).map((previewUrl, index) => (
                                            <div 
                                              key={`resume-${index}`}
                                              className={`relative ${deviceType === 'desktop' ? 'border-0' : 'border'} rounded-lg overflow-hidden cursor-pointer`}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setSelectedProfile(match);
                                              }}
                                            >
                                              <img
                                                src={previewUrl}
                                                alt={`${match.fullName}'s resume page ${index + 1}`}
                                                className="w-full h-auto"
                                                loading="lazy"
                                              />
                                              <div className="absolute bottom-2 left-2 bg-primary/80 text-white text-xs px-2 py-1 rounded-md flex items-center gap-1">
                                                <FileText className="w-3 h-3" />
                                                Tap to view full resume
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </>
                                );
                              })()}
                            </div>
                            
                            {/* Match description banner at bottom */}
                            <div className="mt-auto w-full relative">
                              {/* Shadow element at z-[2] - below the border (z-[3]) */}
                              {deviceType !== 'desktop' && (
                                <div 
                                  className="absolute inset-0 z-[2] rounded-b-lg pointer-events-none"
                                  style={{ 
                                    boxShadow: '0 -3px 8px 0px rgba(0, 0, 0, 0.18)'
                                  }}
                                />
                              )}
                              {/* Banner content at z-[4] - above the border (z-[3]) */}
                              <div 
                                className="flex flex-col items-center justify-center min-h-[4rem] py-3 overflow-hidden w-full relative z-[4] rounded-b-lg" 
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
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center" style={{ 
              minHeight: '60vh',
              width: '100%',
              padding: '0 16px'
            }}>
            <div className="text-center">
              <h2 className="text-xl font-semibold mb-2">
                No matches found
              </h2>
              <p className="text-sm text-muted-foreground max-w-md">
                The Referral network is still growing. Come back later or update your preferences to find new connections!
              </p>
            </div>
          </div>
        )}
      </div>

      {selectedProfile && (() => {
        const incomingRequest = incomingRequests.find(
          (req) => req.senderId === selectedProfile.id && req.status === 'requested'
        );
        return (
          <ProfileDialog
            profile={selectedProfile}
            open={!!selectedProfile}
            onOpenChange={(open) => !open && setSelectedProfile(null)}
            requestPending={outgoingRequests.some((request) => 
              request.receiverId === selectedProfile.id && request.status === 'requested'
            ) || connectingIds.includes(selectedProfile.id)}
            onConnectionStatusChange={handleConnectionStatusChange}
            hasIncomingRequest={!!incomingRequest}
            incomingRequestId={incomingRequest?.id}
            onRequestHandled={() => {
              queryClient.invalidateQueries({ queryKey: ["/api/connections/requests"] });
              queryClient.invalidateQueries({ queryKey: ["/api/connections"] });
            }}
          />
        );
      })()}
    </div>
  );
}