import { WebSocket } from 'ws';
import { logger } from './lib/logger';

// We need to access the connected clients map
interface ConnectedClient {
  ws: WebSocket;
  userId: number;
  lastPing: number;
  reconnectAttempts: number;
}

// We'll need to reference external resources, so import from a getter function
let connectedClientsRef: Map<number, ConnectedClient> | null = null;

// Function to set the reference to connected clients
export function setConnectedClientsRef(clientsMap: Map<number, ConnectedClient>) {
  connectedClientsRef = clientsMap;
}

/**
 * Get the number of currently connected clients
 * Used for health checks and monitoring
 */
export function getConnectedClientCount(): number {
  if (!connectedClientsRef) {
    return 0;
  }
  return connectedClientsRef.size;
}

/**
 * Send a connection request notification to a user
 * @param userId The ID of the user who should receive the notification
 * @param senderId The ID of the user who sent the connection request
 * @param requestId The ID of the connection request
 * @returns Promise that resolves to true if notification was sent, false otherwise
 */
export async function notifyConnectionRequest(userId: number, senderId: number, requestId: number): Promise<boolean> {
  if (!connectedClientsRef) {
    logger.error('[WebSocket Utils] Connected clients reference not set');
    return false;
  }

  const client = connectedClientsRef.get(userId);
  if (!client || client.ws.readyState !== WebSocket.OPEN) {
    logger.debug(`[WebSocket Utils] User ${userId} is not connected or socket not open, cannot notify about new connection request ${requestId}`);
    return false;
  }

  try {
    client.ws.send(JSON.stringify({
      type: 'connectionRequest',
      requestId: requestId,
      senderId: senderId,
      userId: userId,
      timestamp: new Date().toISOString()
    }));
    logger.debug(`[WebSocket Utils] Sent connection request notification to user ${userId} for request ${requestId} from user ${senderId}`);
    return true;
  } catch (error) {
    logger.error(`[WebSocket Utils] Error sending connection request notification to user ${userId}:`, error);
    return false;
  }
}

/**
 * Send a connection request accepted notification to a user
 * @param userId The ID of the user who should receive the notification (original sender)
 * @param requestId The ID of the connection request that was accepted
 * @param acceptedById The ID of the user who accepted the request
 * @returns Promise that resolves to true if notification was sent, false otherwise
 */
export async function notifyConnectionAccepted(userId: number, requestId: number, acceptedById: number): Promise<boolean> {
  if (!connectedClientsRef) {
    logger.error('[WebSocket Utils] Connected clients reference not set');
    return false;
  }

  const client = connectedClientsRef.get(userId);
  if (!client || client.ws.readyState !== WebSocket.OPEN) {
    logger.debug(`[WebSocket Utils] User ${userId} is not connected or socket not open, cannot notify about accepted request ${requestId}`);
    return false;
  }

  try {
    client.ws.send(JSON.stringify({
      type: 'connectionAccepted',
      requestId: requestId,
      acceptedById: acceptedById,
      userId: userId,
      timestamp: new Date().toISOString()
    }));
    logger.debug(`[WebSocket Utils] Sent connection accepted notification to user ${userId} for request ${requestId}`);
    return true;
  } catch (error) {
    logger.error(`[WebSocket Utils] Error sending connection accepted notification to user ${userId}:`, error);
    return false;
  }
}

export async function notifyConnectionRequestRejected(userId: number, requestId: number, rejectedById: number): Promise<boolean> {
  if (!connectedClientsRef) {
    logger.error('[WebSocket Utils] Connected clients reference not set');
    return false;
  }

  const client = connectedClientsRef.get(userId);
  if (!client || client.ws.readyState !== WebSocket.OPEN) {
    logger.debug(`[WebSocket Utils] User ${userId} is not connected or socket not open, cannot notify about rejected request ${requestId}`);
    return false;
  }

  try {
    client.ws.send(JSON.stringify({
      type: 'connectionRejected',
      requestId: requestId,
      senderId: userId,           // The user who sent the original request (receiving this notification)
      rejectedById: rejectedById, // The user who rejected the request (remove from sender's cache)
      receivedRejection: true     // Flag to indicate this was received by the sender
    }));
    logger.debug(`[WebSocket Utils] Sent connection rejection notification to user ${userId} for request ${requestId}, rejected by user ${rejectedById}`);
    return true;
  } catch (error) {
    logger.error(`[WebSocket Utils] Error sending rejection notification to user ${userId}:`, error);
    return false;
  }
}

