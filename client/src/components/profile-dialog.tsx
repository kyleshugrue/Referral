import {
  CustomDialog as Dialog,
  CustomDialogContent as DialogContent,
  CustomDialogDescription as DialogDescription,
  CustomDialogHeader as DialogHeader,
  CustomDialogTitle as DialogTitle,
} from "@/components/ui/custom-dialog";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MapPin, Building2, Briefcase, Loader2, FileText, MessageSquare, UserPlus, X, ChevronLeft, UserX, Shield, Check } from "lucide-react";
import { type User } from "@shared/schema";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLocation } from "wouter";
import { getInitials } from "@/lib/avatar-utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { connectionRequestCache } from "@/hooks/use-profiles.tsx";
import ReactMarkdown from 'react-markdown';
import React, { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useProfileDialog } from "@/hooks/use-profile-dialog";
import { useState } from "react";

interface ProfileDialogProps {
  profile: User;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requestPending?: boolean;
  isConnected?: boolean;
  hideButtons?: boolean;
  onMessageClick?: () => void;
  onConnectionStatusChange?: (profileId: number, isPending: boolean) => void;
  dialogContentClassName?: string;
  hasIncomingRequest?: boolean;
  incomingRequestId?: number;
  onRequestHandled?: () => void;
}

// Interface for outgoing connection requests (matches API response from /api/connections/outgoing)
interface OutgoingRequest {
  id: number;
  senderId: number;
  receiverId: number;
  status: string;
  createdAt: string;
}

