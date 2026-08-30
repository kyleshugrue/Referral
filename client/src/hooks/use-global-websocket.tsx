import { useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { logger } from '@/lib/logger';
import { onAccessTokenChange } from '@/lib/token-manager';
import { MATCHES_QUERY_KEY } from '@/lib/match-query-utils';
import { config } from '@/lib/config';
import { Capacitor } from '@capacitor/core';
import { connectionRequestCache } from '@/hooks/use-profiles.tsx';
import { openAuthenticatedWebSocket } from '@/lib/websocket-ticket';

// Connection states
export const CONNECTION_STATES = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  RECONNECTING: 'reconnecting',
  CONNECTED: 'connected',
  FAILED: 'failed',
} as const;

type ConnectionState = typeof CONNECTION_STATES[keyof typeof CONNECTION_STATES];

// Message types for WebSocket communication
interface WebSocketMessage {
  type: string;
  [key: string]: unknown;
}

type TrackedWebSocket = WebSocket & { connectionId?: number };

interface UseGlobalWebSocketOptions {
  enableReconnect?: boolean;
  maxRetries?: number;
  reconnectInterval?: number;
}

// Global WebSocket instance and state
let globalWsRef: TrackedWebSocket | null = null;
let connectionState: ConnectionState = CONNECTION_STATES.DISCONNECTED;
let retryCount = 0;
let reconnectTimeout: NodeJS.Timeout | null = null;
const listeners: Set<(message: WebSocketMessage) => void> = new Set();
const stateListeners: Set<(state: ConnectionState) => void> = new Set();
// CRITICAL FIX: Connection instance tracking to prevent stale socket reconnects
let currentConnectionId = 0;
// Debounce timestamp for matchesUpdated events to prevent rapid refetches
let lastMatchRefreshTime = 0;
const MATCH_REFRESH_DEBOUNCE_MS = 500;
// Track current userId for JWT token reconnection
let currentUserId: number | null = null;

// Subscribe to token changes - reconnect WebSocket when JWT token refreshes
onAccessTokenChange((newToken) => {
  if (newToken && currentUserId && globalWsRef) {
    logger.debug('[WebSocket] Access token changed, reconnecting with new token');
    // Close existing connection
    if (globalWsRef) {
      globalWsRef.close();
      globalWsRef = null;
    }
    // Reconnect with new token
    connectGlobalWebSocket(currentUserId);
  }
});

// Function to update connection state and notify all listeners
function updateConnectionState(newState: ConnectionState) {
  connectionState = newState;
  stateListeners.forEach(listener => listener(newState));
}

// Function to broadcast message to all listeners
function broadcastMessage(message: WebSocketMessage) {
  listeners.forEach(listener => listener(message));
}

