import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { Server as HTTPServer } from 'http';
import { storage } from './storage';
import { sessionMiddleware } from './auth';
import { logger } from './lib/logger';
import type { Request, Response } from 'express';
import type { Session } from 'express-session';
import { logSecurityEvent } from './lib/security-logger';
import { consumeWebSocketTicket } from './lib/websocket-tickets';
import { messageSchema } from './lib/websocket-message-schema';
export { messageSchema } from './lib/websocket-message-schema';
import {
  createWebSocketMessageGuard,
  createWebSocketAdmissionGuard,
  decideWebSocketVerification,
  MAX_WEBSOCKET_PAYLOAD_BYTES,
} from './lib/websocket-security';
import { getTrustedClientIp, isOriginAllowed } from './lib/http-security';
import { isActiveAccount } from './lib/account-status';
import { decodeMessageCursor, DEFAULT_MESSAGE_PAGE_SIZE } from './lib/message-pagination';
import { toMessageDto } from './lib/privacy-dto';

interface SessionRequest extends IncomingMessage {
  session?: Session & { userId?: number };
  authenticatedUserId?: number; // Set by verifyClient after JWT or session authentication
}

interface ConnectedClient {
  ws: WebSocket;
  userId: number;
  lastPong: number;
  pingSentAt: number | null;
  pingTimeout?: NodeJS.Timeout;
  reconnectAttempts: number;
  firstConnectTime: number;
  platform?: string; // Track web vs native platform
}

// Track connected users with additional metadata
const connectedClients = new Map<number, ConnectedClient>();
const websocketAdmissionGuard = createWebSocketAdmissionGuard();

// Export the utility function to get access to connected clients in other files
import { setConnectedClientsRef } from './websocket-utils';

// Add function to manually clear blocked connections (for debugging/admin use)
export function clearBlockedConnections() {
  logger.debug('[WebSocket] Manually clearing all blocked connections');
  connectedClients.clear();
}

// Constants for connection management
const PING_INTERVAL = 30000; // 30 seconds
const PING_TIMEOUT = 5000; // 5 seconds
const CLEANUP_INTERVAL = 60000; // 1 minute
const MAX_RECONNECT_ATTEMPTS = 15; // Allow more reconnects for mobile users with unstable connections
const RECONNECT_RESET_TIME = 60000; // 1 minute - time to reset reconnect counter

// EMERGENCY KILL-SWITCH: Set to false to disable all WebSocket connections
const WS_ENABLED = process.env.WS_ENABLED !== 'false';

