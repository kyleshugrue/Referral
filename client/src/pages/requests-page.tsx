import { useQuery, useMutation } from "@tanstack/react-query";
import { User, ConnectionRequest } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import ProfileDialog from "@/components/profile-dialog";
import { useLocation } from "wouter";
import { getInitials } from "@/lib/avatar-utils";
import { getDisplayName } from "@/lib/name-utils";
import { SynergyIcon } from "@/components/icons/synergy-icon";
import { useDeviceType } from "@/hooks/use-device-type";

interface RequestWithSender extends ConnectionRequest {
  sender: User;
  matchDescription?: string;
}

export default function RequestsPage() {
  const { toast } = useToast();
  const [location] = useLocation();
  const [selectedProfile, setSelectedProfile] = useState<User | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);
  const deviceType = useDeviceType();

  // Scroll to top on mobile when navigating to this page
  useEffect(() => {
    if (deviceType !== 'desktop' && location === '/requests') {
      window.scrollTo(0, 0);
    }
  }, [location, deviceType]);
  
  // Track screen size for responsive rendering
  useEffect(() => {
    const checkIsDesktop = () => {
      setIsDesktop(window.innerWidth >= 768);
    };
    
    checkIsDesktop();
    window.addEventListener('resize', checkIsDesktop);
    
    return () => window.removeEventListener('resize', checkIsDesktop);
  }, []);

  // Initialize WebSocket connection

  // Query to fetch pending requests
  const { data: requests = [], isLoading } = useQuery<RequestWithSender[]>({
    queryKey: ["/api/connections/requests"],
    staleTime: 10000, // Refresh data every 10 seconds
    refetchInterval: 15000, // Poll for new requests every 15 seconds
  });
  
  // Check if we need to reopen a profile dialog (coming back from resume view)
  useEffect(() => {
    // Check for stored profile ID in session storage
    const storedProfileId = sessionStorage.getItem('reopenProfileId');
    const returnPathSource = sessionStorage.getItem('returnPathSource');
    
    // Only proceed if we have a profile ID and the return path contains '/requests'
    // or if we don't have a return path source (for backward compatibility)
    if (storedProfileId && (!returnPathSource || returnPathSource.includes('/requests'))) {
      console.log(`RequestsPage: Found stored profile ID ${storedProfileId}, will attempt to reopen dialog`);
      
      // Clear it immediately to prevent reopening on future navigations
      sessionStorage.removeItem('reopenProfileId');
      
      // Check if we should reopen immediately (without waiting for animation)
      const isInstantReopen = sessionStorage.getItem('instantReopenProfile') === 'true';
      if (isInstantReopen) {
        // Clear the flag
        sessionStorage.removeItem('instantReopenProfile');
      }
      
      // Find the profile in our loaded requests
      if (requests && requests.length > 0) {
        const profileToShow = requests.find(request => request.sender.id === Number(storedProfileId))?.sender;
        
        if (profileToShow) {
          console.log(`RequestsPage: Found profile to reopen:`, profileToShow);
          
          // Set timeout to ensure the page is fully loaded
          const timeoutDelay = isInstantReopen ? 0 : 100;
          setTimeout(() => {
            setSelectedProfile(profileToShow);
          }, timeoutDelay);
        } else {
          console.log(`RequestsPage: Could not find profile with ID ${storedProfileId} in loaded requests`);
        }
      }
    }
  }, [requests]);

  // Mutation for handling requests
  const handleRequest = useMutation({
    mutationFn: async ({ id, action }: { id: number; action: "accepted" | "rejected" }) => {
      const response = await apiRequest(
        "PATCH",
        `/api/connections/${id}`,
        { status: action }
      );

      if (!response.ok) {
        const error = await response.text();
        try {
          const errorJson = JSON.parse(error);
          throw new Error(errorJson.message || `Failed to ${action} connection request`);
        } catch {
          throw new Error(`Failed to ${action} connection request: ${error}`);
        }
      }

      // Handle both JSON and non-JSON responses
      let connection;
      const responseText = await response.text();
      try {
        connection = responseText ? JSON.parse(responseText) : {};
      } catch {
        // If it's not JSON, just use the text response
        connection = { message: responseText };
      }

      return { connection, action, id };
    },
    onMutate: async (variables) => {
      // Cancel any outgoing refetches to avoid overwriting our optimistic update
      await queryClient.cancelQueries({ queryKey: ["/api/connections/requests"] });
      
      // Snapshot the previous value
      const previousRequests = queryClient.getQueryData<RequestWithSender[]>(["/api/connections/requests"]);
      
      // Optimistically update the UI by removing the request for both accept and ignore actions
      if (previousRequests) {
        queryClient.setQueryData<RequestWithSender[]>(
          ["/api/connections/requests"],
          previousRequests.filter(request => request.id !== variables.id)
        );
      }
      
      return { previousRequests };
    },
    onSuccess: (data) => {
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ["/api/connections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/connections/requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/counts"] });

      // Show success message
      if (data.action === "rejected") {
        toast({
          title: "Request declined",
          description: "The connection request has been declined and removed",
        });
        
      } else {
        toast({
          title: "Connection accepted",
          description: "You are now connected! You can start messaging each other.",
        });
        // Stay on the requests page as requested
      }
    },
    onError: (error: Error, _variables, context) => {
      console.error("Failed to handle request:", error);
      // If there was an error, roll back to the previous state
      if (context?.previousRequests) {
        queryClient.setQueryData(["/api/connections/requests"], context.previousRequests);
      }
      toast({
        title: "Error",
        description: error.message || "Failed to process connection request",
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[100dvh]">
        <Loader2 className="h-6 w-6 sm:h-8 sm:w-8 animate-spin" />
      </div>
    );
  }

  // Content for both mobile and desktop views
  const requestCards = requests.length > 0 ? (
    requests.map((request) => (
      <div className="relative" key={request.id}>
        <Card
          className={`relative overflow-hidden cursor-pointer hover:bg-accent/50 transition-colors rounded-xl shadow-sm z-10 ${!request.matchDescription ? 'border-2 border-gray-200' : 'border-0'}`}
          onClick={() => setSelectedProfile(request.sender)}
          style={{
            borderBottomLeftRadius: request.matchDescription ? '0' : '',
            borderBottomRightRadius: request.matchDescription ? '0' : ''
          }}
        >
          {request.matchDescription && (
            <div className="absolute inset-0 pointer-events-none z-[1] border-[3px] border-[hsl(215,20%,65%)] rounded-xl rounded-b-none overflow-hidden"></div>
          )}
          <CardContent className={`p-4 sm:p-6 relative ${request.matchDescription ? 'pb-6' : ''}`}>
            <div className="flex items-center justify-between">
              {/* Left side: Profile picture and user info */}
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-10 w-10 sm:h-14 sm:w-14 rounded-full overflow-hidden flex-shrink-0 bg-muted">
                  {/* Check for valid photo (not placeholder) */}
                  {request.sender.photo && 
                   !request.sender.photo.includes('placeholder') && 
                   request.sender.photo !== '/placeholder.jpg' ? (
                    <img
                      src={request.sender.photo}
                      alt={getDisplayName(request.sender.fullName)}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="h-full w-full bg-primary flex items-center justify-center text-white text-sm font-medium">
                      {getInitials(getDisplayName(request.sender.fullName))}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-base sm:text-lg truncate">
                    {getDisplayName(request.sender.fullName)}
                  </h3>
                  <p className="text-sm text-muted-foreground truncate">
                    {request.sender.currentCompany} • {request.sender.industry}
                  </p>
                </div>
              </div>
              
              {/* Right side: Action buttons - side by side and vertically centered */}
              <div className="flex gap-2 ml-4 items-center self-center">
                <Button
                  className="gap-1 py-1 px-3 h-auto rounded-md bg-[#2a3646] text-white hover:bg-[#1e2835] text-sm"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleRequest.mutate({ id: request.id, action: "accepted" });
                  }}
                  disabled={handleRequest.isPending}
                >
                  {handleRequest.isPending ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span className="text-xs">Accepting...</span>
                    </>
                  ) : (
                    "Accept"
                  )}
                </Button>
                <Button
                  variant="secondary"
                  className="gap-1 py-1 px-3 h-auto rounded-md bg-[#8e9eb6] text-white hover:bg-[#7d8ca3] text-sm"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleRequest.mutate({ id: request.id, action: "rejected" });
                  }}
                  disabled={handleRequest.isPending}
                >
                  {handleRequest.isPending ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span className="text-xs">Ignoring...</span>
                    </>
                  ) : (
                    "Ignore"
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
        
        {/* Display AI match description banner if available - as a clickable element */}
        {request.matchDescription && (
          <div 
            className="overflow-hidden rounded-b-xl w-full z-30 relative cursor-pointer" 
            style={{ marginTop: '-4px' }}
            onClick={() => setSelectedProfile(request.sender)}
          >
            <div 
              className="flex flex-col items-center justify-center w-full relative py-5 z-30 bg-gradient-to-t from-[hsl(215,25%,45%)] via-[hsl(215,25%,45%)] to-[hsl(215,20%,65%)]"
              style={{ 
                boxShadow: '0 -5px 10px 0px rgba(0, 0, 0, 0.25)',
                borderBottomLeftRadius: '0.75rem',
                borderBottomRightRadius: '0.75rem'
              }}
            >
              {/* No border on the banner anymore */}
              
              <div className="flex items-center gap-1.5 mb-2 relative z-10">
                <SynergyIcon className="text-white w-4 h-4" />
                <span className="text-sm font-medium text-white">Synergy AI Match</span>
              </div>
              <p className="text-sm text-white leading-tight px-6 text-center relative z-10">
                {request.matchDescription
                  .replace(/\[.*?\]/g, '') // Remove text in square brackets
                  .replace(/\(.*?\)/g, '') // Remove text in parentheses
                  .replace(/\{.*?\}/g, '') // Remove text in curly braces
                  .replace(/["']/g, '') // Remove quotation marks
                  .trim() // Remove extra whitespace
                }
              </p>
            </div>
          </div>
        )}
      </div>
    ))
  ) : (
    <div className="flex items-center justify-center min-h-[65vh]">
      <div className="text-center px-4 mx-4">
        <h2 className="text-xl font-semibold mb-2">
          No pending requests
        </h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          When someone wants to connect with you, their request will appear here
        </p>
      </div>
    </div>
  );

  // Function to handle connection status changes from the dialog
  const handleConnectionStatusChange = (profileId: number, isPending: boolean) => {
    console.log(`RequestsPage - Connection status changed for ${profileId}: ${isPending ? 'pending' : 'not pending'}`);
    
    // If a connection request is accepted or rejected, refresh the page data
    if (!isPending) {
      queryClient.invalidateQueries({ queryKey: ["/api/connections/requests"] });
    }
  };

  // Profile dialog for both views
  const profileDialogElement = selectedProfile && (
    <ProfileDialog
      profile={selectedProfile}
      open={!!selectedProfile}
      onOpenChange={(open) => !open && setSelectedProfile(null)}
      requestPending={true}
      onConnectionStatusChange={handleConnectionStatusChange}
    />
  );

  // Return both mobile and desktop views
  return (
    <>
      {/* Mobile View */}
      {!isDesktop && (
      <div className="min-h-[100dvh] bg-background flex flex-col">
        {/* Header Section - Mobile View */}
        <div className="container mx-auto pl-4 pr-4 pt-1 pb-2 flex-none">
          <div className="flex items-center justify-start">
            <h1 className="text-2xl font-bold text-primary">
              Connection Requests
            </h1>
          </div>
        </div>
        
        <div className="flex-1 flex justify-center">
          {/* Content for Mobile */}
          <div className="space-y-4 pb-4 px-4 w-full max-w-sm">
            {requestCards}
          </div>
        </div>
        
        {profileDialogElement}
      </div>
      )}

      {/* Desktop View - Completely separate layout */}
      {isDesktop && (
      <div className="min-h-screen bg-background">
        {/* Desktop title section with perfect centering - force override */}
        <div className="w-full flex justify-center items-center py-8" style={{ justifyContent: 'center !important' }}>
          <h1 className="text-2xl font-bold text-primary text-center">
            Connection Requests
          </h1>
        </div>
        
        {/* Desktop content section */}
        <div className="max-w-3xl mx-auto px-6">
          <div className="space-y-4">
            {requestCards}
          </div>
        </div>
        
        {profileDialogElement}
      </div>
      )}
    </>
  );
}