// Global connect function
async function connectGlobalWebSocket(userId: number, options: UseGlobalWebSocketOptions = {}) {
  const { enableReconnect = true, maxRetries = 5, reconnectInterval = 500 } = options;

  if (!userId) return;
  
  // Track userId for JWT token reconnection
  currentUserId = userId;

  if (retryCount > maxRetries) {
    logger.error(`[GlobalWebSocket] Max retries (${maxRetries}) exceeded`);
    updateConnectionState(CONNECTION_STATES.FAILED);
    return;
  }

  // Prevent concurrent connection attempts
  if (globalWsRef && globalWsRef.readyState === WebSocket.CONNECTING) {
    logger.debug('[GlobalWebSocket] Connection already in progress, skipping...');
    return;
  }

  // CRITICAL FIX: Clear any pending reconnect timers to prevent stacked timers
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  // Close existing connection if any
  if (globalWsRef) {
    globalWsRef.close();
    globalWsRef = null;
  }

  try {
    updateConnectionState(
      retryCount > 0 ? CONNECTION_STATES.RECONNECTING : CONNECTION_STATES.CONNECTING
    );

    // Build WebSocket URL - use production backend URL for native platforms
    const isNativePlatform = Capacitor.isNativePlatform();
    let wsProtocol: string;
    let wsHost: string;
    
    if (isNativePlatform) {
      // Native iOS/Android: Use the production backend URL from config
      const baseUrl = config.apiBaseUrl;
      wsProtocol = baseUrl.startsWith('https://') ? 'wss:' : 'ws:';
      wsHost = baseUrl.replace(/^https?:\/\//, '');
      logger.debug('[WebSocket] Native platform detected, using production URL:', wsHost);
    } else {
      // Web: Use window.location
      wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      wsHost = window.location.host;
    }
    
    const wsUrl = `${wsProtocol}//${wsHost}/ws`;
    
    logger.debug(`[GlobalWebSocket] Connecting to WebSocket...`);
    globalWsRef = await openAuthenticatedWebSocket(wsUrl) as TrackedWebSocket;

    // CRITICAL FIX: Assign connection ID to this socket instance
    currentConnectionId++;
    globalWsRef.connectionId = currentConnectionId;
    logger.debug(`[WebSocket] Assigning connectionId ${currentConnectionId} to new socket`);

    globalWsRef.onopen = (event) => {
      const socket = event.target as TrackedWebSocket;
      // CRITICAL FIX: Clear reconnect timeout on successful connection
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
      
      logger.debug(`[WebSocket] Connection established for connectionId ${socket.connectionId}`);
      updateConnectionState(CONNECTION_STATES.CONNECTED);
      retryCount = 0; // Reset retry count on successful connection

      // Send authentication message
      if (globalWsRef?.readyState === WebSocket.OPEN) {
        globalWsRef.send(JSON.stringify({ 
          type: 'authenticate', 
          userId 
        }));
      }
    };

    globalWsRef.onmessage = (event) => {
      const socket = event.target as TrackedWebSocket;
      // CRITICAL FIX: Only process messages from current socket instance
      if (socket.connectionId !== currentConnectionId) {
        logger.debug(`[WebSocket] Ignoring message from stale connectionId ${socket.connectionId}, current is ${currentConnectionId}`);
        return;
      }
      
      try {
        const data = JSON.parse(event.data) as WebSocketMessage;
        logger.debug(`[WebSocket] Received message:`, data);
        broadcastMessage(data);
      } catch (error) {
        logger.error('[WebSocket] Error parsing message:', error);
      }
    };

    globalWsRef.onclose = (event) => {
      const socket = event.target as TrackedWebSocket;
      logger.debug(`[WebSocket] Connection closed: code=${event.code}, reason=${event.reason}`);
      
      // CRITICAL FIX: Only process close events from current socket instance
      if (socket.connectionId !== currentConnectionId) {
        logger.debug(`[WebSocket] Ignoring close from stale connectionId ${socket.connectionId}, current is ${currentConnectionId}`);
        return;
      }
      
      globalWsRef = null;
      
      // CRITICAL FIX: Don't reconnect on clean replacement (code 1000 with "New connection established")
      if (event.code === 1000 && event.reason === 'New connection established') {
        logger.debug(`[WebSocket] Connection closed for replacement, not reconnecting`);
        updateConnectionState(CONNECTION_STATES.DISCONNECTED);
        return;
      }
      
      // Only reconnect on unexpected closures
      if (event.code !== 1000 && enableReconnect && retryCount < maxRetries) {
        retryCount++;
        updateConnectionState(CONNECTION_STATES.RECONNECTING);
        
        logger.debug(`[WebSocket] Scheduling reconnect attempt ${retryCount}/${maxRetries} in ${reconnectInterval}ms`);
        reconnectTimeout = setTimeout(() => {
          connectGlobalWebSocket(userId, options);
        }, reconnectInterval);
      } else {
        updateConnectionState(CONNECTION_STATES.DISCONNECTED);
      }
    };

    globalWsRef.onerror = (event) => {
      const socket = event.target as TrackedWebSocket;
      // CRITICAL FIX: Only process errors from current socket instance
      if (socket.connectionId !== currentConnectionId) {
        logger.debug(`[WebSocket] Ignoring error from stale connectionId ${socket.connectionId}, current is ${currentConnectionId}`);
        return;
      }
      
      logger.error('[WebSocket] Connection error:', event);
    };

  } catch (error) {
    logger.error('[GlobalWebSocket] Connection failed:', error);
    updateConnectionState(CONNECTION_STATES.FAILED);
  }
}

// Hook for components to use the global WebSocket
export function useGlobalWebSocket(options: UseGlobalWebSocketOptions = {}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const handlerRef = useRef<((message: WebSocketMessage) => void) | null>(null);
  const stateHandlerRef = useRef<((state: ConnectionState) => void) | null>(null);
  const prevStateRef = useRef<ConnectionState>(connectionState);

  // Message handler that invalidates notification counts for real-time updates
  const handleMessage = useCallback((message: WebSocketMessage) => {
    logger.debug('[GlobalWebSocket] Processing message:', message);
    
    // Handle different message types
    switch (message.type) {
      case 'connectionRequest':
        logger.debug('[GlobalWebSocket] New connection request received');
        // Immediately refresh notification counts
        queryClient.invalidateQueries({ queryKey: ['/api/notifications/counts'] });
        queryClient.invalidateQueries({ queryKey: ['/api/connections/requests'] });
        
        toast({
          title: "New Connection Request",
          description: "You have received a new connection request",
        });
        break;

      case 'connectionAccepted':
        logger.debug('[GlobalWebSocket] Connection request accepted');
        // Refresh relevant queries
        queryClient.invalidateQueries({ queryKey: ['/api/notifications/counts'] });
        queryClient.invalidateQueries({ queryKey: ['/api/connections'] });
        queryClient.invalidateQueries({ queryKey: ['/api/connections/outgoing'] });
        
        toast({
          title: "Connection Accepted",
          description: "Your connection request was accepted!",
        });
        break;

      case 'connectionRejected':
        logger.debug('[GlobalWebSocket] Connection request rejected', message);
        
        // Immediately clear the cache entry for the rejector
        // message.rejectedById is the person who rejected (the one we had a pending request to)
        if (message.rejectedById && typeof message.rejectedById === 'number') {
          logger.debug(`[GlobalWebSocket] Removing pending request for user ${message.rejectedById} from cache`);
          connectionRequestCache.removePendingRequest(message.rejectedById);
        }
        
        // Also invalidate the query to ensure UI state is synced
        queryClient.invalidateQueries({ queryKey: ['/api/connections/outgoing'] });
        
        toast({
          title: "Connection Request Update",
          description: "A connection request has been declined",
        });
        break;

      case 'matchRefresh':
        logger.debug('[GlobalWebSocket] Synergy AI matches ready from Worker VM');
        
        // Clear localStorage flags
        localStorage.removeItem('synergyMatchesRefreshing');
        localStorage.removeItem('synergyMatchesRefreshingStartTime');
        
        // Dispatch custom event for matches page to listen to
        window.dispatchEvent(new CustomEvent('matchesUpdated'));
        
        // CRITICAL: Prefetch matches immediately so they're in cache before user navigates
        // This ensures instant loading with no spinner when user opens matches page
        queryClient.prefetchQuery({ 
          queryKey: MATCHES_QUERY_KEY,
          staleTime: 60000,
        }).then(() => {
          logger.debug('[GlobalWebSocket] Matches prefetched successfully into cache');
        }).catch((error) => {
          logger.error('[GlobalWebSocket] Error prefetching matches:', error);
        });
        
        toast({
          title: "Matches Ready",
          description: "Your synergy AI matches have been generated",
        });
        break;

      case 'matchesUpdated': {
        logger.debug('[GlobalWebSocket] Matches updated due to profile changes');
        
        // Debounce rapid-fire updates to prevent flickering
        const now = Date.now();
        const timeSinceLastRefresh = now - lastMatchRefreshTime;
        
        if (timeSinceLastRefresh < MATCH_REFRESH_DEBOUNCE_MS) {
          logger.debug(`[GlobalWebSocket] Debouncing matchesUpdated (${timeSinceLastRefresh}ms since last refresh, waiting ${MATCH_REFRESH_DEBOUNCE_MS}ms)`);
          return;
        }
        
        lastMatchRefreshTime = now;
        
        // Clear localStorage flags
        localStorage.removeItem('synergyMatchesRefreshing');
        localStorage.removeItem('synergyMatchesRefreshingStartTime');
        
        // Dispatch custom event for network page to listen to
        window.dispatchEvent(new CustomEvent('matchesUpdated'));
        
        // CRITICAL: Prefetch updated matches immediately so they're in cache before user navigates
        // This ensures instant loading with no spinner when user opens matches page
        queryClient.prefetchQuery({ 
          queryKey: MATCHES_QUERY_KEY,
          staleTime: 60000,
        }).then(() => {
          logger.debug('[GlobalWebSocket] Updated matches prefetched successfully into cache');
        }).catch((error) => {
          logger.error('[GlobalWebSocket] Error prefetching updated matches:', error);
        });
        
        toast({
          title: "Matches Updated",
          description: "Your matches have been refreshed due to profile changes",
        });
        break;
      }

      case 'message':
      case 'chat':
        logger.debug('[GlobalWebSocket] New message received');
        // Refresh notification counts and conversations
        queryClient.invalidateQueries({ queryKey: ['/api/notifications/counts'] });
        queryClient.invalidateQueries({ queryKey: ['/api/conversations'] });
        // Also refresh specific message thread if available
        if (message.senderId) {
          queryClient.invalidateQueries({ queryKey: ['/api/messages', message.senderId] });
        }
        break;

      case 'messageConfirm':
        logger.debug('[GlobalWebSocket] Message confirmed');
        queryClient.invalidateQueries({ queryKey: ['/api/notifications/counts'] });
        queryClient.invalidateQueries({ queryKey: ['/api/conversations'] });
        break;

      default:
        logger.debug('[GlobalWebSocket] Unhandled message type:', message.type);
    }
  }, [queryClient, toast]);

  // Initialize connection when user is available
  useEffect(() => {
    if (import.meta.env.VITE_SMOKE_TEST === 'true') return;
    if (!user?.id) return;

    // Create message handler
    handlerRef.current = handleMessage;
    listeners.add(handlerRef.current);
    
    // Create state handler to catch reconnections and refresh matches
    stateHandlerRef.current = (newState: ConnectionState) => {
      // When reconnecting successfully, FORCE refetch matches to catch missed updates
      // Using refetchQueries instead of invalidateQueries ensures immediate fetch
      if (prevStateRef.current === CONNECTION_STATES.RECONNECTING && newState === CONNECTION_STATES.CONNECTED) {
        logger.debug('[GlobalWebSocket] Reconnected - FORCING immediate match refetch to catch missed updates');
        // Force immediate refetch, not just cache invalidation
        queryClient.refetchQueries({ queryKey: MATCHES_QUERY_KEY });
        // Also dispatch custom event so network-page can react
        window.dispatchEvent(new CustomEvent('matchesUpdated'));
      }
      prevStateRef.current = newState;
    };
    stateListeners.add(stateHandlerRef.current);

    // Connect if not already connected
    if (connectionState === CONNECTION_STATES.DISCONNECTED) {
      connectGlobalWebSocket(user.id, options);
    }

    // Cleanup on unmount
    return () => {
      if (handlerRef.current) {
        listeners.delete(handlerRef.current);
        handlerRef.current = null;
      }
      if (stateHandlerRef.current) {
        stateListeners.delete(stateHandlerRef.current);
        stateHandlerRef.current = null;
      }
    };
  }, [user?.id, handleMessage, options, queryClient]);

  // Send message function
  const sendMessage = useCallback((message: WebSocketMessage) => {
    if (globalWsRef?.readyState === WebSocket.OPEN) {
      globalWsRef.send(JSON.stringify(message));
      return true;
    } else {
      logger.warn('[GlobalWebSocket] Cannot send message - connection not open');
      return false;
    }
  }, []);

  return {
    connectionState,
    sendMessage,
    isConnected: connectionState === CONNECTION_STATES.CONNECTED,
  };
}

// Export function to disconnect (useful for cleanup)
export function disconnectGlobalWebSocket() {
  // Clear userId tracking
  currentUserId = null;
  
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  
  if (globalWsRef) {
    globalWsRef.close();
    globalWsRef = null;
  }
  
  updateConnectionState(CONNECTION_STATES.DISCONNECTED);
  retryCount = 0;
}