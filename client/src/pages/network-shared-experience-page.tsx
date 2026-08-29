import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { type User } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Loader2 } from "lucide-react";
import { useLocation } from "wouter";
import ProfilePreviewCard from "@/components/profile-preview-card";
import ProfileDialog from "@/components/profile-dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import { connectionRequestCache } from "@/hooks/use-profiles.tsx";

export default function NetworkSharedExperiencePage() {
  const [, setLocation] = useLocation();
  const [selectedProfile, setSelectedProfile] = useState<User | null>(null);
  const [connectingIds, setConnectingIds] = useState<number[]>([]);
  const { toast } = useToast();
  const hasLogged = useRef(false);

  // Get current user
  const { data: currentUser, isLoading: isLoadingUser } = useQuery<User>({
    queryKey: ["/api/user"],
  });

  // Get all potential connections
  const { data: potentialConnections = { profiles: [], hasMore: false }, isLoading: isLoadingUsers } = useQuery<{ profiles: User[], hasMore: boolean }>({
    queryKey: ["/api/network/potential"],
    refetchOnWindowFocus: false
  });
  
  // Extract the profiles from the response
  const allUsers = potentialConnections.profiles;

  // Log debugging information only once when data is loaded
  useEffect(() => {
    if (currentUser && allUsers.length > 0 && !hasLogged.current) {
      hasLogged.current = true;
      
      console.log("Current user id:", currentUser.id, "industry:", currentUser.industry, "experience:", currentUser.yearsOfExperience);
      console.log("Total users available for matching:", allUsers.length);
      
      // Find users with same industry for deeper investigation
      const sameIndustryUsers = allUsers.filter((user: User) => 
        user.id !== currentUser.id && user.industry === currentUser.industry
      );
      console.log("Users in same industry:", sameIndustryUsers.length);
      
      if (sameIndustryUsers.length > 0) {
        sameIndustryUsers.forEach((user: User) => {
          console.log(`User id: ${user.id}, industry: ${user.industry}, experience: ${user.yearsOfExperience}`);
        });
      }
    }
  }, [currentUser, allUsers]);
  
  // Perform the actual filtering for component rendering
  const usersWithSimilarExperience = allUsers.filter((user: User) => {
    // Don't include current user
    if (user.id === currentUser?.id) return false;

    // Must be in the same industry
    if (user.industry !== currentUser?.industry) return false;

    // Check for similar years of experience (within 1 year)
    const currentUserYears = currentUser?.yearsOfExperience || 0;
    const userYears = user.yearsOfExperience || 0;
    const yearDifference = Math.abs(currentUserYears - userYears);
    
    // Return true if they're within 1 year of experience level
    return yearDifference <= 1;
  });

  // Interface for outgoing connection requests (matches API response)
  interface IncomingRequest {
    id: number;
    userId: number;
    senderId: number;
    status: string;
    createdAt: string;
    sender?: User;
  }

  interface OutgoingRequest {
    id: number;
    senderId: number;
    receiverId: number;
    status: string;
    createdAt: string;
  }

  // Get outgoing connection requests to show pending status
  const { data: outgoingRequests = [], isFetching: isFetchingOutgoing } = useQuery<OutgoingRequest[]>({
    queryKey: ["/api/connections/outgoing"],
    retry: 3,
    refetchInterval: 10000,
    staleTime: 0
  });

  const { data: incomingRequests = [] } = useQuery<IncomingRequest[]>({
    queryKey: ["/api/connections/requests"],
    retry: 3,
    refetchInterval: 30000,
    staleTime: 10000
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
      console.log('[NetworkSharedExperiencePage] Cache subscription triggered, updating connectingIds:', updatedUserIds);
      setConnectingIds(updatedUserIds);
    });
    return unsubscribe;
  }, []);

  // Sync connectingIds state with outgoing requests from the server
  // Wait until isFetching is false to ensure we have fresh server data
  useEffect(() => {
    if (isFetchingOutgoing) {
      console.log('[NetworkSharedExperiencePage] Skipping sync - still fetching from server');
      return;
    }
    
    if (Array.isArray(outgoingRequests)) {
      // Sync cache with server data - this prunes stale entries
      const receiverIds = outgoingRequests
        .filter(req => req.status === 'requested')
        .map(req => req.receiverId);
      console.log('[NetworkSharedExperiencePage] Syncing cache with fresh server data, receiverIds:', receiverIds);
      connectionRequestCache.syncWithServerData(receiverIds);
      
      // Update local state from the now-synced cache
      const cachedPendingIds = connectionRequestCache.getPendingRequests();
      setConnectingIds(cachedPendingIds);
    }
  }, [outgoingRequests, isFetchingOutgoing]);

  // Check if we need to reopen a profile dialog (coming back from resume view)
  useEffect(() => {
    // Check for stored profile ID in session storage
    const storedProfileId = sessionStorage.getItem('reopenProfileId');
    if (storedProfileId) {
      console.log(`Found stored profile ID: ${storedProfileId}, will attempt to reopen dialog`);
      
      // Clear it immediately to prevent reopening on future navigations
      sessionStorage.removeItem('reopenProfileId');
      
      // Check if we should reopen immediately (without waiting for animation)
      const isInstantReopen = sessionStorage.getItem('instantReopenProfile') === 'true';
      if (isInstantReopen) {
        // Clear the flag
        sessionStorage.removeItem('instantReopenProfile');
      }
      
      // Find the profile in our loaded profiles
      const profileToShow = usersWithSimilarExperience.find(p => p.id === Number(storedProfileId));
      
      if (profileToShow) {
        console.log(`Found profile to reopen:`, profileToShow);
        
        if (isInstantReopen) {
          // Set it immediately to prevent seeing the network page first
          setSelectedProfile(profileToShow);
        } else {
          // For non-instant reopens, set a short timeout to ensure the page is fully loaded
          setTimeout(() => {
            setSelectedProfile(profileToShow);
          }, 100);
        }
      } else {
        console.log(`Could not find profile with ID ${storedProfileId} in loaded profiles`);
      }
    }
  }, [usersWithSimilarExperience]);

  // Track pending requests for UI
  const pendingRequests = new Map<number, 'incoming' | 'outgoing'>();

  // Add incoming requests
  if (Array.isArray(incomingRequests)) {
    incomingRequests.forEach((req: IncomingRequest) => {
      if (req?.status === 'requested' && req?.userId) {
        pendingRequests.set(req.userId, 'incoming');
      }
    });
  }

  // Add outgoing requests
  if (Array.isArray(outgoingRequests)) {
    outgoingRequests.forEach((req: OutgoingRequest) => {
      if (req.status === 'requested' && req.receiverId) {
        pendingRequests.set(req.receiverId, 'outgoing');
      }
    });
  }

  // Also include any IDs from the connectingIds state
  connectingIds.forEach(id => {
    if (!pendingRequests.has(id)) {
      pendingRequests.set(id, 'outgoing');
    }
  });
  
  // Add connection requests from shared cache
  const cachedPendingIds = connectionRequestCache.getPendingRequests();
  cachedPendingIds.forEach((id: number) => {
    if (!pendingRequests.has(id)) {
      console.log(`NetworkSharedExperiencePage: Adding cached connection request for user ${id}`);
      pendingRequests.set(id, 'outgoing');
    }
  });

  // Connect mutation
  const connectMutation = useMutation({
    mutationFn: async (userId: number) => {
      // Check if this is a connect or cancel action
      const isAlreadyConnecting = connectingIds.includes(userId);
      
      if (isAlreadyConnecting) {
        // Cancel the request
        await apiRequest(
          "DELETE",
          `/api/connections/request/${userId}`
        );
        return { userId, status: "canceled" };
      } else {
        // Send a new request
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
      }
    },
    onMutate: (userId) => {
      // Update UI immediately
      const isAlreadyConnecting = connectingIds.includes(userId);
      
      if (isAlreadyConnecting) {
        // Remove from connecting state
        setConnectingIds(prev => prev.filter(id => id !== userId));
        
        // Remove from shared cache
        connectionRequestCache.removePendingRequest(userId);
      } else {
        // Add to connecting state
        setConnectingIds(prev => [...prev, userId]);
        
        // Add to shared cache
        connectionRequestCache.addPendingRequest(userId);
      }
    },
    onSuccess: (result) => {
      const { status } = result;
      
      if (status === "duplicate") {
        toast({
          title: "Connection already requested",
          description: "You've already sent a connection request to this user."
        });
      } else if (status === "canceled") {
        toast({
          title: "Request canceled",
          description: "The connection request has been canceled."
        });
      } else {
        toast({
          title: "Connection request sent",
          description: "The user will be notified of your request."
        });
      }
      
      // Refresh connection data
      queryClient.invalidateQueries({ queryKey: ["/api/connections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/connections/requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/connections/outgoing"] });
    },
    onError: (error, userId) => {
      console.error("Connection error:", error);
      
      const wasConnecting = !connectingIds.includes(userId);
      
      toast({
        title: "Error",
        description: wasConnecting 
          ? "Failed to send connection request. Please try again."
          : "Failed to cancel connection request. Please try again.",
        variant: "destructive",
      });
      
      // Revert UI changes
      if (wasConnecting) {
        setConnectingIds(prev => prev.filter(id => id !== userId));
        
        // Remove from shared cache
        connectionRequestCache.removePendingRequest(userId);
      } else {
        setConnectingIds(prev => [...prev, userId]);
        
        // Add back to shared cache
        connectionRequestCache.addPendingRequest(userId);
      }
    },
  });

  // Handle connection button clicks
  const handleConnect = useCallback((userId: number) => {
    if (connectMutation.isPending) return;
    connectMutation.mutate(userId);
  }, [connectMutation]);

  // Function to handle connection status changes from the dialog
  const handleConnectionStatusChange = useCallback((profileId: number, isPending: boolean) => {
    if (isPending) {
      setConnectingIds(prev => prev.includes(profileId) ? prev : [...prev, profileId]);
    } else {
      setConnectingIds(prev => prev.filter(id => id !== profileId));
    }
  }, []);

  // Show loading state
  if (isLoadingUser || isLoadingUsers) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-4rem)] bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
        <p className="text-muted-foreground">Finding people with similar experience...</p>
      </div>
    );
  }

  return (
    <div className="network-page-container flex flex-col h-[100dvh] max-w-full w-full overflow-hidden">
      {/* Universal header with back button and title - fixed height */}
      <div className="flex-shrink-0 flex items-center relative p-2 pt-3">
        {/* Back button */}
        <Button
          variant="ghost"
          size="sm"
          className="p-1 font-bold flex items-center text-primary hover:text-primary hover:bg-transparent active:bg-transparent"
          onClick={() => setLocation('/')}
          aria-label="Back"
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={3.5} />
          <span className="hidden desktop:inline ml-1">Back</span>
        </Button>
        
        {/* Title */}
        <h1 className="text-lg font-bold absolute left-0 right-0 text-center pointer-events-none">
          Shared Experience
        </h1>
      </div>
      
      {/* Scrollable content area - iOS Capacitor scroll fix: flex-1 with min-h-0 */}
      <div 
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden network-page-scrollable"
        style={{ 
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'none'
        }}
      >
        {/* Description box */}
        <div className="text-center mb-4 mx-2">
          <div className="border rounded-md py-3 px-4">
            <p className="text-muted-foreground text-sm">
              Find professionals in the {currentUser?.industry} industry with similar experience as you
            </p>
          </div>
        </div>
        
        {usersWithSimilarExperience.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center" style={{ minHeight: '60vh' }}>
            <div className="text-center px-4">
              <p className="text-lg text-center text-muted-foreground mb-2">
                No profiles found with similar experience in your industry
              </p>
              <Button
                variant="outline"
                onClick={() => setLocation('/network/search')}
                className="gap-2 mt-2"
              >
                Search All Users
              </Button>
            </div>
          </div>
        ) : (
          <div className="px-3 py-2 pb-40 grid grid-cols-2 desktop:grid-cols-4 gap-4">
            {usersWithSimilarExperience.map((profile) => (
              <ProfilePreviewCard
                key={profile.id}
                profile={profile}
                requestStatus={pendingRequests.get(profile.id)}
                onSelect={() => setSelectedProfile(profile)}
                onConnect={() => handleConnect(profile.id)}
              />
            ))}
          </div>
        )}
      </div>
      
      {/* Profile dialog */}
      {selectedProfile && (() => {
        const matchingIncomingRequest = Array.isArray(incomingRequests) 
          ? incomingRequests.find((req: IncomingRequest) => req.senderId === selectedProfile.id && req.status === 'requested')
          : undefined;
        
        return (
          <ProfileDialog
            profile={selectedProfile}
            open={!!selectedProfile}
            onOpenChange={(isOpen) => {
              if (!isOpen) setSelectedProfile(null);
            }}
            requestPending={pendingRequests.get(selectedProfile.id) === 'outgoing' || connectingIds.includes(selectedProfile.id)}
            onConnectionStatusChange={handleConnectionStatusChange}
            hasIncomingRequest={!!matchingIncomingRequest}
            incomingRequestId={matchingIncomingRequest?.id}
            onRequestHandled={() => {
              queryClient.invalidateQueries({ queryKey: ["/api/connections/requests"] });
              queryClient.invalidateQueries({ queryKey: ["/api/connections"] });
              queryClient.invalidateQueries({ queryKey: ["/api/connections/outgoing"] });
            }}
          />
        );
      })()}
    </div>
  );
}