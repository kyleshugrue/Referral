import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/hooks/use-auth";
import ErrorMessage from "@/components/error-message";
import { getInitials } from "@/lib/avatar-utils";
import { ExtendedMessage } from "@/types/message";
import { useToast } from "@/hooks/use-toast";

interface Props {
  conversationId: number;
  recipientId: number;
  otherUser?: {
    id: number;
    fullName?: string;
    photo?: string;
  };
  onProfileClick?: () => void;
  isIOSNative?: boolean;
}

// Function to group messages by date
const groupMessagesByDate = (messages: ExtendedMessage[]): { date: string, messages: ExtendedMessage[] }[] => {
  if (!Array.isArray(messages) || messages.length === 0) {
    return [];
  }
  
  const groups: Record<string, ExtendedMessage[]> = {};
  
  messages.forEach(message => {
    // Safe date parsing
    try {
      const date = new Date(message.createdAt).toLocaleDateString();
      if (!groups[date]) {
        groups[date] = [];
      }
      groups[date].push(message);
    } catch (e) {
      console.error('Error parsing date for message:', message, e);
    }
  });
  
  return Object.entries(groups).map(([date, messages]) => ({
    date,
    messages
  }));
};

export function MessageList({ conversationId, recipientId, otherUser, onProfileClick, isIOSNative = false }: Props) {
  console.log('[MessageList] Rendering with conversationId:', conversationId, 'recipientId:', recipientId);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { user: currentUser } = useAuth();
  const [hasError, setHasError] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  // Function to handle retrying failed messages
  const handleRetryMessage = async (failedMessage: ExtendedMessage) => {
    console.log('[MessageList] Retrying failed message:', failedMessage);
    
    // Mark the message as sending while we retry
    const currentMessages = queryClient.getQueryData<ExtendedMessage[]>(["/api/messages", recipientId]);
    if (currentMessages) {
      const updatedMessages = currentMessages.map(msg => {
        if (msg.id === failedMessage.id) {
          return { ...msg, status: 'sending' as const };
        }
        return msg;
      });
      
      queryClient.setQueryData(["/api/messages", recipientId], updatedMessages);
    }
    
    try {
      // Make API call to retry sending the message
      const response = await fetch('/api/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: failedMessage.content,
          receiverId: recipientId,
        }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to send message');
      }
      
      // Request was successful, update the messages cache
      // We'll refetch the messages to make sure we have the latest data
      queryClient.invalidateQueries({
        queryKey: ["/api/messages", recipientId],
      });
      
      toast({
        description: "Message sent successfully",
      });
    } catch (error) {
      console.error('[MessageList] Error retrying message:', error);
      
      // Mark the message as failed again
      const currentMessages = queryClient.getQueryData<ExtendedMessage[]>(["/api/messages", recipientId]);
      if (currentMessages) {
        const updatedMessages = currentMessages.map(msg => {
          if (msg.id === failedMessage.id) {
            return { ...msg, status: 'failed' as const };
          }
          return msg;
        });
        
        queryClient.setQueryData(["/api/messages", recipientId], updatedMessages);
      }
      
      toast({
        variant: "destructive",
        title: "Failed to retry",
        description: "Tap the message to try again",
      });
    }
  };
  
  // Fetch messages with error handling
  console.log('[MessageList] Setting up query with key:', ["/api/messages", recipientId]);
  
  const {
    data: messages = [],
    isLoading,
    refetch,
    error
  } = useQuery<ExtendedMessage[]>({
    queryKey: ["/api/messages", recipientId],
    refetchInterval: 3000, // Poll for new messages every 3 seconds as a fallback
    enabled: !!recipientId && !!currentUser?.id,
    retry: 3,
    staleTime: 5000, // Consider data fresh for 5 seconds
    retryOnMount: true, // Always retry when component mounts
    refetchOnWindowFocus: true, // Refetch on window focus
    refetchOnReconnect: true // Refetch on network reconnect
  });
  
  // Enhanced debugging
  useEffect(() => {
    console.log(`[MessageList] Messages data updated. Count: ${messages?.length || 0}`);
    if (messages?.length > 0) {
      console.log('[MessageList] First message:', {
        id: messages[0].id,
        senderId: messages[0].senderId,
        content: messages[0].content?.substring(0, 30) + (messages[0].content?.length > 30 ? '...' : '')
      });
      
      const lastMsg = messages[messages.length - 1];
      console.log('[MessageList] Last message:', {
        id: lastMsg.id,
        senderId: lastMsg.senderId,
        content: lastMsg.content?.substring(0, 30) + (lastMsg.content?.length > 30 ? '...' : '')
      });
    }
  }, [messages]);
  
  // Handle errors
  useEffect(() => {
    if (error) {
      console.error('[MessageList] Error fetching messages:', error);
      setHasError(true);
    } else {
      setHasError(false);
    }
  }, [error]);
  
  // Calculate if we have few messages (to control container sizing)
  // This is now dynamic based on message count and message size
  const messagesRef = useRef<HTMLDivElement>(null);
  const [, setContainerHeight] = useState<number | null>(null);
  const [needsScrolling, setNeedsScrolling] = useState(false);
  
  // Calculate the natural height of the messages to determine if we need scrolling
  useEffect(() => {
    if (containerRef.current && messagesRef.current) {
      // For single messages or empty state, never scroll
      if (messages?.length <= 1) {
        setNeedsScrolling(false);
        setContainerHeight(null);
        return;
      }
      
      // Get the natural height of the message content
      const contentHeight = messagesRef.current.scrollHeight;
      
      // Get header height (avatar and name)
      const headerHeight = 80;
      
      // Get input area height (message input and bottom nav)
      const inputAreaHeight = 140;
      
      // Calculate safe area insets (approximate)
      const topInset = 20;
      const bottomInset = 34;
      
      // Calculate total non-content height
      const nonContentHeight = headerHeight + inputAreaHeight + topInset + bottomInset;
      
      // Get the available container height
      const availableHeight = window.innerHeight - nonContentHeight;
      
      // Add some padding to prevent scrolling for content that's just slightly taller
      const scrollThreshold = availableHeight - 10;
      
      // Determine if we need scrolling based on content height vs available height
      // Only enable scrolling if content is significantly larger than available space
      const shouldScroll = contentHeight > scrollThreshold;
      
      setNeedsScrolling(shouldScroll);
      
      // Set container height based on content or available space
      // For slightly tall content, expand to fit rather than enabling scroll
      setContainerHeight(shouldScroll ? availableHeight : contentHeight);
      
      console.log('[MessageList] Messages count:', messages?.length,
                 'Content height:', contentHeight, 
                 'Available height:', availableHeight,
                 'Should scroll:', shouldScroll);
    }
  }, [messages]);
  
  // Scroll to the latest message when messages load or change
  useEffect(() => {
    if (messages?.length > 0 && containerRef.current) {
      const container = containerRef.current;
      
      console.log('[MessageList] Messages count:', messages.length,
                 'Needs scrolling:', needsScrolling);
      
      // Allow a small delay for rendering to complete
      setTimeout(() => {
        if (needsScrolling && messagesEndRef.current) {
          messagesEndRef.current.scrollIntoView({ behavior: 'auto' });
        } else {
          container.scrollTop = 0;
        }
      }, 50);
    }
  }, [messages, needsScrolling]);
  
  // Handle window resize (e.g., orientation changes)
  useEffect(() => {
    const handleResize = () => {
      // Small delay to ensure DOM has updated after resize
      setTimeout(() => {
        if (containerRef.current && messagesRef.current) {
          // For single messages or empty state, never scroll
          if (messages?.length <= 1) {
            setNeedsScrolling(false);
            setContainerHeight(null);
            return;
          }
          
          // Recalculate content height on resize
          const contentHeight = messagesRef.current.scrollHeight;
          
          // Get header height (avatar and name)
          const headerHeight = 80;
          
          // Get input area height (message input and bottom nav)
          const inputAreaHeight = 140;
          
          // Calculate safe area insets (approximate)
          const topInset = 20;
          const bottomInset = 34;
          
          // Calculate total non-content height
          const nonContentHeight = headerHeight + inputAreaHeight + topInset + bottomInset;
          
          // Get the available container height
          const availableHeight = window.innerHeight - nonContentHeight;
          
          // Add some padding to prevent scrolling for content that's just slightly taller
          const scrollThreshold = availableHeight - 10;
          
          // Determine if we need scrolling based on content height vs available height
          const shouldScroll = contentHeight > scrollThreshold;
          
          setNeedsScrolling(shouldScroll);
          
          // Set container height based on content or available space
          setContainerHeight(shouldScroll ? availableHeight : contentHeight);
          
          console.log('[MessageList:resize] Messages count:', messages?.length,
                     'Content height:', contentHeight,
                     'Available height:', availableHeight,
                     'Should scroll:', shouldScroll);
          
          // Scroll appropriately
          if (shouldScroll && messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'auto' });
          } else if (containerRef.current) {
            containerRef.current.scrollTop = 0;
          }
        }
      }, 100);
    };
    
    window.addEventListener('resize', handleResize);
    // Also trigger resize calculation when component mounts or messages change
    handleResize();
    
    return () => window.removeEventListener('resize', handleResize);
  }, [messages]);
  
  // Error retry handler
  const handleRetry = () => {
    console.log('[MessageList] Retrying message fetch');
    setHasError(false);
    refetch();
  };
  
  // Loading state
  if (isLoading) {
    return (
      <div className={`flex justify-center items-center h-full ${isIOSNative ? 'ios-message-loading' : ''}`}>
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }
  
  // Error state
  if (hasError) {
    return <ErrorMessage title="Error loading messages" onRetry={handleRetry} />;
  }
  
  // No messages state
  if (!messages || messages.length === 0) {
    return (
      <div className={`flex flex-col items-center justify-center h-full p-4 ${isIOSNative ? 'ios-message-empty' : ''}`}>
        {otherUser && (
          <>
            <div className="flex flex-col items-center mb-6 mt-12">
              <div 
                className="h-32 w-32 rounded-full overflow-hidden shadow-md cursor-pointer mb-4"
                onClick={() => {
                  if (onProfileClick && otherUser) {
                    onProfileClick();
                  }
                }}
              >
                {otherUser.photo && 
                 !otherUser.photo.includes('placeholder') && 
                 otherUser.photo !== '/placeholder.jpg' ? (
                  <img 
                    src={otherUser.photo} 
                    alt={otherUser.fullName || "User"} 
                    className="h-full w-full object-cover" 
                  />
                ) : (
                  <div className="h-full w-full bg-primary flex items-center justify-center text-white text-lg font-medium">
                    {getInitials(otherUser.fullName) || "U"}
                  </div>
                )}
              </div>
            </div>
            
            <div className="text-center mb-8">
              <p className="text-gray-700 font-medium text-lg">
                You connected with{" "}
                <span 
                  className="text-gray-900 font-semibold cursor-pointer hover:underline"
                  onClick={() => {
                    if (onProfileClick && otherUser) {
                      onProfileClick();
                    }
                  }}
                >
                  {otherUser.fullName}
                </span>
              </p>
              <p className="text-gray-500 text-sm mt-1">
                {new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', { 
                  month: 'long', 
                  day: 'numeric'
                })}
              </p>
            </div>
          </>
        )}
        {!otherUser && (
          <>
            <p className="text-gray-800 font-medium text-lg mb-2">
              Start a new conversation
            </p>
            <p className="text-gray-500 text-center">
              Send a message to begin chatting!
            </p>
          </>
        )}
      </div>
    );
  }
  
  // Process messages for display
  const groupedMessages = groupMessagesByDate(messages);
  const today = new Date().toLocaleDateString();
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString();
  
  // Format date for display
  const formatDate = (dateString: string) => {
    if (dateString === today) return "Today";
    if (dateString === yesterday) return "Yesterday";
    return new Date(dateString).toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric'
    });
  };
  
  // Format time for messages
  const formatMessageTime = (dateString: string) => {
    try {
      return format(new Date(dateString), 'h:mm a');
    } catch (e) {
      console.error('Error formatting time:', dateString, e);
      return ''; // Fallback for invalid dates
    }
  };
  
  // Calculate container classes and styles based on message count and iOS native mode
  const containerClasses = `w-full px-4 pt-4 pb-0 space-y-1${isIOSNative ? ' ios-message-list' : ''}`;
  
  // Conditionally apply styles - iOS native mode lets parent handle scrolling
  const containerStyle = isIOSNative 
    ? {
        height: 'auto',
        flex: 'none' as const,
        overflowY: 'visible' as const,
        display: 'flex',
        flexDirection: 'column' as const,
        alignItems: 'stretch' as const,
        paddingBottom: '2px'
      }
    : { 
        height: '100%',
        flex: 1,
        overflowY: 'auto' as const,
        display: 'flex',
        flexDirection: 'column' as const,
        alignItems: 'stretch' as const,
        paddingBottom: '2px'
      };
  
  return (
    <div 
      ref={containerRef} 
      className={containerClasses}
      style={containerStyle}
    >
      <div 
        ref={messagesRef} 
        className={messages?.length <= 1 ? "flex flex-col justify-start" : ""}
        style={{
          // For single messages, ensure we don't have extra space below the message
          height: messages?.length <= 1 ? 'auto' : undefined,
          marginBottom: messages?.length <= 1 ? '0' : undefined,
          paddingBottom: '5px' // Consistent padding at the bottom for all message groups
        }}
      >
        {groupedMessages.map(({ date, messages }) => (
          <div key={date} className="space-y-0.5">
            <div className="flex justify-center mt-0.5 mb-1">
              <span className="text-xs text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
                {formatDate(date)}
              </span>
            </div>
            
            {messages.map((message, index) => {
              if (!message || !message.senderId) {
                console.error('Invalid message data:', message);
                return null;
              }
              
              // isSender is true if the current user is the sender
              const isSender = message.senderId === currentUser?.id;
              const isPreviousSameSender = index > 0 && messages[index - 1]?.senderId === message.senderId;
              const isNextSameSender = index < messages.length - 1 && messages[index + 1]?.senderId === message.senderId;
              const isLastInChain = !isNextSameSender;
              
              // Get timestamp for the message
              const timestamp = formatMessageTime(message.createdAt);
              
              return (
                <div key={message.id || index} className="mb-0.5">
                  <div
                    className={`flex items-start gap-1 ${
                      isSender ? "justify-end" : "justify-start"
                    }`}
                  >
                    {/* Profile picture placeholder - shows actual image for the last message in a chain from other user */}
                    {!isSender && (
                      <div className="flex flex-col items-center">
                        <div 
                          className={`h-8 w-8 rounded-full overflow-hidden flex-shrink-0 mr-1 ${!isLastInChain ? 'invisible' : ''} ${isLastInChain ? 'cursor-pointer' : ''}`}
                          onClick={() => {
                            if (isLastInChain && onProfileClick && otherUser) {
                              onProfileClick();
                            }
                          }}
                        >
                          {isLastInChain && otherUser ? (
                            otherUser.photo && 
                            !otherUser.photo.includes('placeholder') && 
                            otherUser.photo !== '/placeholder.jpg' ? (
                              <img 
                                src={otherUser.photo} 
                                alt={otherUser.fullName || "User"} 
                                className="h-full w-full object-cover" 
                              />
                            ) : (
                              <div className="h-full w-full bg-primary flex items-center justify-center text-white text-sm font-medium">
                                {getInitials(otherUser.fullName) || "U"}
                              </div>
                            )
                          ) : null}
                        </div>
                        {isLastInChain && otherUser && otherUser.fullName && (
                          <span 
                            className="text-xs text-gray-500 text-center mt-1 whitespace-nowrap cursor-pointer hover:text-gray-600"
                            style={{ maxWidth: '64px', overflow: 'hidden', textOverflow: 'ellipsis' }}
                            onClick={() => {
                              if (onProfileClick && otherUser) {
                                onProfileClick();
                              }
                            }}
                          >
                            {otherUser.fullName.split(' ')[0]}
                          </span>
                        )}
                      </div>
                    )}
                    
                    {/* Message bubble */}
                    <div
                      className={`px-3 py-2 ${
                        isSender 
                          ? "bg-primary text-white rounded-2xl rounded-tr-sm max-w-[80%] ml-auto" 
                          : "bg-gray-100 text-gray-800 rounded-2xl rounded-tl-sm max-w-[80%]"
                      } ${!isPreviousSameSender ? 'mt-1' : 'mt-0.5'} ${!isNextSameSender ? 'mb-0.5' : 'mb-0.5'} 
                        ${message.status === 'failed' ? 'cursor-pointer opacity-70' : ''}
                        ${message.status === 'sending' ? 'opacity-70' : ''}`}
                      style={{ 
                        wordBreak: 'break-word',
                        hyphens: 'auto'
                      }}
                      onClick={() => {
                        if (message.status === 'failed' && isSender) {
                          handleRetryMessage(message);
                        }
                      }}
                    >
                      <div className="flex justify-between items-start gap-2">
                        <p className="break-words text-sm leading-5 whitespace-pre-wrap">
                          {message.content}
                        </p>
                        {/* No loading indicator during sending as per requirement */}
                        {message.status === 'failed' && (
                          <div className="flex-shrink-0 ml-1" title="Tap to retry">
                            <AlertCircle className="h-3 w-3 text-red-300" />
                          </div>
                        )}
                        {/* Removed delivery checkmark as per requirement */}
                      </div>
                    </div>
                  </div>
                  
                  {/* Timestamp below the message, only for the last message in a chain */}
                  {!isNextSameSender && (
                    <div className={`flex ${isSender ? "justify-end" : "justify-start"} px-1 mb-1`}>
                      <span className="text-[10px] text-gray-500 mt-0.5 flex items-center">
                        <span>{timestamp}</span>
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
        <div ref={messagesEndRef} /> {/* Anchor point for scrolling to latest message (no height) */}
      </div>
    </div>
  );
}