export function setupWebSocketServer(server: HTTPServer) {
  logger.debug('[WebSocket] Initializing WebSocket server on path /ws');
  
  // Set the reference to connected clients for use in websocket-utils
  setConnectedClientsRef(connectedClients);
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    clientTracking: true,
    // Enforced by ws before a large frame is handed to our message handler.
    maxPayload: MAX_WEBSOCKET_PAYLOAD_BYTES,
    verifyClient: async (info, callback) => {
      try {
        const sourceAddress = getTrustedClientIp(info.req.headers, info.req.socket.remoteAddress);
        if (!websocketAdmissionGuard.allow(sourceAddress)) {
          callback(false, 429, 'Too many WebSocket connection attempts');
          return;
        }
        const isProduction = process.env.NODE_ENV === 'production';
        const origin = typeof info.origin === 'string' && info.origin.length > 0 ? info.origin : undefined;
        if (origin && !isOriginAllowed(origin, isProduction)) {
          callback(false, 403, 'Origin not allowed');
          return;
        }
        let authenticatedUserId: number | undefined;
        let authMethod: 'ticket' | 'session' | 'none' = 'none';
        const protocols = String(info.req.headers['sec-websocket-protocol'] ?? '')
          .split(',')
          .map((protocol) => protocol.trim());
        const ticketProtocol = protocols.find((protocol) => protocol.startsWith('referral-ws-ticket.'));

        if (ticketProtocol) {
          const ticketResult = await consumeWebSocketTicket(
            ticketProtocol.slice('referral-ws-ticket.'.length),
          );
          if (ticketResult) {
            authenticatedUserId = ticketResult.userId;
            authMethod = 'ticket';
            (info.req as SessionRequest).authenticatedUserId = ticketResult.userId;
            logger.debug('[WebSocket] Ticket authentication successful');
          }
        }
        
        // AUTHENTICATION METHOD 2: Session-based authentication (fallback)
        if (authMethod === 'none') {
          if (isProduction && !origin) {
            callback(false, 403, 'Origin required for session authentication');
            return;
          }
          logger.debug('[WebSocket] No valid ticket, attempting session authentication');
          
          // Create a mock Response object for session middleware
          const mockRes = {
            getHeader: () => undefined,
            setHeader: () => {},
            end: () => {},
            write: () => {},
          } as unknown as Response;

          // Parse session for authentication
          await new Promise<void>((resolve, reject) => {
            sessionMiddleware(info.req as Request, mockRes, (err?: unknown) => {
              if (err) reject(err);
              else resolve();
            });
          });

          const session = (info.req as SessionRequest).session;
          const passportUser = (info.req as SessionRequest & { user?: { id?: number } }).user;
          
          // Check both session.userId and Passport user for compatibility with existing sessions
          const sessionUserId = session?.userId || passportUser?.id;
          
          if (session && sessionUserId) {
            authenticatedUserId = sessionUserId;
            authMethod = 'session';
            (info.req as SessionRequest).authenticatedUserId = sessionUserId;
            logger.debug('[WebSocket] Session authentication successful');
          }
        }
        
        // AUTHENTICATION FAILED: Neither JWT nor session authentication succeeded
        if (!authenticatedUserId || authMethod === 'none') {
          logSecurityEvent('warn', 'WebSocket - Missing Auth', {
            action: 'websocket_auth_missing',
            userId: 'unknown',
            ip: getTrustedClientIp(info.req.headers, info.req.socket.remoteAddress),
            userAgent: info.req.headers['user-agent'] || 'unknown',
            platform: 'unknown'
          });
          logger.error('[WebSocket] Authentication failed: no valid ticket or session');
          callback(false, 401, 'Unauthorized - Authentication required');
          return;
        }
        
        // Continue with user verification (database check)
        const userLookupPromise = storage.getUser(authenticatedUserId);
        let verificationTimeout: ReturnType<typeof setTimeout>;
        const timeoutPromise = new Promise((_, reject) => {
          verificationTimeout = setTimeout(() => reject(new Error('User verification timeout')), 5000);
        });
        
        let user: unknown;
        let verificationError: unknown;
        try {
          user = await Promise.race([userLookupPromise, timeoutPromise]);
        } catch (error) {
          verificationError = error;
        } finally {
          clearTimeout(verificationTimeout!);
        }
        const verificationDecision = decideWebSocketVerification(user, verificationError);
        if (verificationDecision.allowed && !isActiveAccount(user as { accountStatus?: string } | null)) {
          callback(false, 403, 'Account is not active');
          return;
        }
        if (!verificationDecision.allowed) {
          if (verificationError) {
            logger.error('[WebSocket] User verification unavailable:', verificationError);
          }
          if (!verificationError) {
            logger.error('[WebSocket] User not found in database:', authenticatedUserId);
          }
          callback(false, verificationDecision.statusCode, verificationDecision.reason);
          return;
        }
        logger.debug(`[WebSocket] User ${authenticatedUserId} verified (auth method: ${authMethod}), allowing connection`);
        callback(true);
      } catch (error) {
        logger.error('[WebSocket] Client verification failed:', error);
        callback(false, 503, 'Authentication verification unavailable');
      }
    }
  });

  // Setup periodic connection cleanup
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [userId, client] of connectedClients.entries()) {
        if (now - client.lastPong > PING_INTERVAL + PING_TIMEOUT) {
        logger.debug(`[WebSocket] Cleaning up stale connection for user ${userId}`);
        try {
          client.ws.terminate();
        } catch (error) {
          logger.error(`[WebSocket] Error terminating connection for user ${userId}:`, error);
        }
        connectedClients.delete(userId);
      }
    }
  }, CLEANUP_INTERVAL);

  wss.on('connection', async (ws: WebSocket, request: IncomingMessage) => {
    logger.debug('[WebSocket] New connection attempt');
    ws.on('error', (error) => {
      // A frame that exceeds ws's maxPayload is reported on the individual
      // socket. Always consume it so malformed clients cannot create an
      // unhandled process-level error.
      logger.warn('[WebSocket] Client socket error:', error);
    });
    let userId: number | null = null;
    let pingInterval: NodeJS.Timeout;

    // EMERGENCY KILL-SWITCH: Close immediately if disabled
    if (!WS_ENABLED) {
      logger.debug('[WebSocket] EMERGENCY: WebSocket disabled, closing connection');
      ws.close(1001, 'Service temporarily disabled');
      return;
    }

    try {
      // Use the userId stored during authentication (JWT or session)
      // This is set in verifyClient after authentication succeeds
      userId = (request as SessionRequest).authenticatedUserId ?? null;
      
      if (!userId) {
        logger.error('[WebSocket] No authenticated userId available (should have been set in verifyClient)');
        ws.close(4400, 'Authentication error');
        return;
      }
      
      logger.debug(`[WebSocket] Connection handler: userId=${userId}`);

      // Handle existing connection - CRITICAL FIX for reconnection loop
      const existingClient = connectedClients.get(userId);
      const now = Date.now();
      
      if (existingClient) {
        logger.debug('[WebSocket] Found existing connection for user:', userId);
        
        // Reset reconnect counter if enough time has passed since first connection
        const timeSinceFirstConnect = now - existingClient.firstConnectTime;
        const shouldResetReconnectCount = timeSinceFirstConnect > RECONNECT_RESET_TIME;
        
        if (shouldResetReconnectCount) {
          logger.debug(`[WebSocket] Resetting reconnect counter for user ${userId} after ${Math.round(timeSinceFirstConnect / 60000)} minutes`);
        }
        
        const currentReconnectAttempts = shouldResetReconnectCount ? 0 : existingClient.reconnectAttempts;
        
        // If max reconnect attempts reached and not enough time passed, clear the connection and allow reconnect
        if (currentReconnectAttempts >= MAX_RECONNECT_ATTEMPTS && !shouldResetReconnectCount) {
          logger.debug(`[WebSocket] Too many reconnection attempts for user ${userId} (${currentReconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}). Time since first connect: ${Math.round(timeSinceFirstConnect / 60000)} minutes - clearing connection to allow reconnect`);
          // Clear the existing connection to allow fresh reconnection
          connectedClients.delete(userId);
        }

        // CRITICAL FIX: Remove existing client BEFORE closing to prevent instance mismatch
        connectedClients.delete(userId);
        
        // Close existing connection gracefully
        try {
          if (existingClient.ws.readyState === WebSocket.OPEN) {
            existingClient.ws.close(1000, 'New connection established');
          }
        } catch (error) {
          logger.error('[WebSocket] Error closing existing connection:', error);
        }
      }

      // Extract platform information from User-Agent or other headers
      const userAgent = request.headers['user-agent'] || '';
      let platform = 'unknown';
      if (userAgent.includes('Capacitor')) {
        platform = userAgent.includes('iPhone') || userAgent.includes('iOS') ? 'ios-native' : 'android-native';
      } else {
        platform = 'web';
      }

      // Store new connection with metadata
      const newReconnectAttempts = existingClient ? 
        (now - existingClient.firstConnectTime > RECONNECT_RESET_TIME ? 1 : existingClient.reconnectAttempts + 1) :
        1;
        
      connectedClients.set(userId, {
        ws,
        userId,
        lastPong: now,
        pingSentAt: null,
        reconnectAttempts: newReconnectAttempts,
        firstConnectTime: existingClient?.firstConnectTime || now,
        platform
      });

      const client = connectedClients.get(userId);
      logger.debug(`[WebSocket] User ${userId} connected (${platform}, attempt ${client?.reconnectAttempts}). Total connected users: ${connectedClients.size}`);

      logSecurityEvent('info', 'WebSocket - Connected', {
        action: 'websocket_connected',
        userId: userId,
        ip: getTrustedClientIp(request.headers, request.socket.remoteAddress),
        userAgent: request.headers['user-agent'] || 'unknown',
        platform: platform
      });

      // Send connection confirmation with platform info
      ws.send(JSON.stringify({
        type: 'connected',
        userId: userId,
        platform: platform,
        reconnectAttempt: client?.reconnectAttempts || 1
      }));

      // Setup ping/pong for connection monitoring
      pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          const client = connectedClients.get(userId!);
          if (!client || client.pingSentAt !== null) {
            return;
          }
          const pingSentAt = Date.now();
          client.pingSentAt = pingSentAt;
          ws.ping(String(pingSentAt));
          client.pingTimeout = setTimeout(() => {
            const current = connectedClients.get(userId!);
            if (current?.ws === ws && current.pingSentAt === pingSentAt) {
              logger.debug(`[WebSocket] Pong timeout; terminating stale connection for user ${userId}`);
              current.pingTimeout = undefined;
              ws.terminate();
            }
          }, PING_TIMEOUT);
        }
      }, PING_INTERVAL);

      // Handle incoming messages
      const messageGuard = createWebSocketMessageGuard();
      ws.on('message', async (data) => {
        try {
          const payload = Array.isArray(data)
            ? Buffer.concat(data)
            : Buffer.isBuffer(data)
              ? data
              : Buffer.from(data);
          const guardDecision = messageGuard.allow(payload.byteLength);
          if (!guardDecision.allowed) {
            ws.close(guardDecision.closeCode, guardDecision.reason);
            return;
          }
          const message = JSON.parse(payload.toString('utf8'));
          logger.debug(`[WebSocket] Received message type "${message.type}" from user ${userId}`);

          // Validate message format
          const validatedMessage = messageSchema.parse(message);

          switch (validatedMessage.type) {
            case 'authenticate':
              try {
                logger.debug(`[WebSocket] User ${userId} authenticated successfully`);
                // Authentication is already handled during connection verification
                // Send confirmation back to client
                ws.send(JSON.stringify({
                  type: 'authenticated',
                  userId: userId,
                  status: 'success'
                }));
              } catch (error) {
                handleError(ws, 'Authentication failed', error);
              }
              break;

            case 'loadMessages':
              try {
                const { partnerId, limit = DEFAULT_MESSAGE_PAGE_SIZE, cursor: rawCursor } = validatedMessage;
                if (!partnerId) {
                  throw new Error('Invalid or missing partner ID');
                }
                const cursor = rawCursor ? decodeMessageCursor(rawCursor) : undefined;
                if (rawCursor && !cursor) throw new Error('Invalid message cursor');

                // First check if the users are connected
                try {
                  const connection = await storage.getConnectionBetweenUsers(userId!, partnerId);
                  if (!connection) {
                    logger.debug(`[WebSocket] No connection found between users ${userId} and ${partnerId}`);
                    throw new Error('Users are not connected');
                  }
                  logger.debug(`[WebSocket] Connection verified between users ${userId} and ${partnerId}:`, connection);
                } catch (connectionError) {
                  logger.error('[WebSocket] Connection check error:', connectionError);
                  throw new Error('Users are not connected', { cause: connectionError });
                }

                // Get or create the conversation
                const conversation = await storage.getOrCreateConversation(userId!, partnerId);
                if (!conversation) {
                  throw new Error('Failed to get or create conversation');
                }
                
                // Get messages - include conversation ID in response for client-side reference
                const page = await storage.getMessagesPage(userId!, partnerId, { limit, cursor });
                logger.debug(`[WebSocket] Loaded ${page.items.length} messages for user ${userId} with partner ${partnerId}, conversation ID: ${conversation.id}`);
                ws.send(JSON.stringify({
                  type: 'messagesLoaded',
                  messages: page.items.map(toMessageDto),
                  conversationId: conversation.id,
                  ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
                }));
              } catch (error) {
                if (error instanceof Error && error.message === 'Users are not connected') {
                  handleError(ws, 'Users must be connected to chat', error);
                } else {
                  handleError(ws, 'Failed to load messages', error);
                }
              }
              break;

            case 'chat':
              try {
                const { receiverId, content } = validatedMessage;
                if (!receiverId) {
                  throw new Error('Invalid receiver ID');
                }

                if (!content || typeof content !== 'string' || !content.trim()) {
                  throw new Error('Invalid message content');
                }

                // Check if users are connected first
                try {
                  const connection = await storage.getConnectionBetweenUsers(userId!, receiverId);
                  if (!connection) {
                    logger.debug(`[WebSocket] No connection found between users ${userId} and ${receiverId}`);
                    throw new Error('Users must be connected to exchange messages');
                  }
                  logger.debug(`[WebSocket] Connection verified between users ${userId} and ${receiverId}:`, connection);
                } catch (connectionError) {
                  logger.error('[WebSocket] Connection check error:', connectionError);
                  throw new Error('Users must be connected to exchange messages', { cause: connectionError });
                }

                // Create and save the message
                const savedMessage = await storage.createMessage({
                  senderId: userId!,
                  receiverId,
                  content: content.trim()
                });

                // Send to recipient if online
                const recipientClient = connectedClients.get(receiverId);
                if (recipientClient?.ws.readyState === WebSocket.OPEN) {
                  logger.debug(`[WebSocket] Sending message to online recipient ${receiverId}`);
                  recipientClient.ws.send(JSON.stringify({
                    type: 'chat',
                    message: toSafeMessage(savedMessage)
                  }));
                } else {
                  logger.debug(`[WebSocket] Recipient ${receiverId} is offline, message stored only`);
                }

                // Confirm to sender
                ws.send(JSON.stringify({
                  type: 'messageConfirm',
                  messageId: savedMessage.id,
                  message: toSafeMessage(savedMessage)
                }));
              } catch (error) {
                if (error instanceof Error && error.message === 'Users must be connected to exchange messages') {
                  handleError(ws, 'Users must be connected to chat', error);
                } else if (error instanceof Error && error.message.includes('Users are not connected')) {
                  handleError(ws, 'Users must be connected to chat', error);
                } else {
                  handleError(ws, 'Failed to send message', error);
                }
              }
              break;
              
            case 'test':
              try {
                logger.debug(`[WebSocket] Received test message from user ${userId}`);
                // Echo the test message back to the sender with timestamp
                ws.send(JSON.stringify({
                  type: 'test-response',
                  content: validatedMessage.content,
                  timestamp: new Date().toISOString(),
                  originalTimestamp: validatedMessage.timestamp,
                  status: 'success'
                }));
              } catch (error) {
                handleError(ws, 'Failed to process test message', error);
              }
              break;
              
            case 'connectionRejected':
              try {
                const { requestId, receiverId } = validatedMessage;
                if (!requestId || !receiverId) {
                  throw new Error('Invalid connection request data');
                }
                
                const request = await storage.getConnectionRequestById(requestId);
                if (!request || request.status !== 'requested' ||
                    request.receiverId !== userId || request.senderId !== receiverId) {
                  throw new Error('Invalid connection request data');
                }
                const rejected = await storage.rejectConnectionRequest(requestId, userId);
                if (!rejected) throw new Error('Invalid connection request data');
                const { notifyConnectionRequestRejected } = await import('./websocket-utils');
                await notifyConnectionRequestRejected(request.senderId, request.id, request.receiverId);
                
                // Notification was already sent to the database-derived requester.

                // Confirm to the user who rejected the request
                ws.send(JSON.stringify({
                  type: 'connectionRejectionSent',
                  requestId: requestId,
                  success: true
                }));
              } catch (error) {
                handleError(ws, 'Failed to process connection rejection', error);
              }
              break;

            default:
              throw new Error('Unknown message type');
          }
        } catch (error) {
          handleError(ws, 'Message processing failed', error);
        }
      });

      // Handle disconnection
      ws.on('close', (code: number, reason: string) => {
        logger.debug(`[WebSocket] User ${userId} disconnected. Code: ${code}, Reason: ${reason}`);
        clearInterval(pingInterval);

        if (userId) {
          const client = connectedClients.get(userId);
          if (client) {
            if (client.pingTimeout) {
              clearTimeout(client.pingTimeout);
              client.pingTimeout = undefined;
            }
            client.pingSentAt = null;
            // Only remove client if this is the current WebSocket instance
            if (client.ws === ws) {
              // For clean disconnections (code 1000) or if max attempts reached, remove client
              if (code === 1000 || client.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
                logger.debug(`[WebSocket] Removing user ${userId} from connected clients (clean: ${code === 1000}, maxAttempts: ${client.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS})`);
                connectedClients.delete(userId);
              } else {
                logger.debug(`[WebSocket] Keeping user ${userId} in connected clients for potential reconnection (attempt ${client.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
              }
            } else {
              logger.debug(`[WebSocket] WebSocket instance mismatch for user ${userId}, not removing from connected clients`);
            }
          }
        }
      });

      // Handle pong responses
      ws.on('pong', (payload) => {
        const client = connectedClients.get(userId!);
        if (client?.ws === ws && client.pingSentAt !== null) {
          const expectedPayload = String(client.pingSentAt);
          if (payload.toString() !== expectedPayload) {
            return;
          }
          if (client.pingTimeout) {
            clearTimeout(client.pingTimeout);
            client.pingTimeout = undefined;
          }
          client.lastPong = Date.now();
          client.pingSentAt = null;
        }
      });

    } catch (error) {
      logger.error('[WebSocket] Setup error:', error);
      handleError(ws, 'Connection failed', error);
      ws.close(1008, 'Connection failed');
    }
  });

  // Global error handler
  wss.on('error', (error) => {
    logger.error('[WebSocket] Server error:', error);
  });

  // Cleanup on server shutdown
  return (): Promise<void> => new Promise((resolve, reject) => {
    clearInterval(cleanupInterval);
    for (const client of connectedClients.values()) {
      try {
        if (client.pingTimeout) clearTimeout(client.pingTimeout);
        client.ws.close(1000, 'Server shutting down');
      } catch (error) {
        logger.error('[WebSocket] Error during shutdown cleanup:', error);
      }
    }
    connectedClients.clear();
    wss.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

// Helper function for consistent error handling
function handleError(ws: WebSocket, message: string, error: unknown) {
  logger.error(`[WebSocket] ${message}:`, error);

  if (ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify({
        type: 'error',
        message,
        details: 'Request could not be completed'
      }));
    } catch (sendError) {
      logger.error('[WebSocket] Failed to send error message:', sendError);
    }
  }
}

function toSafeMessage(message: {
  id: number;
  conversationId: number;
  senderId: number;
  receiverId: number;
  content: string;
  createdAt: string;
  sender: { id: number; fullName: string; photo: string };
  receiver: { id: number; fullName: string; photo: string };
}) {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    receiverId: message.receiverId,
    content: message.content,
    createdAt: message.createdAt,
    sender: {
      id: message.sender.id,
      fullName: message.sender.fullName,
      photo: message.sender.photo,
    },
    receiver: {
      id: message.receiver.id,
      fullName: message.receiver.fullName,
      photo: message.receiver.photo,
    },
  };
}