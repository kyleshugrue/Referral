import { useQuery } from "@tanstack/react-query";
import type { User, Message, Conversation } from "@shared/schema";
import { MessageList } from "./message-list";

interface EmptyOrMessageListProps {
  conversation: Conversation | undefined;
  recipientId: number;
  user: User;
}

export default function EmptyOrMessageList({ 
  conversation, 
  recipientId,
  user 
}: EmptyOrMessageListProps) {
  // Fetch messages from the API
  const { 
    data: messages = [], 
    isLoading
  } = useQuery({
    queryKey: ["/api/messages", recipientId],
    enabled: !!recipientId
  }) as {
    data: Message[],
    isLoading: boolean
  };

  // Debug message loading
  console.log('[EmptyOrMessageList] Messages:', messages?.length, messages);
  console.log('[EmptyOrMessageList] Conversation:', conversation);
  console.log('[EmptyOrMessageList] Will show MessageList?', messages?.length > 0 && !!conversation);
  
  // If there are messages, render the MessageList component
  if (messages?.length > 0 && conversation) {
    console.log('[EmptyOrMessageList] Rendering MessageList with conversation ID:', conversation.id);
    return (
      <MessageList 
        conversationId={conversation.id as number}
        recipientId={recipientId}
        otherUser={user}
      />
    );
  }

  // If there are no messages, render the empty state as in the screenshot
  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-full">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-full p-4">
      {/* Message icon */}
      <div className="text-gray-300 mb-6">
        <svg width="50" height="50" viewBox="0 0 50 50" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M40 5H10C7.25 5 5 7.25 5 10V35C5 37.75 7.25 40 10 40H35L45 50V10C45 7.25 42.75 5 40 5Z" stroke="currentColor" strokeWidth="3" fill="none" />
        </svg>
      </div>
      
      {/* No messages text */}
      <p className="text-gray-800 font-medium text-lg mb-2">
        No messages yet
      </p>
      
      {/* Start conversation text */}
      <p className="text-gray-500 text-center">
        Start a conversation with {user?.fullName || 'Test8'}!
      </p>
    </div>
  );
}