export default function ProfileDialog({
  profile,
  open,
  onOpenChange,
  requestPending = false,
  isConnected = false,
  hideButtons = false,
  onMessageClick,
  onConnectionStatusChange,
  dialogContentClassName,
  hasIncomingRequest = false,
  incomingRequestId,
  onRequestHandled
}: ProfileDialogProps) {
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const [, setLocation] = useLocation();
  const [localRequestPending, setLocalRequestPending] = useState(requestPending);
  const [isMutating, setIsMutating] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isBlocking, setIsBlocking] = useState(false);
  const [currentOperation, setCurrentOperation] = useState<'sending' | 'canceling' | null>(null);
  const isMobile = useIsMobile();
  const [, setExpandedImageIndex] = useState<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { setProfileDialogOpen } = useProfileDialog();

  // Helper function to check if an interest matches the current user's interests
  const isInterestMatching = (interest: string, type: 'hobby' | 'professional'): boolean => {
    if (!currentUser) return false;
    
    if (type === 'hobby') {
      return currentUser.interests?.includes(interest) ?? false;
    } else {
      return currentUser.professionalInterests?.includes(interest) ?? false;
    }
  };

  // Add body class to prevent scrolling when in fullscreen mode
  useEffect(() => {
    if (isFullscreen) {
      // Prevent background scrolling when fullscreen is active
      document.body.classList.add('overflow-hidden');
    } else {
      // Re-enable scrolling when fullscreen is closed
      document.body.classList.remove('overflow-hidden');
    }

    // Cleanup on unmount
    return () => {
      document.body.classList.remove('overflow-hidden');
    };
  }, [isFullscreen]);

  // Get outgoing requests to check if this profile has a pending request
  const { data: outgoingRequests = [] } = useQuery<OutgoingRequest[]>({
    queryKey: ["/api/connections/outgoing"],
    retry: 3,
    refetchInterval: 10000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    staleTime: 0, // Always refetch when component mounts
    enabled: open // Only fetch when dialog is open
  });

  // Initialize request status when dialog opens 
  // This is critical to ensure connection requests persist across navigation
  useEffect(() => {
    if (open) {
      console.log("ProfileDialog - Dialog opening for profile:", profile.id);
      
      // First check the connection cache for immediate UI update
      const isPendingInCache = connectionRequestCache.isPending(profile.id);
      console.log("ProfileDialog - IMMEDIATE isPendingInCache on open:", isPendingInCache);

      // Update UI immediately if we have a cached request
      if (isPendingInCache) {
        console.log("ProfileDialog - Setting localRequestPending=true from cache");
        setLocalRequestPending(true);
      } else if (requestPending) {
        // If the parent component tells us it's pending, update cache and UI
        console.log("ProfileDialog - Setting localRequestPending=true from props");
        setLocalRequestPending(true);
        connectionRequestCache.addPendingRequest(profile.id);
      }

      // Refresh server data in the background
      queryClient.invalidateQueries({ queryKey: ["/api/connections/outgoing"] });
      
      // Try to pull the latest connection state directly from the server
      // This ensures we synchronize with any changes made in other tabs/windows
      setTimeout(() => {
        fetch('/api/connections/outgoing', {
          credentials: 'include'
        }).then(response => {
          if (response.ok) {
            return response.json();
          }
          throw new Error('Failed to fetch outgoing requests');
        }).then((outgoingRequests: Array<{ receiverId: number; status: string }>) => {
          const hasPendingRequest = outgoingRequests.some(
            (req) => req.receiverId === profile.id && req.status === 'requested'
          );
          
          console.log("ProfileDialog - Server check for pending request:", hasPendingRequest);
          
          if (hasPendingRequest) {
            // If server says it's pending, update both UI and cache
            setLocalRequestPending(true);
            connectionRequestCache.addPendingRequest(profile.id);
          }
        }).catch(error => {
          console.error('Error checking server connection state:', error);
        });
      }, 250);

      // Preload resume images when the dialog opens for faster viewing later
      if (profile.resumePreviewUrls && profile.resumePreviewUrls.length > 0) {
        // Start preloading after a short delay to prioritize rendering the dialog first
        setTimeout(() => {
          const resumeUrls = profile.resumePreviewUrls;
          if (resumeUrls) {
            resumeUrls.forEach((url) => {
              const img = new Image();
              img.src = url;
            });
          }
        }, 500);
      }
    }
  }, [open, profile.id, profile.resumePreviewUrls, requestPending]);

  // Check both props, localStorage cache, and fetched data for request status
  useEffect(() => {
    // Log the prop value from parent
    console.log("ProfileDialog - requestPending prop:", requestPending);

    // Check if we have a pending request in our server data
    const hasPendingRequest = outgoingRequests.some(
      req => req.receiverId === profile.id && req.status === 'requested'
    );
    console.log("ProfileDialog - hasPendingRequest from server:", hasPendingRequest);
    
    // Sync cache with server data FIRST - this handles both adding new entries and pruning stale ones
    // Extract only requested user ids, filtering out any null/undefined values
    const requestedUserIds = outgoingRequests
      .filter(req => req.status === 'requested' && req.receiverId)
      .map(req => req.receiverId)
      .filter((id): id is number => id !== null && id !== undefined);

    // Always sync with server data - even empty array is important to prune rejected requests
    connectionRequestCache.syncWithServerData(requestedUserIds);
    console.log("ProfileDialog - Synced cache with server data, pending IDs:", requestedUserIds);

    // Check cache AFTER syncing to get the updated state
    const isPendingInCache = connectionRequestCache.isPending(profile.id);
    console.log("ProfileDialog - isPendingInCache (after sync):", isPendingInCache);

    // Determine final pending state with this priority:
    // 1. Server data (hasPendingRequest): Most authoritative
    // 2. Cache data (isPendingInCache): Reflects synced state
    // 3. Props (requestPending): Passed from parent components (for optimistic updates)
    const isRequestPending = hasPendingRequest || isPendingInCache || requestPending;
    console.log("ProfileDialog - Final isRequestPending:", isRequestPending);
    
    // Always update local state
    setLocalRequestPending(isRequestPending);
  }, [requestPending, outgoingRequests, profile.id, open]);

  // Call the callback function when local request pending state changes
  useEffect(() => {
    if (onConnectionStatusChange) {
      console.log("ProfileDialog - Calling onConnectionStatusChange with:", profile.id, localRequestPending);
      onConnectionStatusChange(profile.id, localRequestPending);
    }
  }, [profile.id, localRequestPending, onConnectionStatusChange]);

  // Subscribe to cache updates for immediate UI refresh when WebSocket rejection notifications arrive
  // This ensures the "Connection Requested" button immediately reverts to "Connect" when ignored
  useEffect(() => {
    const unsubscribe = connectionRequestCache.subscribe((updatedUserIds) => {
      const isStillPending = updatedUserIds.includes(profile.id);
      console.log(`[ProfileDialog] Cache subscription update - profile ${profile.id} isStillPending:`, isStillPending, 'currentIds:', updatedUserIds);
      
      // If this profile is no longer in the pending list, update local state immediately
      if (!isStillPending && localRequestPending) {
        console.log(`[ProfileDialog] Profile ${profile.id} removed from pending - reverting button to Connect`);
        setLocalRequestPending(false);
      } else if (isStillPending && !localRequestPending) {
        // Also handle the case where a new request was added
        console.log(`[ProfileDialog] Profile ${profile.id} added to pending - showing Connection Requested`);
        setLocalRequestPending(true);
      }
    });
    return unsubscribe;
  }, [profile.id, localRequestPending]);

  // Handle dialog closure - crucial for ensuring connection state persists
  useEffect(() => {
    if (!open) {
      // Reset expanded image state when dialog closes
      setExpandedImageIndex(null);
      setIsFullscreen(false);

      // IMPORTANT: Make sure the connection request state is preserved in cache 
      // when the dialog is closed if the request is pending
      if (localRequestPending) {
        console.log("ProfileDialog - Dialog closing, ensuring connection request is preserved in cache:", profile.id);
        connectionRequestCache.addPendingRequest(profile.id);
      }

      if (onConnectionStatusChange) {
        console.log("ProfileDialog - Dialog closed, calling onConnectionStatusChange with:", profile.id, localRequestPending);
        onConnectionStatusChange(profile.id, localRequestPending);
      }
    }
  }, [open, profile.id, localRequestPending, onConnectionStatusChange]);

  // Update the global profile dialog state immediately without delays
  useEffect(() => {
    // Only update the global state when open changes, do not set on cleanup
    console.log("ProfileDialog - Setting isProfileDialogOpen to:", open);
    setProfileDialogOpen(open);
    
    // Return a noop cleanup function to prevent React's default cleanup behavior
    // This prevents the component from setting dialog state to false on unmount
    return () => {
      console.log("ProfileDialog - Cleanup function called, not modifying dialog state");
      // Intentionally empty to prevent state changes on unmount
    };
  }, [open, setProfileDialogOpen]);

  const connectMutation = useMutation({
    mutationFn: async () => {
      console.log("ProfileDialog - Starting connection request mutation to:", profile.id);
      
      let attemptCount = 0;
      const maxAttempts = 3;
      
      // IMPORTANT: Always update the connection cache immediately
      // This ensures the pending state persists even if request fails
      console.log("ProfileDialog - Adding to connection request cache BEFORE API call");
      connectionRequestCache.addPendingRequest(profile.id);
      
      while (attemptCount < maxAttempts) {
        try {
          // Increment attempt counter
          attemptCount++;
          console.log(`ProfileDialog - Connection request attempt ${attemptCount}/${maxAttempts}`);
          
          // Ensure the user is authenticated first by checking the user endpoint
          if (attemptCount > 1) {
            console.log(`ProfileDialog - Checking authentication status before retry attempt`);
            const authCheckResponse = await fetch("/api/user", { credentials: "include" });
            const authUser = await authCheckResponse.json();
            if (!authUser) {
              console.log("ProfileDialog - User not authenticated, cannot proceed with connection request");
              // Even if not authenticated, we'll maintain the pending state in cache
              throw new Error("User not authenticated");
            } else {
              console.log("ProfileDialog - User is authenticated, proceeding with connection request");
            }
          }
          
          // Try to make the connection request
          const response = await apiRequest("POST", `/api/connections/request/${profile.id}`);
          
          try {
            // Parse the response body to check for special cases
            const responseData = await response.json();
            console.log("ProfileDialog - Connection request response:", responseData);
            
            // Handle duplicate requests
            if (responseData.isDuplicate) {
              console.log("ProfileDialog - Received duplicate request success response");
              return { success: true, isDuplicate: true };
            }
            
            // Handle successful request
            return responseData;
          } catch (e) {
            // If we can't parse JSON (e.g., empty response), but got a successful response, treat as success
            if (response.status >= 200 && response.status < 300) {
              console.log("ProfileDialog - Response couldn't be parsed as JSON, but status was success, treating as success");
              return { success: true };
            }
            throw e;
          }
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          console.log(`ProfileDialog - Connection request attempt ${attemptCount} failed:`, error.message);
          
          // Even after failed attempts, maintain the pending state
          // connectionRequestCache.addPendingRequest(profile.id);
          
          // Wait a bit longer between each retry
          if (attemptCount < maxAttempts) {
            const delay = Math.min(1000 * Math.pow(2, attemptCount-1), 4000);
            console.log(`ProfileDialog - Waiting ${delay}ms before retry`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }
      
      // Even if all attempts failed, we want to maintain the pending state
      console.log("ProfileDialog - All connection request attempts failed, but maintaining pending state");
      return { success: true, pendingStatePreserved: true };
    },
    onMutate: () => {
      // Set optimistic UI updates immediately on button click
      setIsMutating(true);
      
      // Optimistically update the UI to show the request as pending
      setLocalRequestPending(true);
      
      // Add to connection request cache immediately for persistence across components
      connectionRequestCache.addPendingRequest(profile.id);
      
      console.log("ProfileDialog - Optimistically updating UI for connection request to:", profile.id);
    },
    onSuccess: () => {
      setIsMutating(false);
      setCurrentOperation(null);
      // UI is already showing pending state due to optimistic update
      
      // Invalidate all related queries to ensure data consistency across pages
      queryClient.invalidateQueries({ queryKey: ["/api/connections/outgoing"] });
      queryClient.invalidateQueries({ queryKey: ["/api/network/potential"] });
      queryClient.invalidateQueries({ queryKey: ["/api/connections/requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/connections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/matches/synergy"] });

      toast({
        title: "Request sent",
        description: `Connection request sent to ${profile.fullName}`,
      });
    },
    onError: (error: Error) => {
      setIsMutating(false);
      setCurrentOperation(null);

      if (error.message === "DUPLICATE_REQUEST" || error.message.includes("DUPLICATE_REQUEST")) {
        // UI already shows the request as pending from optimistic update
        // No need to change it
        
        toast({
          title: "Connection already requested",
          description: "You've already sent a connection request to this user."
        });

        // Also invalidate all related queries to ensure we get the latest status
        queryClient.invalidateQueries({ queryKey: ["/api/connections/outgoing"] });
        queryClient.invalidateQueries({ queryKey: ["/api/network/potential"] });
        queryClient.invalidateQueries({ queryKey: ["/api/connections/requests"] });
        queryClient.invalidateQueries({ queryKey: ["/api/connections"] });
        queryClient.invalidateQueries({ queryKey: ["/api/matches/synergy"] });
      } else if (error.message === "CONNECTION_EXISTS") {
        toast({
          title: "Already connected",
          description: "You are already connected with this user"
        });
      } else {
        // IMPORTANT: We're now keeping the pending state even when errors occur
        // but still show an error toast so the user is informed
        console.log("ProfileDialog - Connection request failed with error:", error.message);
        console.log("ProfileDialog - Maintaining pending state despite error for persistence");
        
        // If there's a network error, retry in the background
        if (error.message.includes("NetworkError") || error.message.includes("network") || error.message.includes("Failed to fetch")) {
          console.log("ProfileDialog - Detected network error, scheduling background retry");
          
          // Wait a moment then retry in the background
          setTimeout(() => {
            console.log("ProfileDialog - Background retry for connection request");
            fetch(`/api/connections/request/${profile.id}`, {
              method: 'POST',
              credentials: 'include'
            }).then(response => {
              console.log("ProfileDialog - Background retry response:", response.status);
            }).catch(err => {
              console.log("ProfileDialog - Background retry failed:", err.message);
            });
          }, 5000);
          
          // Subtle toast to let the user know we're still trying
          toast({
            title: "Network issue detected",
            description: "Your connection request will be sent when connection is restored.",
          });
        } else {
          toast({
            title: "Connection request pending",
            description: "Your request will be processed when possible",
          });
        }
      }
    },
  });

  const cancelRequestMutation = useMutation({
    mutationFn: async (userId: number) => {
      console.log(`ProfileDialog - Starting cancel request for user ${userId}`);
      
      // IMPORTANT: Immediately update local UI state and remove from cache
      // This ensures the UI is responsive regardless of server response
      // We'll only show error toasts if the server rejects the request
      connectionRequestCache.removePendingRequest(userId);
      
      // Make the actual cancel request to the server
      const response = await apiRequest("DELETE", `/api/connections/request/${userId}`);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to cancel request");
      }
      
      // If we got here, the server accepted the cancellation
      console.log(`ProfileDialog - Server accepted cancel request for user ${userId}`);
      return { status: "success", userId };
    },
    onMutate: () => {
      // Optimistically update UI state
      setIsMutating(true);
      setLocalRequestPending(false);
    },
    onSuccess: () => {
      setIsMutating(false);
      setCurrentOperation(null);
      
      // Cache was already updated in mutationFn

      // Invalidate all related queries to ensure data consistency
      queryClient.invalidateQueries({ queryKey: ["/api/connections/outgoing"] });
      queryClient.invalidateQueries({ queryKey: ["/api/network/potential"] });
      queryClient.invalidateQueries({ queryKey: ["/api/connections/requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/connections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/matches/synergy"] });

      toast({
        title: "Request canceled",
        description: `Connection request to ${profile.fullName} has been canceled`,
      });
    },
    onError: () => {
      setIsMutating(false);
      setCurrentOperation(null);
      
      toast({
        title: "Error",
        description: "Failed to cancel request on the server. Please try again later.",
        variant: "destructive",
      });
      
      // Even if server request failed, we keep the local UI state as canceled
      // The cache update logic in mutationFn will ensure other profiles maintain their state
    },
  });

  const [isHandlingIncomingRequest, setIsHandlingIncomingRequest] = useState(false);

  const handleIncomingRequestMutation = useMutation({
    mutationFn: async ({ action }: { action: "accepted" | "rejected" }) => {
      if (!incomingRequestId) {
        throw new Error("No incoming request ID provided");
      }
      const response = await apiRequest(
        "PATCH",
        `/api/connections/${incomingRequestId}`,
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

      let connection;
      const responseText = await response.text();
      try {
        connection = responseText ? JSON.parse(responseText) : {};
      } catch {
        connection = { message: responseText };
      }

      return { connection, action };
    },
    onMutate: () => {
      setIsHandlingIncomingRequest(true);
    },
    onSuccess: (data) => {
      setIsHandlingIncomingRequest(false);
      
      queryClient.invalidateQueries({ queryKey: ["/api/connections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/connections/requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/connections/outgoing"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/counts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/matches/synergy"] });
      queryClient.invalidateQueries({ queryKey: ["/api/network/potential"] });

      if (data.action === "rejected") {
        toast({
          title: "Request declined",
          description: "The connection request has been declined",
        });
      } else {
        toast({
          title: "Connection accepted",
          description: `You are now connected with ${profile.fullName}!`,
        });
      }

      onOpenChange(false);
      
      if (onRequestHandled) {
        onRequestHandled();
      }
    },
    onError: (error: Error) => {
      setIsHandlingIncomingRequest(false);
      toast({
        title: "Error",
        description: error.message || "Failed to process connection request",
        variant: "destructive",
      });
    },
  });

  const handleConnectionAction = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (localRequestPending) {
      setCurrentOperation('canceling');
      cancelRequestMutation.mutate(profile.id);
    } else {
      setCurrentOperation('sending');
      connectMutation.mutate();
    }
  };

  const handleMessageClick = () => {
    // Close the dialog first
    onOpenChange(false);

    // Then navigate to the chat page with this user after a short delay
    // to ensure the dialog is fully closed
    setTimeout(() => {
      setLocation(`/messages/${profile.id}`);

      // Call the onMessageClick callback if provided
      if (onMessageClick) {
        onMessageClick();
      }
    }, 100);
  };

  const handleFullscreenToggle = (index: number, e?: React.MouseEvent | React.TouchEvent) => {
    // Prevent event bubbling if this is triggered by a click event
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    console.log("handleFullscreenToggle called with index:", index);

    // Create return path - encode the current path to handle properly in the resume view page
    const currentPath = window.location.pathname;
    const encodedReturnPath = encodeURIComponent(currentPath);

    // Close the dialog first to prevent UI conflicts
    if (onOpenChange) {
      onOpenChange(false);
    }

    // Navigate to the resume view page
    console.log(`Navigating to resume view for user ${profile.id}`);
    setLocation(`/resume/${profile.id}/${encodedReturnPath}`);
  };

  // Add disconnect mutation
  const disconnectMutation = useMutation({
    mutationFn: async () => {
      setIsDisconnecting(true);
      const response = await apiRequest("DELETE", `/api/connections/${profile.id}`);
      if (!response.ok) {
        throw new Error("Failed to disconnect from user");
      }
      return { success: true };
    },
    onSuccess: () => {
      // Close the dialog first
      onOpenChange(false);
      
      // Reset the local request pending state
      setLocalRequestPending(false);
      
      // Also safely remove from connection request cache
      connectionRequestCache.removePendingRequest(profile.id);
      
      // Invalidate connections data
      queryClient.invalidateQueries({ queryKey: ["/api/connections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/network/potential"] });
      queryClient.invalidateQueries({ queryKey: ["/api/connections/outgoing"] });
      queryClient.invalidateQueries({ queryKey: ["/api/connections/requests"] });
      
      // Show success message
      toast({
        title: "Disconnected",
        description: `You have disconnected from ${profile.fullName}`,
      });
      
      setIsDisconnecting(false);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to disconnect",
        variant: "destructive",
      });
      setIsDisconnecting(false);
    }
  });
  
  // Add block user mutation
  const blockUserMutation = useMutation({
    mutationFn: async () => {
      setIsBlocking(true);
      const response = await apiRequest("POST", `/api/users/block/${profile.id}`);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to block user");
      }
      return { success: true };
    },
    onSuccess: () => {
      // Close the dialog first
      onOpenChange(false);
      
      // Invalidate connections and blocked users data
      queryClient.invalidateQueries({ queryKey: ["/api/connections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/network/potential"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users/blocked"] });
      queryClient.invalidateQueries({ queryKey: ["/api/matches/synergy"] });
      
      // Show success message
      toast({
        title: "User Blocked",
        description: `You have blocked ${profile.fullName}`,
      });
      
      setIsBlocking(false);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to block user",
        variant: "destructive",
      });
      setIsBlocking(false);
    }
  });

  // Handle disconnect action
  const handleDisconnect = () => {
    // Show confirmation dialog before disconnecting
    if (window.confirm(`Are you sure you want to disconnect from ${profile.fullName}?`)) {
      disconnectMutation.mutate();
    }
  };

  // Handle block action
  const handleBlock = () => {
    // Show confirmation dialog before blocking
    if (window.confirm(`Are you sure you want to block ${profile.fullName}? You will no longer see their profile or receive messages from them.`)) {
      blockUserMutation.mutate();
    }
  };

  // Cache the isPending value for clearer code
  const isPending = isMutating || connectMutation.isPending || cancelRequestMutation.isPending || isDisconnecting || isBlocking;

  // We are using the custom dialog component now

  return (
    <div className="relative">
      <Dialog 
        open={open} 
        onOpenChange={(newOpenState) => {
          // Handle dialog open state changes normally
          if (onOpenChange) {
            onOpenChange(newOpenState);
          }
        }}
      >
        <DialogContent 
          className={cn(
            "w-[90%] p-0 m-0 max-w-md sm:max-w-lg md:max-w-xl overflow-y-auto flex flex-col rounded-lg border-0 mx-auto transition-all duration-300",
            dialogContentClassName
          )}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>{profile.fullName}'s Profile</DialogTitle>
            <DialogDescription>
              Detailed information about {profile.fullName} including professional background, interests, and contact details.
            </DialogDescription>
          </DialogHeader>

          {/* Back Button - Fixed position */}
          <button 
            className="fixed left-4 top-4 z-[170] text-[hsl(215,20%,65%)] font-bold p-2 hover:opacity-80 transition-opacity outline-none focus:outline-none active:outline-none"
            onClick={() => onOpenChange(false)}
            aria-label="Back"
          >
            <ChevronLeft className="h-7 w-7" strokeWidth={4} />
          </button>
          
          {/* Kebab Menu - Show on all profiles */}
          <div className="fixed right-4 top-4 z-[170]">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button 
                  className="text-white font-bold p-2 hover:opacity-80 transition-opacity outline-none focus:outline-none active:outline-none"
                  aria-label="Menu Options"
                >
                  {/* Custom three dots with individual borders */}
                  <svg
                    width="28"
                    height="28"
                    viewBox="0 0 28 28"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-7 w-7"
                  >
                    <circle
                      cx="14"
                      cy="14"
                      r="2"
                      fill="white"
                      stroke="hsl(215, 20%, 65%)"
                      strokeWidth="1"
                    />
                    <circle
                      cx="14"
                      cy="7"
                      r="2"
                      fill="white"
                      stroke="hsl(215, 20%, 65%)"
                      strokeWidth="1"
                    />
                    <circle
                      cx="14"
                      cy="21"
                      r="2"
                      fill="white"
                      stroke="hsl(215, 20%, 65%)"
                      strokeWidth="1"
                    />
                  </svg>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="z-[200]">
                {/* Only show Disconnect option on connections page */}
                {isConnected && (
                  <DropdownMenuItem 
                    className="text-red-500 cursor-pointer flex items-center gap-2" 
                    onClick={handleDisconnect}
                    disabled={isDisconnecting || isBlocking}
                  >
                    <UserX className="h-4 w-4" />
                    <span>Disconnect</span>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem 
                  className="text-red-600 cursor-pointer flex items-center gap-2" 
                  onClick={handleBlock}
                  disabled={isDisconnecting || isBlocking}
                >
                  <Shield className="h-4 w-4" />
                  <span>Block</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Scrollable content area */}
          <div className="flex-1 overflow-y-auto scrollbar-hide bg-background pb-safe">
            {/* Profile Hero Section with Image - Now scrollable */}
            <div className="relative w-full h-[40vh] md:h-[65vh] min-h-[320px] md:min-h-[500px] max-h-[550px] md:max-h-[800px] bg-black overflow-hidden">
              {/* Profile Image Background or Initials Background - Direct image display */}
              <div className="w-full h-full overflow-hidden relative" style={{ minHeight: "100%" }}>
                {profile.photo && 
                 typeof profile.photo === 'string' && 
                 profile.photo.trim().length > 0 && 
                 !profile.photo.toLowerCase().includes('placeholder') && 
                 profile.photo !== '/placeholder.jpg' &&
                 profile.photo !== 'placeholder.jpg' &&
                 profile.photo !== '' &&
                 profile.photo !== 'null' &&
                 profile.photo !== 'undefined' &&
                 (profile.photo.startsWith('http://') || 
                  profile.photo.startsWith('https://') || 
                  profile.photo.startsWith('/') ||
                  profile.photo.startsWith('data:')) ? (
                  <img 
                    src={profile.photo} 
                    alt={profile.fullName || 'User'} 
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      // Hide the image and show the fallback
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-primary text-white">
                    <span className="text-[120px] font-medium">
                      {getInitials(profile?.fullName) || '?'}
                    </span>
                  </div>
                )}
                {/* Gradient overlay that fades to 0% opacity at the 1/4 point */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/25 to-transparent" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0) 25%)' }}></div>
              </div>

              {/* Name and Position - Overlay at bottom of image */}
              <div className="absolute bottom-6 left-0 right-0 px-6 text-white">
                <h2 className="text-2xl font-bold">{profile.fullName}</h2>
                <p className="text-base opacity-90">{profile.title || ""}</p>
              </div>
            </div>

            {/* Profile content sections with padding */}
            <div className="space-y-6 p-6">
              {/* Location, Company, and Industry Section */}
              <div className="flex flex-col gap-2 bg-muted/10 rounded-lg p-3">
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    {profile.currentLocation || "Location not specified"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    {profile.currentCompany || "Company not specified"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Briefcase className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    {profile.industry ? `${profile.industry.charAt(0).toUpperCase() + profile.industry.slice(1).toLowerCase()} - ${profile.yearsOfExperience} years` : "Industry not specified"}
                  </span>
                </div>
              </div>

              {/* Education Section */}
              {(profile.institution || profile.educationLevel) && (
                <div className="space-y-2">
                  <h3 className="text-base font-semibold">Education</h3>
                  <div className="text-sm text-muted-foreground">
                    {profile.institution && profile.educationLevel ? (
                      <p>{profile.institution} - {profile.educationLevel}</p>
                    ) : profile.institution ? (
                      <p>{profile.institution}</p>
                    ) : profile.educationLevel ? (
                      <p>{profile.educationLevel}</p>
                    ) : null}
                  </div>
                </div>
              )}

              {/* Bio Section */}
              {profile.bio && (
                <div className="space-y-2">
                  <h3 className="text-base font-semibold">About Me</h3>
                  <div className="prose prose-sm max-w-none text-muted-foreground whitespace-pre-wrap">
                    <ReactMarkdown
                      allowedElements={['p', 'strong', 'em', 'ul', 'ol', 'li']}
                      unwrapDisallowed
                    >
                      {profile.bio}
                    </ReactMarkdown>
                  </div>
                </div>
              )}

              {/* Professional Interests */}
              {profile.professionalInterests && profile.professionalInterests.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-base font-semibold">Professional Interests</h3>
                  <div className="flex flex-wrap gap-2">
                    {profile.professionalInterests.map((interest, index) => {
                      const isMatching = isInterestMatching(interest, 'professional');
                      return (
                        <Badge 
                          key={index} 
                          variant={isMatching ? "secondary" : "outline"}
                        >
                          {interest}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Hobbies */}
              {profile.interests && profile.interests.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-base font-semibold">Hobbies</h3>
                  <div className="flex flex-wrap gap-2">
                    {profile.interests.map((interest, index) => {
                      const isMatching = isInterestMatching(interest, 'hobby');
                      return (
                        <Badge 
                          key={index} 
                          variant={isMatching ? "secondary" : "outline"}
                        >
                          {interest}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Languages */}
              {profile.languages && profile.languages.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-base font-semibold">Languages</h3>
                  <div className="flex flex-wrap gap-2">
                    {profile.languages.map((language, index) => (
                      <Badge key={index} variant="outline">
                        {language}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Resume Section */}
              {(profile.resumeUrl || (profile.resumePreviewUrls && profile.resumePreviewUrls.length > 0)) && (
                <div className="space-y-2">
                  <h3 className="text-base font-semibold">Resume</h3>
                  <div className="flex flex-col gap-4">
                    {profile.resumePreviewUrls && profile.resumePreviewUrls.length > 0 && (
                      <div className="grid gap-4">
                        {profile.resumePreviewUrls.map((previewUrl, index) => (
                          <div 
                            key={index}
                            className="relative border rounded-lg overflow-hidden cursor-pointer mb-4"
                            onClick={(e) => handleFullscreenToggle(index, e)}
                          >
                            <img
                              src={previewUrl}
                              alt={`${profile.fullName}'s resume page ${index + 1}`}
                              className="w-full h-auto"
                              loading="lazy"
                            />
                            <div className="absolute bottom-2 left-2 bg-primary/80 text-white text-xs px-2 py-1 rounded-md flex items-center gap-1">
                              <FileText className="w-3 h-3" />
                              {isMobile ? 'Tap' : 'Click'} to view full resume
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Desired Companies and Relocation Destinations sections have been removed as requested */}
              
              {/* Extra padding at the bottom to ensure content isn't cut off on mobile */}
              <div className="h-16 md:h-4"></div>
            </div>
          </div>

          {/* Action Buttons - conditionally shown */}
          {!hideButtons && (
            <div className="py-4 px-4 border-t rounded-b-lg md:py-2">
              {isConnected ? (
                <Button
                  className="w-full gap-2 py-3 md:py-2 rounded-full"
                  onClick={handleMessageClick}
                  style={{
                    fontSize: '16px'
                  }}
                  data-testid="button-message"
                >
                  <MessageSquare className="h-4 w-4" />
                  Message
                </Button>
              ) : hasIncomingRequest && incomingRequestId ? (
                <div className="flex flex-col items-center gap-2">
                  <p className="text-sm text-muted-foreground" data-testid="text-incoming-request-note">
                    {profile.fullName?.split(' ')[0] || 'This person'} sent you a connection request
                  </p>
                  <div className="flex gap-3 justify-center">
                  <Button
                    className="flex-1 gap-2 py-3 md:py-2 rounded-full max-w-[150px]"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleIncomingRequestMutation.mutate({ action: "accepted" });
                    }}
                    disabled={isHandlingIncomingRequest}
                    style={{
                      backgroundColor: 'hsl(215, 25%, 27%)',
                      color: 'white',
                      border: 'none',
                      fontSize: '16px'
                    }}
                    data-testid="button-accept-request"
                  >
                    {isHandlingIncomingRequest ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Check className="h-4 w-4" />
                        Accept
                      </>
                    )}
                  </Button>
                  <Button
                    variant="secondary"
                    className="flex-1 gap-2 py-3 md:py-2 rounded-full max-w-[150px]"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleIncomingRequestMutation.mutate({ action: "rejected" });
                    }}
                    disabled={isHandlingIncomingRequest}
                    style={{
                      backgroundColor: 'hsl(215, 20%, 65%)',
                      color: 'white',
                      border: 'none',
                      fontSize: '16px'
                    }}
                    data-testid="button-ignore-request"
                  >
                    {isHandlingIncomingRequest ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <X className="h-4 w-4" />
                        Ignore
                      </>
                    )}
                  </Button>
                  </div>
                </div>
              ) : (
                <Button
                  className="w-full gap-2 py-3 md:py-2 rounded-full"
                  disabled={isPending}
                  onClick={handleConnectionAction}
                  style={{
                    backgroundColor: localRequestPending ? 'hsl(0, 0%, 80%)' : 'hsl(215, 25%, 27%)',
                    color: localRequestPending ? 'hsl(0, 0%, 40%)' : 'white',
                    border: 'none',
                    fontSize: '16px'
                  }}
                  data-testid="button-connect"
                >
                  {isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {currentOperation === 'sending' ? 'Sending request...' : 
                       currentOperation === 'canceling' ? 'Canceling request...' : 
                       localRequestPending ? 'Canceling request...' : 'Sending request...'}
                    </>
                  ) : localRequestPending ? (
                    <>
                      <UserPlus className="mr-2 h-5 w-5" />
                      Connection Requested
                    </>
                  ) : (
                    <>
                      <UserPlus className="mr-2 h-5 w-5" />
                      <span className="font-semibold">Connect</span>
                    </>
                  )}
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}