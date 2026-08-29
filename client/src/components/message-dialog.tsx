import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState, useEffect, useRef, useCallback } from "react";
import { type User, type Message } from "@shared/schema";
import { Loader2, SendHorizontal, MessageSquare, AlertCircle, WifiOff, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { queryClient } from "@/lib/queryClient";
import { useIOSKeyboard } from "@/hooks/use-ios-keyboard";
import { Capacitor } from "@capacitor/core";
import { config } from "@/lib/config";
import { waitForTokensReady, onAccessTokenChange } from "@/lib/token-manager";
import { openAuthenticatedWebSocket } from "@/lib/websocket-ticket";
import { logger } from "@/lib/logger";

interface MessageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  otherUser: User;
}

interface MessageWithUsers extends Message {
  sender: User;
  receiver: User;
}

interface WebSocketMessage {
  type: string;
  receiverId?: number;
  content?: string;
  partnerId?: number;
}

interface PendingMessage {
  id: string;
  content: string;
  receiverId: number;
  senderId: number;
  createdAt: string;
  status: 'pending' | 'failed';
}

interface QueuedMessage {
  message: WebSocketMessage;
  attempts: number;
  timestamp: number;
  id: string;
}

const CONNECTION_STATES = {
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  RECONNECTING: 'reconnecting',
  DISCONNECTED: 'disconnected',
  FAILED: 'failed'
} as const;

type ConnectionState = typeof CONNECTION_STATES[keyof typeof CONNECTION_STATES];

