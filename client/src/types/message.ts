import { Message as BaseMessage } from '@shared/schema';

// Extended message type with client-side properties
export interface ExtendedMessage extends BaseMessage {
  status?: 'sending' | 'sent' | 'delivered' | 'failed';
  isTemporary?: boolean;
}