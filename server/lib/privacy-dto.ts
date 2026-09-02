import type {
  Connection,
  ConnectionRequest,
  Conversation,
  Message,
  Notification,
  SynergyMatch,
  User,
} from "@shared/schema";

export type PublicProfileDto = {
  id: number;
  fullName: string;
  title: string | null;
  currentLocation: string | null;
  industry: string | null;
  currentCompany: string | null;
  desiredLocations: string[];
  desiredCompanies: string[];
  yearsOfExperience: number;
  bio: string | null;
  photo: string;
  interests: string[];
  professionalInterests: string[];
  languages: string[];
  educationLevel: string | null;
  institution: string | null;
};

export type AuthorizedPeerProfileDto = PublicProfileDto & {
  resumeUrl: string | null;
  resumePreviewUrls: string[];
};

export type SelfUserDto = PublicProfileDto & {
  email: string;
  birthday: string | null;
  matchingRadius: number;
  resumeUrl: string | null;
  resumePreviewUrls: string[];
  profileVisible: boolean;
  emailNotifications: boolean;
  readReceipts: boolean;
  emailVerificationStarted: boolean;
  emailVerified: boolean;
  registrationCompleted: boolean;
  hasMinimumMatchData: boolean;
};

export type MiniProfileDto = Pick<PublicProfileDto, "id" | "fullName" | "photo">;

export type ConnectionDto = Pick<Connection, "id" | "user1Id" | "user2Id" | "createdAt"> & {
  otherUser: PublicProfileDto;
  isNew?: boolean;
};

export type ConnectionRequestDto = Pick<
  ConnectionRequest,
  "id" | "senderId" | "receiverId" | "status" | "createdAt"
> & {
  sender?: PublicProfileDto;
  receiver?: PublicProfileDto;
  matchDescription?: string;
};

export type MessageDto = Pick<
  Message,
  "id" | "conversationId" | "senderId" | "receiverId" | "content" | "createdAt"
> & {
  sender: MiniProfileDto;
  receiver: MiniProfileDto;
};

export type MessageSummaryDto = Pick<
  Message,
  "id" | "conversationId" | "senderId" | "receiverId" | "content" | "createdAt"
>;

export type ConversationDto = Pick<
  Conversation,
  "id" | "user1Id" | "user2Id" | "isGroup" | "createdAt" | "lastMessageAt"
> & {
  otherUser?: PublicProfileDto;
  lastMessage?: Pick<MessageDto, "id" | "senderId" | "receiverId" | "content" | "createdAt">;
  hasUnreadMessages?: boolean;
};

export type MatchDto = PublicProfileDto & {
  matchDescription?: string | null;
  matchScore?: number | null;
  matchReasons?: string[];
};

export type NotificationDto = Pick<Notification, "id" | "type" | "read" | "createdAt"> & {
  messageId?: number;
  connectionRequestId?: number;
  connectionId?: number;
};

export function toPublicProfileDto(user: User): PublicProfileDto {
  return {
    id: user.id,
    fullName: user.fullName,
    title: user.title,
    currentLocation: user.currentLocation,
    industry: user.industry,
    currentCompany: user.currentCompany,
    desiredLocations: user.desiredLocations ?? [],
    desiredCompanies: user.desiredCompanies ?? [],
    yearsOfExperience: user.yearsOfExperience,
    bio: user.bio,
    photo: user.photo,
    interests: user.interests ?? [],
    professionalInterests: user.professionalInterests ?? [],
    languages: user.languages ?? [],
    educationLevel: user.educationLevel,
    institution: user.institution,
  };
}

/**
 * Resume references are private media capabilities, not public profile data.
 * Routes must call this only after verifying that the viewer owns the profile
 * or has an accepted connection to an otherwise eligible peer.
 */
export function toAuthorizedPeerProfileDto(user: User): AuthorizedPeerProfileDto {
  return {
    ...toPublicProfileDto(user),
    resumeUrl: user.resumeUrl,
    resumePreviewUrls: user.resumePreviewUrls ?? [],
  };
}

