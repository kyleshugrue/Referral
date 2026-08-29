import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { type User, type Conversation } from "@shared/schema";
import { SendHorizontal, ChevronLeft } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/hooks/use-auth";
import { ChatProfileDialog } from "@/components/chat-profile-dialog";
import { useState, useRef, useEffect } from "react";
import * as React from "react";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { MessageList } from "../components/message-list";
import { getInitials } from "@/lib/avatar-utils";
import { ExtendedMessage } from "@/types/message";
import { useIOSKeyboardPro } from "@/hooks/use-ios-keyboard-pro";
import { useCapacitor, ImpactStyle } from "@/hooks/use-capacitor";
import { config } from "@/lib/config";
import { Capacitor } from "@capacitor/core";
import { logger } from "@/lib/logger";
import { waitForTokensReady, onAccessTokenChange } from "@/lib/token-manager";
import { openAuthenticatedWebSocket } from "@/lib/websocket-ticket";

// Create an optimized standalone chat back button component
// This uses a fixed element that's always visible and unaffected by dialog state
const AlwaysVisibleBackButton = () => {
  const [, navigate] = useLocation();
  
  // Fast navigation using React Router instead of full page reload
  const goToConnections = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Ensure we're using a function to update the location
    // This helps ensure the change is processed correctly
    setTimeout(() => {
      navigate("/connections");
    }, 0);
  };

  return (
    <button
      onClick={goToConnections}
      className="flex items-center justify-center"
      style={{
        background: 'transparent',
        border: 'none',
        color: 'hsl(215,25%,27%)',
        cursor: 'pointer',
        padding: 0,
        width: '36px',
        height: '36px',
      }}
    >
      <ChevronLeft 
        width={30} 
        height={30} 
        strokeWidth={3}
      />
    </button>
  );
}