// Match event interfaces
interface MatchEventData {
  profileId: number;
  name: string;
  title?: string;
  company?: string;
  lastActive?: string;
  image?: string;
  matchDescription?: string;
}

interface MatchEvent {
  type: 'newMatch' | 'matchRefresh' | 'matchesUpdated';
  timestamp: string;
  matchData?: MatchEventData;
  sourceUserId?: number;
  profileVersion?: number;
  affectedCount?: number;
  message?: string;
}

/**
 * Broadcast a new match event to a specific user
 * @param userId The ID of the user to notify about the new match
 * @param matchData The match data to send
 * @returns Promise that resolves to true if notification was sent, false otherwise
 */
export async function broadcastNewMatch(userId: number, matchData: MatchEventData): Promise<boolean> {
  if (!connectedClientsRef) {
    logger.error('[WebSocket Utils] Connected clients reference not set');
    return false;
  }

  const client = connectedClientsRef.get(userId);
  if (!client || client.ws.readyState !== WebSocket.OPEN) {
    logger.debug(`[WebSocket Utils] User ${userId} is not connected or socket not open, cannot send new match notification`);
    return false;
  }

  try {
    const event: MatchEvent = {
      type: 'newMatch',
      timestamp: new Date().toISOString(),
      matchData
    };

    client.ws.send(JSON.stringify(event));
    logger.debug(`[WebSocket Utils] Sent new match notification to user ${userId} for match ${matchData.profileId}`);
    return true;
  } catch (error) {
    logger.error(`[WebSocket Utils] Error sending new match notification to user ${userId}:`, error);
    return false;
  }
}

/**
 * Broadcast a match refresh event to a specific user (when matches need to be reloaded)
 * @param userId The ID of the user to notify about the match refresh
 * @returns Promise that resolves to true if notification was sent, false otherwise
 */
export async function broadcastMatchRefresh(userId: number): Promise<boolean> {
  if (!connectedClientsRef) {
    logger.error('[WebSocket Utils] Connected clients reference not set');
    return false;
  }

  const client = connectedClientsRef.get(userId);
  if (!client || client.ws.readyState !== WebSocket.OPEN) {
    logger.debug(`[WebSocket Utils] User ${userId} is not connected or socket not open, cannot send match refresh notification`);
    return false;
  }

  try {
    const event: MatchEvent = {
      type: 'matchesUpdated',
      timestamp: new Date().toISOString(),
      message: 'Your matches have been updated'
    };

    client.ws.send(JSON.stringify(event));
    logger.debug(`[WebSocket Utils] Sent match refresh notification to user ${userId}`);
    return true;
  } catch (error) {
    logger.error(`[WebSocket Utils] Error sending match refresh notification to user ${userId}:`, error);
    return false;
  }
}

/**
 * Broadcast match refresh to multiple users
 * @param userIds Array of user IDs to notify
 * @returns Promise that resolves to the number of successful broadcasts
 */
export async function broadcastMatchRefreshToUsers(userIds: number[]): Promise<number> {
  if (!connectedClientsRef) {
    logger.error('[WebSocket Utils] Connected clients reference not set');
    return 0;
  }

  let successCount = 0;
  const promises = userIds.map(async (userId) => {
    const success = await broadcastMatchRefresh(userId);
    if (success) successCount++;
    return success;
  });

  await Promise.allSettled(promises);
  logger.debug(`[WebSocket Utils] Broadcast match refresh to ${successCount}/${userIds.length} users`);
  return successCount;
}

/**
 * Send a generic message to a specific user's WebSocket connection
 * @param userId The ID of the user to send the message to
 * @param message The message object to send (will be JSON stringified)
 * @returns Promise that resolves to true if message was sent, false otherwise
 */
export async function sendToUser(userId: number, message: unknown): Promise<boolean> {
  if (!connectedClientsRef) {
    logger.error('[WebSocket Utils] Connected clients reference not set');
    return false;
  }

  const client = connectedClientsRef.get(userId);
  if (!client || client.ws.readyState !== WebSocket.OPEN) {
    logger.debug(`[WebSocket Utils] User ${userId} is not connected or socket not open`);
    return false;
  }

  try {
    client.ws.send(JSON.stringify(message));
    logger.debug(`[WebSocket Utils] Sent message to user ${userId}`);
    return true;
  } catch (error) {
    logger.error(`[WebSocket Utils] Error sending message to user ${userId}:`, error);
    return false;
  }
}