export function toSelfUserDto(user: User): SelfUserDto {
  return {
    ...toPublicProfileDto(user),
    email: user.email,
    birthday: user.birthday,
    matchingRadius: user.matchingRadius,
    resumeUrl: user.resumeUrl,
    resumePreviewUrls: user.resumePreviewUrls ?? [],
    profileVisible: user.profileVisible,
    emailNotifications: user.emailNotifications,
    readReceipts: user.readReceipts,
    emailVerificationStarted: user.emailVerificationStarted,
    emailVerified: user.emailVerified,
    registrationCompleted: user.registrationCompleted,
    hasMinimumMatchData: user.hasMinimumMatchData,
  };
}

export function toMiniProfileDto(user: User): MiniProfileDto {
  return {
    id: user.id,
    fullName: user.fullName,
    photo: user.photo,
  };
}

export function toConnectionDto(
  connection: Connection & { otherUser: User; isNew?: boolean },
): ConnectionDto {
  return {
    id: connection.id,
    user1Id: connection.user1Id,
    user2Id: connection.user2Id,
    createdAt: connection.createdAt,
    otherUser: toPublicProfileDto(connection.otherUser),
    ...(connection.isNew === undefined ? {} : { isNew: connection.isNew }),
  };
}

export function toConnectionRequestDto(
  request: ConnectionRequest & {
    sender?: User;
    receiver?: User;
    matchDescription?: string;
  },
): ConnectionRequestDto {
  return {
    id: request.id,
    senderId: request.senderId,
    receiverId: request.receiverId,
    status: request.status,
    createdAt: request.createdAt,
    ...(request.sender ? { sender: toPublicProfileDto(request.sender) } : {}),
    ...(request.receiver ? { receiver: toPublicProfileDto(request.receiver) } : {}),
    ...(request.matchDescription ? { matchDescription: request.matchDescription } : {}),
  };
}

export function toMessageDto(
  message: Message & { sender: User; receiver: User },
): MessageDto {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    receiverId: message.receiverId,
    content: message.content,
    createdAt: message.createdAt,
    sender: toMiniProfileDto(message.sender),
    receiver: toMiniProfileDto(message.receiver),
  };
}

export function toMessageSummaryDto(message: Message): MessageSummaryDto {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    receiverId: message.receiverId,
    content: message.content,
    createdAt: message.createdAt,
  };
}

export function toConversationDto(
  conversation: Conversation & {
    otherUser?: User;
    lastMessage?: Message | (Message & { sender: User; receiver: User });
    hasUnreadMessages?: boolean;
  },
): ConversationDto {
  const lastMessage = conversation.lastMessage;
  return {
    id: conversation.id,
    user1Id: conversation.user1Id,
    user2Id: conversation.user2Id,
    isGroup: conversation.isGroup,
    createdAt: conversation.createdAt,
    lastMessageAt: conversation.lastMessageAt,
    ...(conversation.otherUser ? { otherUser: toPublicProfileDto(conversation.otherUser) } : {}),
    ...(lastMessage
      ? {
          lastMessage: {
            id: lastMessage.id,
            senderId: lastMessage.senderId,
            receiverId: lastMessage.receiverId,
            content: lastMessage.content,
            createdAt: lastMessage.createdAt,
          },
        }
      : {}),
    ...(conversation.hasUnreadMessages === undefined
      ? {}
      : { hasUnreadMessages: conversation.hasUnreadMessages }),
  };
}

export function toMatchDto(
  match: (User & {
    matchDescription?: string | null;
    matchScore?: number | null;
    matchReasons?: string[];
  }) | (SynergyMatch & { matchedUser: User }),
): MatchDto {
  const user = "matchedUser" in match ? match.matchedUser : match;
  const description = "matchedUser" in match ? match.description : match.matchDescription;
  const score = "matchedUser" in match ? match.score : match.matchScore;
  const reasons = match.matchReasons;
  return {
    ...toPublicProfileDto(user),
    ...(description === undefined ? {} : { matchDescription: description }),
    ...(score === undefined ? {} : { matchScore: score }),
    ...(reasons == null ? {} : { matchReasons: reasons }),
  };
}

export function toNotificationDto(notification: Notification): NotificationDto {
  const dto: NotificationDto = {
    id: notification.id,
    type: notification.type,
    read: notification.read,
    createdAt: notification.createdAt,
  };
  if (notification.type === "message") dto.messageId = notification.relatedId;
  if (notification.type === "connection_request") dto.connectionRequestId = notification.relatedId;
  if (notification.type === "new_connection") dto.connectionId = notification.relatedId;
  return dto;
}