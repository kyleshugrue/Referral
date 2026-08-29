import { z } from 'zod';
import { MAX_WEBSOCKET_CHAT_CONTENT_LENGTH } from './websocket-security';

/**
 * Messages accepted by the WebSocket handler.
 *
 * This schema intentionally lives outside the server wiring so validation
 * tests can load it without initializing storage, sessions, or a database.
 */
export const messageSchema = z.object({
  type: z.enum([
    'authenticate',
    'chat',
    'loadMessages',
    'test',
    'connectionRejected',
    'newMatch',
    'matchRefresh',
    'matchesUpdated',
  ]),
  content: z.string().max(MAX_WEBSOCKET_CHAT_CONTENT_LENGTH).optional(),
  receiverId: z.number().optional(),
  partnerId: z.number().optional(),
  requestId: z.number().optional(),
  timestamp: z.string().optional(),
  matchData: z
    .object({
      profileId: z.number(),
      name: z.string(),
      title: z.string().optional(),
      company: z.string().optional(),
      lastActive: z.string().optional(),
      image: z.string().optional(),
      matchDescription: z.string().optional(),
    })
    .optional(),
});