export default function MessageDialog({ open, onOpenChange, otherUser }: MessageDialogProps) {
  const [newMessage, setNewMessage] = useState("");
  const { toast } = useToast();
  const scrollRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const retryTimerRef = useRef<NodeJS.Timeout>();
  const [connectionState, setConnectionState] = useState<ConnectionState>(CONNECTION_STATES.CONNECTING);
  const { user: currentUser } = useAuth();
  const [retryCount, setRetryCount] = useState(0);
  const MAX_RETRIES = 5;
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const messageQueueRef = useRef<QueuedMessage[]>([]);
  const MAX_QUEUE_SIZE = 50;
  const MAX_MESSAGE_ATTEMPTS = 3;
  const RETRY_INTERVAL = 10000; // 10 seconds between automatic retry attempts

  // We'll use our own message state instead of useQuery
  const [messages, setMessages] = useState<MessageWithUsers[]>([]);
  const [pendingMessages, setPendingMessages] = useState<PendingMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const pendingMessagesRef = useRef<PendingMessage[]>([]);
  const isLoadingRef = useRef(true);
  pendingMessagesRef.current = pendingMessages;
  isLoadingRef.current = isLoading;
  const [fetchError, setFetchError] = useState<Error | null>(null);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  
  // Initialize iOS keyboard support
  const { isNativeIOSApp, keyboardHeight, isKeyboardVisible: isIOSKeyboardVisible } = useIOSKeyboard();
  
  // Function to load messages via WebSocket
  const loadMessages = useCallback(() => {
    if (!open || !currentUser?.id || !otherUser?.id) return;
    
    logger.debug('[MessageDialog] Loading messages via WebSocket...');
    setIsLoading(true);
    setFetchError(null);
    
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setFetchError(new Error('WebSocket not connected'));
      setIsLoading(false);
      return;
    }
    
    try {
      // Send loadMessages request via WebSocket
      wsRef.current.send(JSON.stringify({
        type: 'loadMessages',
        partnerId: otherUser.id
      }));
      
      // Wait for response in onmessage handler
    } catch (error) {
      logger.error('[MessageDialog] Error sending loadMessages request:', error);
      setFetchError(error instanceof Error ? error : new Error('Failed to load messages'));
      setIsLoading(false);
    }
  }, [currentUser?.id, otherUser.id, open]);

  // Process message queue
  const processMessageQueue = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }
  
    const now = Date.now();
    const queue = messageQueueRef.current;
    const remainingMessages: QueuedMessage[] = [];
    const failedMessageIds: string[] = [];
  
    for (const item of queue) {
      // Skip messages older than 1 hour
      if (now - item.timestamp > 3600000) {
        continue;
      }
  
      if (item.attempts >= MAX_MESSAGE_ATTEMPTS) {
        toast({
          title: "Message Failed",
          description: "Unable to send message after multiple attempts",
          variant: "destructive",
        });
        
        // Mark as failed in UI
        failedMessageIds.push(item.id);
        continue;
      }
  
      try {
        wsRef.current.send(JSON.stringify(item.message));
        item.attempts++;
  
        // Keep in queue until confirmed
        remainingMessages.push(item);
      } catch (error) {
        logger.error('[WebSocket] Failed to send queued message:', error);
        remainingMessages.push(item);
        
        // Mark as failed in UI
        failedMessageIds.push(item.id);
      }
    }
  
    // Update any failed messages in the UI
    if (failedMessageIds.length > 0) {
      setPendingMessages(prev => 
        prev.map(msg => 
          failedMessageIds.includes(msg.id) ? { ...msg, status: 'failed' } : msg
        )
      );
    }
  
    messageQueueRef.current = remainingMessages;
  }, [toast, setPendingMessages]);

  // Setup periodic retry timer for queued messages
  useEffect(() => {
    // Only start timer if dialog is open and connection is established
    if (!open || connectionState !== CONNECTION_STATES.CONNECTED) {
      if (retryTimerRef.current) {
        clearInterval(retryTimerRef.current);
        retryTimerRef.current = undefined;
      }
      return;
    }
    
    // If there are pending messages or messages in queue, start periodic retry
    if ((pendingMessages.length > 0 || messageQueueRef.current.length > 0) && !retryTimerRef.current) {
      logger.debug('[MessageQueue] Starting periodic retry timer');
      retryTimerRef.current = setInterval(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN && messageQueueRef.current.length > 0) {
          logger.debug('[MessageQueue] Attempting to process queued messages');
          processMessageQueue();
        }
      }, RETRY_INTERVAL);
    }
    
    return () => {
      if (retryTimerRef.current) {
        clearInterval(retryTimerRef.current);
        retryTimerRef.current = undefined;
      }
    };
  }, [open, connectionState, pendingMessages.length, processMessageQueue]);

  // Track if we're at the bottom of the scroll
  const [isAtBottom, setIsAtBottom] = useState(true);
  const lastScrollHeight = useRef(0);
  const lastScrollTop = useRef(0);

  // Handle scroll events to track position
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    // Consider "at bottom" if within 20px of the bottom
    const atBottom = scrollTop + clientHeight >= scrollHeight - 20;
    
    setIsAtBottom(atBottom);
    lastScrollHeight.current = scrollHeight;
    lastScrollTop.current = scrollTop;
  }, []);

  // Setup scroll event listener
  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;
    
    scrollElement.addEventListener('scroll', handleScroll);
    
    return () => {
      scrollElement.removeEventListener('scroll', handleScroll);
    };
  }, [handleScroll]);

  // Enhanced scroll to bottom when new messages arrive - more reliable implementation
  useEffect(() => {
    if (!scrollRef.current) return;
    
    // If we were at the bottom before or it's the initial load, scroll to bottom
    if (isAtBottom || (!lastScrollHeight.current && (messages?.length || pendingMessages?.length))) {
      // Function to perform a reliable scroll to bottom
      const scrollToBottom = () => {
        if (!scrollRef.current) return;
        // Force immediate scroll
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      };
      
      // Try multiple scroll attempts using requestAnimationFrame for better timing
      // First: Immediate scroll
      scrollToBottom();
      
      // Second: On next animation frame (after browser paint)
      requestAnimationFrame(() => {
        scrollToBottom();
        
        // Third: After a short delay (for images or dynamic content to load)
        setTimeout(() => {
          scrollToBottom();
        }, 100);
        
        // Fourth: After a longer delay (for slower devices or complex layouts)
        setTimeout(() => {
          scrollToBottom();
        }, 300);
        
        // Final attempt (for very slow connections)
        setTimeout(() => {
          scrollToBottom();
        }, 500);
      });
    } else {
      // If we weren't at the bottom, maintain the relative scroll position
      // (helpful when loading older messages)
      const newScrollHeight = scrollRef.current.scrollHeight;
      const heightDiff = newScrollHeight - lastScrollHeight.current;
      
      if (heightDiff > 0) {
        scrollRef.current.scrollTop = lastScrollTop.current + heightDiff;
      }
    }
    
    // Update heights for next comparison
    lastScrollHeight.current = scrollRef.current.scrollHeight;
    
    // Log for debugging
    logger.debug("[MessageDialog] Scroll adjusted, scrollHeight:", scrollRef.current.scrollHeight, 
               "isAtBottom:", isAtBottom);
  }, [messages, messages?.length, pendingMessages, pendingMessages?.length, isAtBottom]);
  
  // Enhanced scroll on dialog open with multiple attempts for reliability
  useEffect(() => {
    if (!open || !scrollRef.current) return;
    
    // Function to perform reliable scroll to bottom
    const scrollToBottom = () => {
      if (!scrollRef.current) return;
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      setIsAtBottom(true);
    };
    
    // First attempt: immediately
    scrollToBottom();
    
    // Second attempt: after layout stabilizes
    requestAnimationFrame(() => {
      scrollToBottom();
      
      // Additional attempts at increasing intervals for reliability
      const scrollIntervals = [50, 150, 300, 500];
      scrollIntervals.forEach(delay => {
        setTimeout(scrollToBottom, delay);
      });
    });
    
    // Final attempt with a longer delay for complex rendering
    setTimeout(scrollToBottom, 1000);
  }, [open]);
  
  // Enhanced keyboard visibility detection with improved scroll handling
  useEffect(() => {
    // Function to perform reliable scroll to bottom
    const scrollToBottom = () => {
      if (!scrollRef.current) return;
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
          
          // Double-check with a slight delay to ensure it takes effect
          setTimeout(() => {
            if (scrollRef.current) {
              scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            }
          }, 50);
        }
      });
    };
    
    const handleKeyboardChange = () => {
      if (!window.visualViewport) return;
      
      // Keyboard is likely visible if the viewport height is significantly reduced
      // Using a slightly higher threshold for better detection
      const viewportHeightRatio = window.visualViewport.height / window.innerHeight;
      const isKeyboardLikelyVisible = viewportHeightRatio < 0.85;
      
      // Only update state if it's actually changed to avoid unnecessary renders
      setIsKeyboardVisible(prevState => {
        if (prevState !== isKeyboardLikelyVisible) {
          // Add a class to the document for global styling when keyboard is visible
          if (isKeyboardLikelyVisible) {
            document.body.classList.add('keyboard-visible');
          } else {
            document.body.classList.remove('keyboard-visible');
          }
          
          // Extra scroll attempt when keyboard visibility changes
          setTimeout(scrollToBottom, 100);
          
          return isKeyboardLikelyVisible;
        }
        return prevState;
      });
      
      // Always attempt to scroll to bottom when keyboard appears
      if (isKeyboardLikelyVisible) {
        scrollToBottom();
      }
    };
    
    // Handle input focus events which often trigger the keyboard on mobile
    const handleFocusIn = (e: FocusEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        // Input was focused, likely showing keyboard
        setTimeout(scrollToBottom, 300);
        // On iOS particularly, we need an additional delay
        setTimeout(scrollToBottom, 600);
      }
    };
    
    // Use visualViewport API if available (modern browsers)
    if ('visualViewport' in window && window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleKeyboardChange);
      // Also listen for input focus events
      document.addEventListener('focusin', handleFocusIn);
      // Initial check
      handleKeyboardChange();
      
      return () => {
        window.visualViewport?.removeEventListener('resize', handleKeyboardChange);
        document.removeEventListener('focusin', handleFocusIn);
        document.body.classList.remove('keyboard-visible');
      };
    }
    
    return undefined;
  }, []);

  // WebSocket connection management
  useEffect(() => {
    if (!open || !currentUser?.id) return;
    
    let tokenUnsubscribe: (() => void) | null = null;

    async function connect() {
      if (!mountedRef.current) return;

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        logger.debug('[WebSocket] Already connected');
        return;
      }

      if (retryCount >= MAX_RETRIES) {
        if (mountedRef.current) {
          setError("Unable to establish connection after multiple attempts");
          setConnectionState(CONNECTION_STATES.FAILED);
        }
        return;
      }
      
      // Properly handle WebSocket URL construction
      // For native iOS, use the production backend URL from config with JWT authentication
      const isNativePlatform = Capacitor.isNativePlatform();
      
      // For native platforms, always ensure tokens are ready before connecting
      if (isNativePlatform) {
        await waitForTokensReady();
        if (!mountedRef.current) return;
      }

      try {
        // Close existing connection if any
        if (wsRef.current) {
          wsRef.current.close();
          wsRef.current = null;
        }

        setConnectionState(
          retryCount > 0 ? CONNECTION_STATES.RECONNECTING : CONNECTION_STATES.CONNECTING
        );

        // Use relative path for WebSocket to ensure proper host and port resolution
        if (!currentUser?.id) {
          logger.error('[WebSocket] No user ID available for connection');
          return;
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
        
        // Never log the connection URL as-is: on native platforms it carries a
        // bearer JWT in the `token` query param. Log only the origin/path.
        logger.debug('[WebSocket] Connecting to:', wsUrl.split('?')[0]);
        const ws = await openAuthenticatedWebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!mountedRef.current) return;
          logger.debug('[WebSocket] Connected successfully');
          setConnectionState(CONNECTION_STATES.CONNECTED);
          setRetryCount(0);
          setError(null);
          processMessageQueue();
        };

        ws.onclose = (event) => {
          if (!mountedRef.current) return;
          logger.debug('[WebSocket] Connection closed:', event.code, event.reason);
          wsRef.current = null;

          if (!event.wasClean && retryCount < MAX_RETRIES && open) {
            setConnectionState(CONNECTION_STATES.RECONNECTING);
            const timeout = Math.min(1000 * Math.pow(2, retryCount), 30000);
            setRetryCount(prev => prev + 1);
            reconnectTimeoutRef.current = setTimeout(connect, timeout);
          } else {
            setConnectionState(CONNECTION_STATES.DISCONNECTED);
            setError(event.reason || "Connection closed");
          }
        };

        ws.onerror = (error) => {
          if (!mountedRef.current) return;
          logger.error('[WebSocket] Error:', error);
          setConnectionState(CONNECTION_STATES.DISCONNECTED);
          setError("Failed to connect to chat server");
        };

        ws.onmessage = async (event) => {
          if (!mountedRef.current) return;

          try {
            const data = JSON.parse(event.data);
            logger.debug('[WebSocket] Received:', data.type);

            switch (data.type) {
              case 'connected':
                setConnectionState(CONNECTION_STATES.CONNECTED);
                setError(null);
                // Once connected, load messages
                loadMessages();
                break;
                
              case 'messagesLoaded':
                // Successfully loaded messages
                logger.debug('[WebSocket] Messages loaded:', data.messages?.length || 0);
                setMessages(data.messages || []);
                setIsLoading(false);
                setFetchError(null);
                break;

              case 'messageConfirm': {
                // Successfully sent message - remove from pending and queue
                logger.debug('[WebSocket] Message confirmed by server:', data.message);
                
                // Find matching queued message - could match by content
                const queuedMsg = messageQueueRef.current.find(
                  item => item.message.content === data.message.content
                );
                
                if (queuedMsg) {
                  // Remove from queue
                  messageQueueRef.current = messageQueueRef.current.filter(
                    item => item.id !== queuedMsg.id
                  );
                  
                  // Remove from pending messages
                  setPendingMessages(prev => 
                    prev.filter(msg => msg.id !== queuedMsg.id)
                  );
                } else {
                  // Just filter by content if can't find by ID
                  messageQueueRef.current = messageQueueRef.current.filter(
                    item => item.message.content !== data.message.content
                  );
                  
                  // Try to find pending message with the same content
                  const pendingToRemove = pendingMessagesRef.current.find(
                    msg => msg.content === data.message.content
                  );
                  
                  if (pendingToRemove) {
                    setPendingMessages(prev => 
                      prev.filter(msg => msg.id !== pendingToRemove.id)
                    );
                  }
                }
                
                // Reload messages to show the new message
                loadMessages();
                break;
              }

              case 'chat':
                if (data.message?.senderId === otherUser.id || 
                    data.message?.receiverId === otherUser.id) {
                  // Reload messages when a new message is received
                  loadMessages();
                  
                  // Also make sure notification counts are up-to-date
                  // This ensures the blue glow appears immediately in the UI
                  queryClient.invalidateQueries({
                    queryKey: ["/api/notifications/counts"],
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
                  } else if (data.details.includes('Failed to get or create conversation')) {
                    errorMessage = "Unable to load conversation. Please try again later.";
                  }
                }
                
                // If this was in response to a loadMessages request, update loading state
                if (isLoadingRef.current) {
                  setIsLoading(false);
                  setFetchError(new Error(errorMessage));
                }
                
                setError(errorMessage);
                toast({
                  title: "Message Error",
                  description: errorMessage,
                  variant: "destructive",
                });
                break;
              }
            }
          } catch (error) {
            logger.error('[WebSocket] Message parsing error:', error);
          }
        };
      } catch (error) {
        if (!mountedRef.current) return;
        logger.error('[WebSocket] Setup error:', error);
        setConnectionState(CONNECTION_STATES.DISCONNECTED);
        setError("Failed to initialize chat connection");

        if (retryCount < MAX_RETRIES && open) {
          const timeout = Math.min(1000 * Math.pow(2, retryCount), 30000);
          setRetryCount(prev => prev + 1);
          reconnectTimeoutRef.current = setTimeout(connect, timeout);
        }
      }
    }

    // For native platforms, wait for tokens to be ready before connecting
    const initConnection = async () => {
      const isNativePlatform = Capacitor.isNativePlatform();
      
      if (isNativePlatform) {
        logger.debug('[MessageDialog WebSocket] Native platform - waiting for tokens to be ready...');
        await waitForTokensReady();
        logger.debug('[MessageDialog WebSocket] Tokens ready, proceeding with connection');
        
        // Subscribe to token changes to reconnect when token is refreshed
        tokenUnsubscribe = onAccessTokenChange((newToken) => {
          if (!mountedRef.current) return;
          
          // If we get a new valid token and socket is disconnected/failed, reconnect
          if (newToken && newToken !== 'PENDING_REFRESH') {
            if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
              logger.debug('[MessageDialog WebSocket] Token changed and socket not connected, reconnecting...');
              connect();
            }
          }
        });
      }
      
      if (mountedRef.current) {
        connect();
      }
    };
    
    initConnection();

    return () => {
      mountedRef.current = false;
      if (tokenUnsubscribe) {
        tokenUnsubscribe();
        tokenUnsubscribe = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = undefined;
      }
      if (retryTimerRef.current) {
        clearInterval(retryTimerRef.current);
        retryTimerRef.current = undefined;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setRetryCount(0);
      setConnectionState(CONNECTION_STATES.DISCONNECTED);
    };
  }, [currentUser?.id, otherUser.id, open, retryCount, toast, loadMessages, processMessageQueue]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newMessage.trim()) {
      return;
    }

    // Create a uniqueID for tracking this message
    const messageId = `pending-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const messageContent = newMessage.trim();
    const receiverId = otherUser.id;

    // Reset input immediately for better UX
    setNewMessage("");

    // Create WebSocket message
    const message: WebSocketMessage = {
      type: 'chat',
      receiverId,
      content: messageContent
    };

    // Create a pending message to show immediately in the UI
    const pendingMsg: PendingMessage = {
      id: messageId,
      content: messageContent,
      receiverId,
      senderId: currentUser?.id || 0,
      createdAt: new Date().toISOString(),
      status: 'pending'
    };

    // Add the pending message to the UI
    setPendingMessages(prev => [...prev, pendingMsg]);

    // Add to queue if offline or if send fails
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      if (messageQueueRef.current.length >= MAX_QUEUE_SIZE) {
        toast({
          title: "Queue Full",
          description: "Unable to queue more messages. Please wait for connection to restore.",
          variant: "destructive",
        });
        
        // Update message status to failed
        setPendingMessages(prev => 
          prev.map(msg => 
            msg.id === messageId ? { ...msg, status: 'failed' } : msg
          )
        );
        return;
      }

      // Queue for sending later
      messageQueueRef.current.push({
        message,
        attempts: 0,
        timestamp: Date.now(),
        id: messageId
      });

      // Update UI to show message but mark as pending
      toast({
        title: "Message Queued",
        description: "Message will be sent when connection is restored",
      });
    } else {
      try {
        // Attempt to send immediately
        wsRef.current.send(JSON.stringify(message));
        
        // Keep track of the message for confirmation
        messageQueueRef.current.push({
          message,
          attempts: 1, // We already attempted once
          timestamp: Date.now(),
          id: messageId
        });
      } catch (error) {
        logger.error('[WebSocket] Send error:', error);
        
        // Add to queue with failure status
        messageQueueRef.current.push({
          message,
          attempts: 1, // Count this failed attempt
          timestamp: Date.now(),
          id: messageId
        });
        
        // Mark as failed in the UI
        setPendingMessages(prev => 
          prev.map(msg => 
            msg.id === messageId ? { ...msg, status: 'failed' } : msg
          )
        );
        
        toast({
          title: "Connection Issue",
          description: "Message queued for retry",
          variant: "destructive",
        });
      }
    }
  };
  
  // Handle retry of a failed message
  const handleRetryMessage = (messageId: string) => {
    // Find the message in pendingMessages
    const pendingMsg = pendingMessages.find(msg => msg.id === messageId);
    if (!pendingMsg) return;
    
    // Mark as pending again
    setPendingMessages(prev => 
      prev.map(msg => 
        msg.id === messageId ? { ...msg, status: 'pending' } : msg
      )
    );
    
    // Find in queue if it exists
    const queuedIndex = messageQueueRef.current.findIndex(item => item.id === messageId);
    
    // Create a message for sending
    const message: WebSocketMessage = {
      type: 'chat',
      receiverId: pendingMsg.receiverId,
      content: pendingMsg.content
    };
    
    // If online, try to send immediately
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify(message));
        
        // Update or add to queue
        if (queuedIndex >= 0) {
          // Reset attempts if already in queue
          messageQueueRef.current[queuedIndex].attempts = 1;
          messageQueueRef.current[queuedIndex].timestamp = Date.now();
        } else {
          // Add to queue to track for confirmation
          messageQueueRef.current.push({
            message,
            attempts: 1,
            timestamp: Date.now(),
            id: messageId
          });
        }
      } catch (error) {
        logger.error('[WebSocket] Retry error:', error);
        // Update or add to queue for future retry
        if (queuedIndex >= 0) {
          messageQueueRef.current[queuedIndex].attempts += 1;
        } else {
          messageQueueRef.current.push({
            message,
            attempts: 1,
            timestamp: Date.now(),
            id: messageId
          });
        }
        
        // Mark as failed again
        setPendingMessages(prev => 
          prev.map(msg => 
            msg.id === messageId ? { ...msg, status: 'failed' } : msg
          )
        );
        
        toast({
          title: "Retry Failed",
          description: "Message will be retried automatically when connection improves",
          variant: "destructive",
        });
      }
    } else {
      // If offline, ensure it's in the queue
      if (queuedIndex >= 0) {
        // Reset attempt count
        messageQueueRef.current[queuedIndex].attempts = 0;
        messageQueueRef.current[queuedIndex].timestamp = Date.now();
      } else {
        // Add to queue
        messageQueueRef.current.push({
          message,
          attempts: 0,
          timestamp: Date.now(),
          id: messageId
        });
      }
      
      toast({
        title: "Offline",
        description: "Message queued for retry when connection is restored",
      });
    }
  };

  // Connection state UI elements
  const connectionStatusUI = {
    [CONNECTION_STATES.CONNECTING]: {
      icon: <Loader2 className="h-4 w-4 animate-spin" />,
      text: "Connecting...",
      color: "text-yellow-500"
    },
    [CONNECTION_STATES.CONNECTED]: {
      icon: "●",
      text: "Connected",
      color: "text-green-500"
    },
    [CONNECTION_STATES.RECONNECTING]: {
      icon: <Loader2 className="h-4 w-4 animate-spin" />,
      text: `Reconnecting (Attempt ${retryCount}/${MAX_RETRIES})`,
      color: "text-yellow-500"
    },
    [CONNECTION_STATES.DISCONNECTED]: {
      icon: <WifiOff className="h-4 w-4" />,
      text: "Disconnected",
      color: "text-red-500"
    },
    [CONNECTION_STATES.FAILED]: {
      icon: <AlertCircle className="h-4 w-4" />,
      text: "Connection Failed",
      color: "text-red-500"
    }
  };

  if (!currentUser) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[500px]">
          <div className="flex flex-col items-center justify-center h-[80vh] sm:h-[600px] gap-4">
            <AlertCircle className="h-12 w-12 text-destructive" />
            <h3 className="text-lg font-semibold">Authentication Required</h3>
            <p className="text-muted-foreground text-center">
              Please sign in to send messages
            </p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const { icon, text, color } = connectionStatusUI[connectionState];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent 
        className="sm:max-w-[500px] p-0 overflow-hidden max-h-[90vh] lg:max-h-[90vh]"
        style={{
          maxHeight: isKeyboardVisible ? '75vh' : '90vh',
          paddingBottom: 0
        }}>
        <div 
          className="flex flex-col sm:h-[600px] relative"
          style={{
            height: isKeyboardVisible ? '75vh' : '80vh',
            paddingBottom: 0,
            marginBottom: 0
          }}>
          {/* Header - fixed at top with higher z-index to ensure it stays above all content */}
          <div 
            className="py-3 px-4 border-b flex-shrink-0 bg-background fixed top-0 inset-x-0 z-20 sm:relative sm:sticky"
            style={{
              width: 'calc(100% - 2rem)', /* Account for dialog padding */
              maxWidth: '500px',
              marginLeft: 'auto',
              marginRight: 'auto'
            }}
          >
            <h2 className="text-lg font-semibold">{otherUser.fullName}</h2>
            <p className="text-sm text-muted-foreground">{otherUser.title}</p>
            <div className={`text-xs flex items-center gap-1 ${color}`}>
              {typeof icon === 'string' ? icon : icon}
              <span>{text}</span>
              {messageQueueRef.current.length > 0 && (
                <span className="ml-2">
                  ({messageQueueRef.current.length} message{messageQueueRef.current.length !== 1 ? 's' : ''} queued)
                </span>
              )}
            </div>
          </div>

          {/* Error banner */}
          {error && (
            <div className="bg-red-100 dark:bg-red-900 p-2 text-center flex-shrink-0 sticky top-0 z-10 mt-[57px] border-b">
              <p className="text-red-700 dark:text-red-100 text-sm">
                {error}
              </p>
            </div>
          )}

          {/* Messages area - scrollable content between fixed header and footer */}
          <div 
            className="flex-1 px-4 pt-0 pb-1 overflow-y-auto min-h-[100px] scroll-container scrollbar-hide"
            style={{
              maxHeight: isKeyboardVisible 
                ? 'calc(75vh - 100px)' 
                : 'calc(80vh - 100px)',
              paddingTop: '52px', /* Further reduced padding to account for fixed header */
              marginBottom: 0, /* Ensure no bottom margin creating space */
              overscrollBehavior: 'none',
              WebkitOverflowScrolling: 'touch'
            }}
            ref={scrollRef}>
            {isLoading ? (
              <div className="flex justify-center items-center h-full">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : fetchError ? (
              <div className="flex flex-col justify-center items-center h-full gap-4 text-destructive">
                <AlertCircle className="h-8 w-8" />
                <p>Error loading messages</p>
                <Button 
                  variant="outline" 
                  onClick={() => loadMessages()}
                  className="gap-2"
                >
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Try Again
                </Button>
              </div>
            ) : !messages?.length ? (
              <div className="flex flex-col justify-center items-center h-full text-muted-foreground gap-4">
                <MessageSquare className="h-12 w-12 opacity-50" />
                <p>No messages yet</p>
                <p className="text-sm text-center px-8">
                  Start a conversation with {otherUser.fullName}!
                </p>
              </div>
            ) : (
              <div className="space-y-2 pb-0 mb-0"> {/* Reduced vertical spacing between messages */}
                {/* Regular server-confirmed messages */}
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={cn(
                      "max-w-[80%]",
                      message.senderId === currentUser?.id ? "ml-auto" : "mr-auto"
                    )}
                  >
                    <div
                      className={cn(
                        "p-3 rounded-lg",
                        message.senderId === currentUser?.id
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted"
                      )}
                    >
                      <p className="break-words">{message.content}</p>
                      <p className="text-xs mt-1 opacity-70">
                        {new Date(message.createdAt).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                ))}
                
                {/* Pending/Failed messages (only from current user) */}
                {pendingMessages.map((message) => (
                  <div
                    key={message.id}
                    className="max-w-[80%] ml-auto"
                  >
                    <div
                      className={cn(
                        "p-3 rounded-lg relative",
                        message.status === 'pending' 
                          ? "bg-primary text-primary-foreground" 
                          : "bg-destructive/60 text-destructive-foreground"
                      )}
                    >
                      <p className="break-words">{message.content}</p>
                      <div className="flex items-center justify-between mt-1">
                        <p className="text-xs opacity-70">
                          {new Date(message.createdAt).toLocaleTimeString()}
                        </p>
                        
                        {message.status === 'failed' && (
                          <div className="flex items-center text-xs ml-1">
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="h-5 px-2 py-0 text-destructive-foreground hover:text-destructive-foreground/80 flex items-center gap-1"
                              onClick={() => handleRetryMessage(message.id)}
                            >
                              <RefreshCw className="h-3 w-3 mr-1" />
                              <span>Failed to send, try again</span>
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Input area - fixed at bottom with adjusted padding when keyboard is visible */}
          <form 
            onSubmit={handleSend} 
            className={`py-1.5 px-4 border-t flex gap-2 flex-shrink-0 bg-background fixed bottom-0 inset-x-0 z-20 sm:relative sm:sticky ${
              isNativeIOSApp ? 'chat-input-container' : ''
            }`}
            style={{
              bottom: isNativeIOSApp && isIOSKeyboardVisible ? `${keyboardHeight}px` : 0,
              width: 'calc(100% - 2rem)', /* Account for dialog padding */
              maxWidth: '500px',
              marginLeft: 'auto',
              marginRight: 'auto',
              marginTop: 0,
              paddingTop: '4px',
            }}>
            <Input
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder={
                connectionState === CONNECTION_STATES.CONNECTED
                  ? "Type a message..."
                  : connectionState === CONNECTION_STATES.CONNECTING
                  ? "Connecting..."
                  : "Waiting for connection..."
              }
              className={`flex-1 ${
                (isNativeIOSApp ? isIOSKeyboardVisible : isKeyboardVisible) ? 'h-9' : 'h-10'
              } ${isNativeIOSApp ? 'ios-native-input' : ''}`}
              style={{ 
                minHeight: (isNativeIOSApp ? isIOSKeyboardVisible : isKeyboardVisible) ? '36px' : '40px'
              }}
              disabled={connectionState === CONNECTION_STATES.FAILED}
              // Use iOS native keyboard focus/blur or web keyboard handlers
              onFocus={isNativeIOSApp ? undefined : () => setIsKeyboardVisible(true)}
              onBlur={isNativeIOSApp ? undefined : () => setIsKeyboardVisible(false)}
            />
            <Button 
              type="submit" 
              disabled={connectionState === CONNECTION_STATES.FAILED || !newMessage.trim()}
              className={`${isKeyboardVisible ? 'px-3 h-9 min-w-9' : 'px-4 h-10 min-w-10'}`}
            >
              <SendHorizontal className={`${isKeyboardVisible ? 'h-3.5 w-3.5' : 'h-4 w-4'}`} />
            </Button>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}