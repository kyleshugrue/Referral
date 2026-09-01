import { z } from 'zod';
import { MAX_WEBSOCKET_CHAT_CONTENT_LENGTH } from './websocket-security';

/**
 * Messages accepted by the WebSocket handler.
 *
 * This schema intentionally lives outside the server wiring so validation
 * tests can load it without initializing storage, sessions, or a database.
 */
const positiveId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const timestamp = z.union([
  z.string().datetime({ offset: true }).max(64),
  z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
]);

export const messageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('authenticate') }).strict(),
  z.object({
    type: z.literal('chat'),
    receiverId: positiveId,
    content: z.string().trim().min(1).max(MAX_WEBSOCKET_CHAT_CONTENT_LENGTH),
  }).strict(),
  z.object({
    type: z.literal('loadMessages'),
    partnerId: positiveId,
  }).strict(),
  z.object({
    type: z.literal('test'),
    content: z.string().max(MAX_WEBSOCKET_CHAT_CONTENT_LENGTH).optional(),
    timestamp: timestamp.optional(),
  }).strict(),
  z.object({
    type: z.literal('connectionRejected'),
    requestId: positiveId,
    receiverId: positiveId,
  }).strict(),
]);