export default function ChatPage() {
  const [location, navigate] = useLocation();
  const userId = location.split("/").pop();
  const { user: currentUser } = useAuth();
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [newMessage, setNewMessage] = useState("");
  const { toast } = useToast();
  const wsRef = useRef<WebSocket | null>(null);
  const [connectionState, setConnectionState] = useState("connecting");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [, setIsKeyboardVisible] = useState(false);
  
  // Initialize iOS keyboard support with professional animations
  const { isNativeIOSApp, isKeyboardVisible: isIOSKeyboardVisible } = useIOSKeyboardPro();
  const isNativeIOSAppRef = useRef(isNativeIOSApp);
  
  // Initialize haptic feedback for iOS
  const { hapticFeedback } = useCapacitor();
  
  // Message queue for when WebSocket is disconnected
  const messageQueueRef = useRef<{type: string; content?: string; receiverId?: number;}[]>([]);

  // Reference to the message container for auto-scrolling
  const messageContainerRef = useRef<HTMLDivElement>(null);

  // Get user details
  const { data: user, isLoading: isLoadingUser } = useQuery<User>({
    queryKey: ["/api/users", Number(userId)],
    enabled: !!userId,
  });

  // Get conversation between users
  const { data: conversation, isLoading: isLoadingConversation } = useQuery({
    queryKey: ["/api/conversations", Number(userId)],
    enabled: !!userId && !!currentUser?.id,
  }) as {
    data: Conversation | undefined,
    isLoading: boolean
  };

  // If no userId is provided, redirect to connections.
  useEffect(() => {
    if (!userId) {
      navigate("/connections");
    }
  }, [navigate, userId]);

  // WebSocket connection
  // Effect to scroll to the latest message when new messages arrive
  useEffect(() => {
    if (messageContainerRef.current) {
      setTimeout(() => {
        if (messageContainerRef.current) {
          messageContainerRef.current.scrollTop = messageContainerRef.current.scrollHeight;
        }
      }, 100); // Small delay to ensure content is rendered
    }
  }, [conversation?.lastMessageAt]); // Only depend on new messages, not keyboard state

  // Effect to mark message notifications as read when viewing a chat
  useEffect(() => {
    // Mark message notifications as read and update notification counts
    const markMessagesAsRead = async () => {
      try {
        // Use apiRequest for proper JWT token handling on iOS
        const { apiRequest } = await import('@/lib/queryClient');
        await apiRequest('PATCH', '/api/notifications/read-all/message');
        
        // Invalidate notification counts to update badges
        queryClient.invalidateQueries({ queryKey: ['/api/notifications/counts'] });
      } catch (error) {
        logger.error('Error marking message notifications as read:', error);
      }
    };
    
    // Only mark as read if we have a valid conversation
    if (conversation?.id) {
      markMessagesAsRead();
    }
  }, [conversation?.id]);

  // Effect to reset textarea height when message is cleared
  useEffect(() => {
    if (newMessage === "" && inputRef.current) {
      inputRef.current.style.height = '34px';
    }
  }, [newMessage]);

  // Effect to handle keyboard visibility - optimized for iOS
  // Create a ref to hold our viewport resize handler so it can be referenced in cleanup
  const viewportResizeHandlerRef = useRef<(() => void) | null>(null);
  
  useEffect(() => {
    // Add meta viewport tag for iOS keyboard
    const viewportMeta = document.createElement('meta');
    viewportMeta.name = 'viewport';
    viewportMeta.content = 'width=device-width, initial-scale=1, viewport-fit=cover';
    document.head.appendChild(viewportMeta);
    
    // iOS keyboard behavior handler - simplified to just track state
    const handleFocus = () => {
      // For iOS native app, let the native keyboard handle visibility
      if (!isNativeIOSAppRef.current) {
        setIsKeyboardVisible(true);
      }
      
      // Scroll to bottom consistently
      scrollToBottom();
    };

    const handleBlur = () => {
      // For iOS native app, let the native keyboard handle visibility
      if (!isNativeIOSAppRef.current) {
        setIsKeyboardVisible(false);
      }
      
      // Scroll to bottom consistently
      scrollToBottom();
    };
    
    // Helper function to scroll to bottom consistently
    const scrollToBottom = () => {
      if (messageContainerRef.current) {
        // Immediate scroll
        messageContainerRef.current.scrollTop = messageContainerRef.current.scrollHeight;
        
        // Delayed scroll to handle layout shifts
        setTimeout(() => {
          if (messageContainerRef.current) {
            messageContainerRef.current.scrollTop = messageContainerRef.current.scrollHeight;
          }
        }, 200);
      }
    };
    
    // Handler for visual viewport resize events - use our consistent scroll helper
    const handleViewportResize = () => {
      // Use the same scrollToBottom helper for consistency
      scrollToBottom();
    };
    
    // Store the handler in the ref so we can access it during cleanup
    viewportResizeHandlerRef.current = handleViewportResize;
    
    // Add visual viewport event listener for iOS
    if ('visualViewport' in window && window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleViewportResize);
    }

    // Add event listeners to the input
    const input = inputRef.current;
    if (input) {
      input.addEventListener('focus', handleFocus);
      input.addEventListener('blur', handleBlur);
    }

    // Clean up on unmount
    return () => {
      if (input) {
        input.removeEventListener('focus', handleFocus);
        input.removeEventListener('blur', handleBlur);
      }
      
      // Use the handler from the ref during cleanup
      if ('visualViewport' in window && window.visualViewport && viewportResizeHandlerRef.current) {
        window.visualViewport.removeEventListener('resize', viewportResizeHandlerRef.current);
      }
      
      // Only try to remove if it's still in the document
      if (document.head.contains(viewportMeta)) {
        document.head.removeChild(viewportMeta);
      }
    };
  }, []); // We intentionally only run this once for setup

  // WebSocket connection setup effect  
  useEffect(() => {
    if (!currentUser?.id || !userId) return;
    
    let tokenUnsubscribe: (() => void) | null = null;
    let isUnmounted = false;
    let reconnectTimeoutId: NodeJS.Timeout | null = null;

    const connect = async () => {
      if (isUnmounted) return;
      logger.debug('[WebSocket] Attempting to connect...');
      
      // Create a WebSocket connection with proper protocol handling
      // For native iOS, use the production backend URL from config with JWT authentication
      const isNativePlatform = Capacitor.isNativePlatform();
      
      // For native platforms, always ensure tokens are ready before connecting
      if (isNativePlatform) {
        await waitForTokensReady();
        if (isUnmounted) return;
      }
      let wsUrl: string;
      
      if (isNativePlatform) {
        // Native iOS/Android: Use the production backend URL with JWT token authentication
        const baseUrl = config.apiBaseUrl;
        const wsProtocol = baseUrl.startsWith('https://') ? 'wss:' : 'ws:';
        const wsHost = baseUrl.replace(/^https?:\/\//, '');
        
        // Get JWT access token for authentication (required for native platforms)
        wsUrl = `${wsProtocol}//${wsHost}/ws`;
        logger.debug('[WebSocket] Native platform detected, using one-time ticket authentication');
      } else {
        // Web: Use window.location with session authentication
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsHost = window.location.host;
        wsUrl = `${wsProtocol}//${wsHost}/ws`;
      }

      try {
        // Never log the connection URL as-is: it may carry a bearer JWT in the
        // `token` query param (native/mobile auth path). Log only the origin/path.
        const wsUrlForLogging = wsUrl.split('?')[0];
        logger.debug('[WebSocket] Connecting to:', wsUrlForLogging);
        const ws = await openAuthenticatedWebSocket(wsUrl);
        wsRef.current = ws;

        // Set up event listeners
        ws.onopen = () => {
          logger.debug('[WebSocket] Connected successfully');
          setConnectionState("connected");
          
          // Send any queued messages
          if (messageQueueRef.current && messageQueueRef.current.length > 0) {
            logger.debug(`[WebSocket] Sending ${messageQueueRef.current.length} queued messages`);
            
            // Create a copy of the queue to avoid modification during iteration
            const queuedMessages = [...messageQueueRef.current];
            
            // Try to send each queued message
            queuedMessages.forEach(message => {
              try {
                ws.send(JSON.stringify(message));
                logger.debug(`[WebSocket] Sent queued message of type ${message.type}`);
              } catch (err) {
                logger.error(`[WebSocket] Failed to send queued message:`, err);
              }
            });
            
            // Clear the queue
            messageQueueRef.current = [];
          }

          // Once connected, load messages via WebSocket (fixed parameters)
          try {
            logger.debug('[WebSocket] Requesting messages via WebSocket');
            ws.send(JSON.stringify({
              type: 'loadMessages',
              partnerId: Number(userId)
            }));
          } catch (error) {
            logger.error('[WebSocket] Error sending loadMessages request:', error);
          }
        };

        ws.onclose = (event) => {
          logger.debug('[WebSocket] Connection closed:', event.code, event.reason);
          setConnectionState("disconnected");
          wsRef.current = null;

          // Auto-reconnect after a delay, but with better cross-platform handling
          if (!isUnmounted) {
            const reconnectDelay = event.code === 1008 ? 10000 : 3000; // Longer delay for "too many attempts"
            reconnectTimeoutId = setTimeout(() => {
              if (!isUnmounted && document.visibilityState === 'visible') {
                connect();
              }
            }, reconnectDelay);
          }
        };

        ws.onerror = (error) => {
          logger.error('[WebSocket] Error:', error);
          setConnectionState("failed");
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            logger.debug('[WebSocket] Received message type:', data.type);

            switch (data.type) {
              case 'connected':
                setConnectionState("connected");
                // Load messages once connected
                ws.send(JSON.stringify({
                  type: 'loadMessages',
                  partnerId: Number(userId)
                }));
                break;

              case 'messagesLoaded':
                // Successfully loaded messages, refresh the UI with new data
                logger.debug('[WebSocket] Messages loaded:', data.messages?.length || 0);
                logger.debug('[WebSocket] Conversation ID:', data.conversationId);
                logger.debug('[WebSocket] Invalidating messages for recipient:', userId);

                // Update message list
                queryClient.invalidateQueries({ 
                  queryKey: ["/api/messages", Number(userId)]
                });

                // Update conversation data if we received a conversationId
                if (data.conversationId) {
                  // Force refetch the conversation data
                  queryClient.invalidateQueries({ 
                    queryKey: ["/api/conversations", Number(userId)]
                  });
                  queryClient.invalidateQueries({ 
                    queryKey: ["/api/conversations"]
                  });
                }
                break;

              case 'messageConfirm':
                // Message was confirmed by the server, refresh messages
                logger.debug('[WebSocket] Message confirmed by server');
                logger.debug('[WebSocket] Message id:', data.message?.id);
                logger.debug('[WebSocket] Invalidating messages for recipient:', userId);

                // If we have a confirmed message ID, update its status to 'delivered'
                if (data.message && data.message.id) {
                  const currentMessages = queryClient.getQueryData<ExtendedMessage[]>(["/api/messages", Number(userId)]);
                  if (currentMessages) {
                    // Find any temporary or sending messages and update them to delivered
                    const updatedMessages = currentMessages.map(msg => {
                      // If this is the confirmed message OR a temporary message with matching content
                      if ((msg.id === data.message.id) || 
                          (msg.isTemporary && msg.content === data.message.content)) {
                        return { 
                          ...msg, 
                          id: data.message.id, // Use the real ID
                          status: 'delivered',
                          isTemporary: false
                        };
                      }
                      return msg;
                    });
                    
                    // Update the messages cache
                    queryClient.setQueryData(["/api/messages", Number(userId)], updatedMessages);
                  }
                }

                // Update all relevant queries
                queryClient.invalidateQueries({ 
                  queryKey: ["/api/messages", Number(userId)]
                });
                queryClient.invalidateQueries({ 
                  queryKey: ["/api/conversations", Number(userId)]
                });
                queryClient.invalidateQueries({ 
                  queryKey: ["/api/conversations"]
                });
                break;

              case 'chat':
                // New message received, refresh messages
                logger.debug('[WebSocket] New chat message received');

                // If this is a message from or to the current user, refresh the messages
                if (data.message && 
                    (data.message.senderId === Number(userId) || 
                     data.message.receiverId === Number(userId))) {
                  logger.debug('[WebSocket] Refreshing messages for recipient:', userId);

                  // Invalidate both conversation and messages queries with correct query keys
                  queryClient.invalidateQueries({ 
                    queryKey: ["/api/messages", Number(userId)]
                  });
                  queryClient.invalidateQueries({ 
                    queryKey: ["/api/conversations", Number(userId)]
                  });
                  queryClient.invalidateQueries({ 
                    queryKey: ["/api/conversations"]
                  });
                  // Also refresh notification counts to update blue glow on the mobile view
                  queryClient.invalidateQueries({ 
                    queryKey: ["/api/notifications/counts"]
                  });
                }
                break;

              case 'error': {
                logger.error('[WebSocket] Error from server:', data);

                // Handle specific errors with user-friendly messages
                let errorMessage = data.message || "An error occurred";

                // Check for specific error types
                if (data.details) {
                  if (data.details.includes('Users are not connected') || 
                      data.details.includes('must be connected')) {
                    errorMessage = "You must be connected with this user to exchange messages";

                    // Refresh the connection status
                    queryClient.invalidateQueries({ 
                      queryKey: ["/api/connections"]
                    });
                  } else if (data.details.includes('Failed to get or create conversation')) {
                    errorMessage = "Unable to load conversation. Please try again later.";
                  }
                }

                toast({
                  title: "Message Error",
                  description: errorMessage,
                  variant: "destructive",
                });
                break;
              }
            }
          } catch (error) {
            logger.error('[WebSocket] Error parsing message:', error);
          }
        };
      } catch (error) {
        logger.error('[WebSocket] Setup error:', error);
        setConnectionState("failed");
      }
    };

    // For native platforms, wait for tokens to be ready before connecting
    const initConnection = async () => {
      const isNativePlatform = Capacitor.isNativePlatform();
      
      if (isNativePlatform) {
        logger.debug('[WebSocket] Native platform - waiting for tokens to be ready...');
        await waitForTokensReady();
        logger.debug('[WebSocket] Tokens ready, proceeding with connection');
        
        // Subscribe to token changes to reconnect when token is refreshed
        tokenUnsubscribe = onAccessTokenChange((newToken) => {
          if (isUnmounted) return;
          
          // If we get a new valid token and socket is disconnected/failed, reconnect
          if (newToken && newToken !== 'PENDING_REFRESH') {
            if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
              logger.debug('[WebSocket] Token changed and socket not connected, reconnecting...');
              connect();
            }
          }
        });
      }
      
      if (!isUnmounted) {
        connect();
      }
    };
    
    initConnection();

    return () => {
      isUnmounted = true;
      if (tokenUnsubscribe) {
        tokenUnsubscribe();
        tokenUnsubscribe = null;
      }
      if (reconnectTimeoutId) {
        clearTimeout(reconnectTimeoutId);
        reconnectTimeoutId = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [currentUser?.id, userId, toast]);

  // Handle sending a message
  const handleSend = async (e: React.SyntheticEvent) => {
    logger.debug('[handleSend] Function called');
    
    // Prevent default behavior if it's an event
    if (e && e.preventDefault) {
      e.preventDefault();
      logger.debug('[handleSend] Prevented default event behavior');
    }

    if (!newMessage.trim()) {
      logger.debug('[handleSend] Empty message, not sending');
      return;
    }
    
    logger.debug('[handleSend] Message to send, length:', newMessage.trim().length);

    // We'll allow sending even when disconnected using optimistic UI updates
    // The message will be stored locally and sent when connection is restored

    const messageContent = newMessage.trim();
    setNewMessage(""); // Clear immediately for better user experience
    
    // Trigger haptic feedback on iOS when sending message (with null guard)
    if (isNativeIOSApp && hapticFeedback) {
      try {
        hapticFeedback(ImpactStyle.Light);
      } catch {
        logger.debug('[Chat] Haptic feedback not available');
      }
    }
    
    // Make sure to keep the keyboard visible and focused
    // This ensures the keyboard stays open after sending a message
    if (inputRef.current) {
      inputRef.current.focus();
      setIsKeyboardVisible(true);
    }
    
    const messageToSend = {
      type: 'chat',
      receiverId: Number(userId),
      content: messageContent
    };

    // Create temporary message for optimistic update
    const tempMessage: ExtendedMessage = {
      id: Date.now(), // Temporary ID that will be replaced when server confirms
      conversationId: conversation?.id || 0,
      senderId: currentUser?.id || 0,
      receiverId: Number(userId),
      content: messageContent,
      createdAt: new Date().toISOString(),
      status: 'sending',
      isTemporary: true
    };

    // Optimistically update the UI with the message
    const currentData = queryClient.getQueryData<ExtendedMessage[]>(["/api/messages", Number(userId)]);
    
    if (currentData) {
      // Add the temporary message to the existing messages list
      queryClient.setQueryData(["/api/messages", Number(userId)], [...currentData, tempMessage]);
    }

    try {
      logger.debug(`[handleSend] Sending message to recipient ${userId}`);
      // Add to message queue for later sending if needed
      const messageQueue = [...(messageQueueRef.current || []), messageToSend];
      messageQueueRef.current = messageQueue;
      
      // Only try to send if WebSocket is connected
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send(JSON.stringify(messageToSend));
          
          // Remove from queue if sent successfully
          messageQueueRef.current = messageQueue.filter(msg => 
            !(msg.type === messageToSend.type && 
              msg.content === messageToSend.content && 
              msg.receiverId === messageToSend.receiverId));
        } catch (err) {
          logger.error("Failed to send via WebSocket:", err);
        }
      } else {
        // Queue message for when connection is restored
        logger.debug('[handleSend] WebSocket not connected. Message will appear in UI and be sent when connection is restored.');
        
        // We'll attempt to reconnect the WebSocket
        if (connectionState !== "connected") {
          setTimeout(() => {
            logger.debug('[handleSend] Attempting to reconnect WebSocket...');
            if (document.visibilityState === 'visible') {
              // Force a reconnection attempt
              if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
              }
            }
          }, 500);
        }
      }

      // Scroll to bottom immediately when message is sent
      if (messageContainerRef.current) {
        // Immediate scroll
        messageContainerRef.current.scrollTop = messageContainerRef.current.scrollHeight;
        
        // Multiple scrolls with delays to ensure we catch the final layout
        [10, 50, 300].forEach(delay => {
          setTimeout(() => {
            if (messageContainerRef.current) {
              messageContainerRef.current.scrollTop = messageContainerRef.current.scrollHeight;
            }
          }, delay);
        });
      }

      // After a timeout, if the message isn't acknowledged, show an error
      setTimeout(() => {
        // Check if the message with this temporary ID is still in the cache
        const currentMessages = queryClient.getQueryData<ExtendedMessage[]>(["/api/messages", Number(userId)]);
        const messageStillTemp = currentMessages?.some(msg => msg.id === tempMessage.id);
        
        if (messageStillTemp) {
          // Mark message as failed
          const updatedMessages = currentMessages?.map(msg => {
            if (msg.id === tempMessage.id) {
              return { ...msg, status: 'failed' as const };
            }
            return msg;
          });
          
          // Update the query cache with failed status
          if (updatedMessages) {
            queryClient.setQueryData(["/api/messages", Number(userId)], updatedMessages);
          }
          
          // Show error toast
          toast({
            title: "Message delivery failed",
            description: "Tap on the message to retry sending it.",
            variant: "destructive",
          });
        }
      }, 3000); // Wait 3 seconds for confirmation

      // Server will eventually notify us via WebSocket when the message is confirmed,
      // which will update the message status to 'delivered' via the messageConfirm handler

    } catch (error) {
      logger.error("Error sending message:", error);
      toast({
        title: "Error",
        description: "Failed to send message. Please try again.",
        variant: "destructive",
      });
      
      // Mark the message as failed rather than removing it
      const currentMessages = queryClient.getQueryData<ExtendedMessage[]>(["/api/messages", Number(userId)]);
      if (currentMessages) {
        const updatedMessages = currentMessages.map(msg => {
          if (msg.id === tempMessage.id) {
            return { ...msg, status: 'failed' as const };
          }
          return msg;
        });
        
        queryClient.setQueryData(
          ["/api/messages", Number(userId)], 
          updatedMessages
        );
      }
      
      // Don't restore the message content as we're showing it as failed
      // The user can tap to retry
    }
  };

  if (!userId) {
    return null;
  }

  return (
    <div className={`flex flex-col w-full max-w-md mx-auto bg-white border-x border-gray-200 relative ${
      isNativeIOSApp ? 'ios-native-messaging-layout ios-native-chat-page' : ''
    } ${isNativeIOSApp && isIOSKeyboardVisible ? 'ios-keyboard-visible' : ''}`} 
         style={{ 
           height: isNativeIOSApp ? '100%' : '100vh',
           minHeight: isNativeIOSApp ? '100vh' : undefined,
           paddingTop: isNativeIOSApp ? '0px' : 'env(safe-area-inset-top, 0px)',
           paddingBottom: isNativeIOSApp ? '0px' : 'env(safe-area-inset-bottom, 0px)',
           ...(isNativeIOSApp && { position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0 })
         }}>
      {/* Header with user info - fixed at top even with keyboard open */}
      <div className={`${isNativeIOSApp ? 'ios-chat-header' : 'sticky top-0'} z-20 bg-white border-b border-gray-200 w-full max-w-md mx-auto`}
        style={{ 
          height: 'auto',
          marginBottom: '4px',
          paddingBottom: '4px',
          paddingTop: isNativeIOSApp ? 'env(safe-area-inset-top, 0px)' : '0px',
          flexShrink: 0
        }}>
        
        {/* User information with profile picture and back button aligned - ALWAYS show header structure */}
        <div className="py-1 flex items-center justify-between relative px-4" data-testid="chat-header">
          {/* Back button - always visible */}
          <div className="flex-shrink-0">
            <AlwaysVisibleBackButton />
          </div>
          
          {/* Clickable profile container - centered */}
          {user ? (
            <div 
              role="button"
              tabIndex={0}
              aria-label={`View ${user.fullName || 'contact'}'s profile`}
              className="flex flex-col items-center cursor-pointer py-1 mx-auto"
              onClick={() => setIsProfileOpen(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setIsProfileOpen(true);
                }
              }}
              data-testid="chat-profile-trigger"
            >
              {/* Add avatar/profile picture */}
              <div>
                <Avatar className="h-10 w-10">
                  {/* Only show avatar image if user has a valid photo (not placeholder) */}
                  {user.photo && 
                   !user.photo.includes('placeholder') && 
                   user.photo !== '/placeholder.jpg' && (
                    <AvatarImage 
                      src={user.photo} 
                      alt={user.fullName} 
                      className="object-cover"
                    />
                  )}
                  <AvatarFallback className="bg-primary text-white font-medium">
                    {getInitials(user.fullName)}
                  </AvatarFallback>
                </Avatar>
              </div>
              <h2 className="text-sm font-semibold mt-1">
                {user.fullName}
              </h2>
            </div>
          ) : (
            <div className="flex flex-col items-center py-1 mx-auto">
              {/* Loading skeleton for avatar and name */}
              <div className="h-10 w-10 rounded-full bg-gray-200 animate-pulse" />
              <div className="h-4 w-20 bg-gray-200 animate-pulse rounded mt-1" />
            </div>
          )}
          
          {/* Empty div to balance the layout */}
          <div className="flex-shrink-0 w-[36px]"></div>
        </div>
      </div>

      {/* Check if we need to reopen a profile dialog when we have user data */}
      {user && (() => {
        // Run this code only when user is available
        // Check for stored profile ID in session storage
        const storedProfileId = sessionStorage.getItem('reopenProfileId');
        if (storedProfileId && Number(storedProfileId) === user.id && !isProfileOpen) {
          logger.debug(`Found stored profile ID: ${storedProfileId}, reopening profile dialog`);
          
          // Clear it immediately to prevent reopening on future navigations
          sessionStorage.removeItem('reopenProfileId');
          
          // Check if we should reopen immediately
          const isInstantReopen = sessionStorage.getItem('instantReopenProfile') === 'true';
          if (isInstantReopen) {
            // Clear the flag
            sessionStorage.removeItem('instantReopenProfile');
            
            // Set immediate open
            setTimeout(() => setIsProfileOpen(true), 0);
          } else {
            // Set delayed open
            setTimeout(() => setIsProfileOpen(true), 100);
          }
        }
        
        // Return the profile dialog
        return (
          <ChatProfileDialog
            profile={user}
            open={isProfileOpen}
            onOpenChange={setIsProfileOpen}
            onMessageClick={() => setIsProfileOpen(false)}
          />
        );
      })()}

      {/* Main content area with flex layout to work with sticky header */}
      <div className={`flex flex-col flex-grow ${isNativeIOSApp ? 'ios-chat-content-wrapper' : ''}`} style={{ 
        paddingBottom: '0px',
        WebkitOverflowScrolling: 'touch',
        minHeight: 0,
        overflow: 'hidden',
        flex: 1
      }}>
        {/* Messages area with scroll capability - iOS-compatible */}
        <div 
          ref={messageContainerRef} 
          className={`w-full flex-1 flex flex-col ${
            isNativeIOSApp ? 'ios-messages-container' : ''
          }`}
          data-testid="messages-container"
          style={{ 
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
            minHeight: 0,
            flex: 1,
            paddingBottom: isNativeIOSApp ? 'calc(70px + env(safe-area-inset-bottom, 0px))' : '90px'
          }}
        >
          {isLoadingUser || isLoadingConversation ? (
            <div className={`flex items-center justify-center h-full w-full ${isNativeIOSApp ? 'ios-message-loading' : ''}`}>
              <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          ) : user ? (
            // Directly use MessageList component which handles its own scrolling behavior
            conversation ? (
              <MessageList 
                conversationId={conversation.id as number}
                recipientId={Number(userId)}
                otherUser={user}
                onProfileClick={() => setIsProfileOpen(true)}
                isIOSNative={isNativeIOSApp}
              />
            ) : (
              <div className={`flex flex-col items-center justify-center h-full p-4 ${isNativeIOSApp ? 'ios-message-empty' : ''}`}>
                <div className="text-gray-300 mb-6">
                  <svg width="50" height="50" viewBox="0 0 50 50" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M40 5H10C7.25 5 5 7.25 5 10V35C5 37.75 7.25 40 10 40H35L45 50V10C45 7.25 42.75 5 40 5Z" stroke="currentColor" strokeWidth="3" fill="none" />
                  </svg>
                </div>
                <p className="text-gray-800 font-medium text-lg mb-2">
                  No messages yet
                </p>
                <p className="text-gray-500 text-center">
                  Start a conversation with {user.fullName}!
                </p>
              </div>
            )
          ) : null}
        </div>
      </div>

      {/* Message input area - iOS-style fixed input with keyboard handling */}
      <div 
        className={`fixed left-0 right-0 z-30 w-full keyboard-input-container ${
          isNativeIOSApp ? 'chat-input-container' : 'bg-white max-w-md mx-auto'
        }`}
        style={isNativeIOSApp 
          ? {
              // For iOS native: position is controlled by CSS via .ios-keyboard-visible class
              // The --ios-keyboard-height CSS variable is set by useIOSKeyboard hook
            }
          : { 
              bottom: 'env(safe-area-inset-bottom, 0px)',
              borderTop: '1px solid rgba(0,0,0,0.1)',
              paddingBottom: '12px',
              boxShadow: '0 -2px 8px rgba(0,0,0,0.04)',
              marginTop: 0,
              paddingTop: '8px',
              height: 'auto'
            }
        }
      >
        <div className={isNativeIOSApp ? 'ios-native-input-wrapper' : 'py-2 px-4 flex items-center justify-between'}>
          {isNativeIOSApp ? (
            // iOS Native messaging input layout
            <>
              <textarea
                ref={inputRef}
                value={newMessage}
                onChange={(e) => {
                  setNewMessage(e.target.value);
                  // Auto-resize based on content for iOS
                  if (inputRef.current) {
                    inputRef.current.style.height = '36px';
                    const scrollHeight = inputRef.current.scrollHeight;
                    if (scrollHeight > 36) {
                      inputRef.current.style.height = `${Math.min(scrollHeight, 100)}px`;
                    }
                  }
                }}
                placeholder="Message"
                aria-label="Message"
                className="ios-native-input flex-1"
                style={{
                  height: '36px',
                  minHeight: '36px',
                  maxHeight: '100px',
                  resize: 'none',
                  outline: 'none',
                  overflow: 'hidden',
                  lineHeight: '1.2',
                  WebkitAppearance: 'none',
                  margin: 0
                }}
              />
              <button
                onClick={handleSend}
                disabled={!newMessage.trim()} // Optimistic loading: only check for message content on iOS native
                aria-label="Send message"
                className="ios-native-send-button"
              >
                <SendHorizontal className="h-4 w-4" />
              </button>
            </>
          ) : (
            // Web version layout (unchanged)
            <div className="flex items-center gap-2 w-full">
              {/* Message input with expanding height */}
              <div className="relative flex-1 flex items-center">
                <textarea
                  ref={inputRef}
                  value={newMessage}
                  onChange={(e) => {
                    setNewMessage(e.target.value);
                    // Auto-resize based on content
                    if (inputRef.current) {
                      inputRef.current.style.height = '40px';
                      const scrollHeight = inputRef.current.scrollHeight;
                      if (scrollHeight > 40) {
                        inputRef.current.style.height = `${Math.min(scrollHeight, 120)}px`;
                      }
                    }
                  }}
                  placeholder="Message"
                  aria-label="Message"
                  className="flex-1 px-4 border border-gray-200 rounded-full bg-gray-50 text-sm shadow-sm pr-10 w-full"
                  style={{
                    height: '40px',
                    minHeight: '40px',
                    maxHeight: '120px',
                    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                    resize: 'none',
                    outline: 'none',
                    paddingTop: '10px',
                    paddingBottom: '10px',
                    overflow: 'hidden',
                    lineHeight: '1.2',
                    WebkitAppearance: 'none',
                    margin: 0
                  }}
                  onFocus={() => setIsKeyboardVisible(true)}
                  onBlur={() => setIsKeyboardVisible(false)}
                  onKeyDown={(e) => {
                    // On desktop (or when not on a mobile device)
                    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
                    
                    // For desktop: Enter sends, Shift+Enter adds new line
                    if (!isMobile && e.key === 'Enter') {
                      if (!e.shiftKey && newMessage.trim()) {
                        e.preventDefault();
                        handleSend(e);
                      }
                      // Shift+Enter will naturally create a new line, so we don't need to handle it
                    }
                    
                    // For mobile: Don't intercept the Enter key, let it create a new line
                    // The send button will be used to send messages
                  }}
                />
                
                {/* No connection indicator in the input field - hidden as requested */}
              </div>
              
              {/* Web version send button */}
              <div className={`transition-all duration-200 ${newMessage.trim() ? 'scale-100 opacity-100' : 'scale-90 opacity-70'}`}>
                <button 
                  type="button" 
                  disabled={!newMessage.trim()}
                  aria-label="Send message"
                  className={`p-2 rounded-full ${
                    newMessage.trim() ? 'bg-primary text-white hover:bg-primary/90' : 'bg-gray-300 text-gray-500'
                  } min-w-[40px] h-[40px] flex items-center justify-center shadow-sm transition-colors duration-200`}
                  style={{
                    WebkitAppearance: 'none',
                    border: 'none',
                    outline: 'none'
                  }}
                  onTouchStart={(e) => {
                    // Prevent default to avoid any browser handling
                    e.preventDefault();
                    e.stopPropagation();
                    
                    logger.debug('[SendButton] Touch Start');
                    
                    // Only proceed if we have a message
                    if (!newMessage.trim()) return;
                    
                    // Set keyboard visible explicitly
                    setIsKeyboardVisible(true);
                  }}
                  onTouchEnd={(e) => {
                    // Prevent default to avoid any browser handling
                    e.preventDefault();
                    e.stopPropagation();
                    
                    logger.debug('[SendButton] Touch End');
                    
                    // Only proceed if we have a message
                    if (!newMessage.trim()) return;
                    
                    // This is where we'll send the message
                    logger.debug('[SendButton] Sending message directly');
                    handleSend(e);
                  }}
                  onClick={(e) => {
                    // For desktop clicks
                    e.preventDefault();
                    e.stopPropagation();
                    
                    logger.debug('[SendButton] Clicked');
                    
                    // For non-touch devices only
                    if (newMessage.trim()) {
                      handleSend(e);
                    }
                  }}
                >
                  <SendHorizontal className="h-5 w-5" />
                </button>
              </div>
            </div>
          )}

        </div>
        
        {/* No connection status indicator - hidden as requested */}
      </div>
    </div>
  );
}