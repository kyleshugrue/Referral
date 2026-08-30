import { useState, useEffect, useRef } from "react";
import { MessageSquare, MessageCircle, Loader2, Search, ArrowLeft, SendHorizontal, Plus, X } from "lucide-react";
import { type User, type Message } from "@shared/schema";
import { useLocation } from "wouter";
import ProfileDialog from "@/components/profile-dialog";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import ConnectionsCarousel from "@/components/connections-carousel";
import { Input } from "@/components/ui/input";
import { getInitials } from "@/lib/avatar-utils";
import { UserAvatar } from "@/components/user-avatar";
import { useDeviceType } from "@/hooks/use-device-type";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { MessageList } from "@/components/message-list";
import { useToast } from "@/hooks/use-toast";
import { ExtendedMessage } from "@/types/message";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useGlobalWebSocket, CONNECTION_STATES } from "@/hooks/use-global-websocket";

// Define the type for connection data
interface Connection {
  otherUser: User;
  id: number;
  createdAt: string;
  isNew?: boolean; // Flag to indicate a new connection that hasn't been viewed yet
}

// Define the type for conversation data
interface Conversation {
  id: number;
  otherUser: User;
  lastMessage?: Message;
  createdAt: string;
  lastMessageAt?: string;
  hasUnreadMessages?: boolean;
}

// Define a type for conversations that have messages
interface ConversationWithMessage extends Conversation {
  lastMessage: Message; // non-optional
}

// Define WebSocket message type for chat messages
interface WebSocketMessage {
  type: string;
  receiverId?: number;
  content?: string;
  partnerId?: number;
  [key: string]: unknown;
}

const isGroupChatFeatureEnabled = () => false;

export default function ConnectionsPage() {
  // References and state for messaging functionality
  const messageContainerRef = useRef<HTMLDivElement>(null);
  const prevConversationIdRef = useRef<number | null>(null);
  const [newMessage, setNewMessage] = useState("");
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [currentLocation, navigate] = useLocation();
  const [selectedProfile, setSelectedProfile] = useState<User | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isGroupChatOpen, setIsGroupChatOpen] = useState(false);
  const [isCreatingGroupChat, setIsCreatingGroupChat] = useState(false);
  const [groupChatSearchQuery, setGroupChatSearchQuery] = useState<string>("");
  const [selectedGroupMembers, setSelectedGroupMembers] = useState<User[]>([]);
  const deviceType = useDeviceType();

  // Use the global WebSocket hook for real-time updates
  // The global hook automatically handles connection events, new matches, and notifications
  const { sendMessage: sendWebSocketMessage, connectionState, isConnected } = useGlobalWebSocket();

  // Scroll to top on mobile when navigating to this page
  useEffect(() => {
    if (deviceType !== 'desktop' && currentLocation === '/connections') {
      window.scrollTo(0, 0);
    }
  }, [currentLocation, deviceType]);
  
  // Define response type for the group message mutation
  interface GroupMessageResponse {
    conversationId?: number;
    messageId?: number;
    success: boolean;
  }

  // Create a mutation for sending a group message
  const sendGroupMessageMutation = useMutation<
    GroupMessageResponse, 
    Error, 
    { content: string; memberIds: number[] }
  >({
    mutationFn: async ({ content, memberIds }) => {
      console.log("sendGroupMessageMutation called with:", { content, memberIds });
      
      try {
        console.log("Making API request to /api/messages/group");
        const response = await apiRequest(
          "POST",
          "/api/messages/group", 
          {
            content: content,
            memberIds: memberIds
          }
        );
        
        console.log("API response received:", response);
        const data = await response.json();
        console.log("Response data:", data);
        return data as GroupMessageResponse;
      } catch (error) {
        console.error("Error in sendGroupMessageMutation:", error);
        throw error;
      }
    },
    onSuccess: (data) => {
      console.log("Group message sent successfully:", data);
      
      // Invalidate conversations cache to refresh the conversations list
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      
      // Clear the message input
      setNewMessage("");
      
      // Show a success toast
      toast({
        title: "Message sent",
        description: `Group message sent to ${selectedGroupMembers.length} member${selectedGroupMembers.length > 1 ? 's' : ''}`,
      });
      
      // Navigate to the new conversation
      if (data?.conversationId) {
        console.log(`Navigating to chat/${data.conversationId}`);
        navigate(`/chat/${data.conversationId}`);
      } else {
        console.log("No conversationId received, navigating to connections page");
        navigate('/connections');
      }
      
      // Reset group chat state
      setIsCreatingGroupChat(false);
      setSelectedGroupMembers([]);
      setGroupChatSearchQuery("");
    },
    onError: (error: Error) => {
      console.error("Error in message mutation:", error);
      toast({
        variant: "destructive",
        title: "Error sending message",
        description: "Could not send your message. Please try again.",
      });
    },
  });

  // For desktop split view - track active conversation
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [location] = useLocation();

  // Reset active conversation when navigating away from chat
  useEffect(() => {
    if (!location.includes('/chat/')) {
      setActiveConversationId(null);
    }
  }, [location]);
  
  // Helper function to mark notifications as read
  const markNotificationsAsRead = async (type: 'new_connection' | 'message', conversationId?: number, connectionId?: number) => {
    try {
      let endpoint = `/api/notifications/read-all/${type}`;
      
      // If a specific conversationId is provided and this is a message notification,
      // only mark messages from that conversation as read
      if (type === 'message' && conversationId) {
        endpoint = `/api/notifications/read-conversation/${conversationId}`;
      }
      
      // If this is a new_connection notification and a specific connectionId is provided,
      // use the new endpoint to mark only that specific connection notification as read
      if (type === 'new_connection' && connectionId) {
        console.log(`Marking specific new connection as read: ${connectionId}`);
        endpoint = `/api/notifications/read-connection/${connectionId}`;
      }
      
      // Call the API to mark notifications as read
      await fetch(endpoint, {
        method: 'PATCH',
      });
      
      // If this is a new_connection with a specific connectionId, update the local state
      // to mark only that connection as read (removing isNew flag)
      if (type === 'new_connection' && connectionId && connections) {
        // Update the local state by finding the specific connection and updating isNew flag
        const updatedConnections = connections.map(conn => {
          if (conn.id === connectionId) {
            return { ...conn, isNew: false };
          }
          return conn;
        });
        
        // Update the query cache with the modified connections
        queryClient.setQueryData(["/api/connections"], updatedConnections);
      }
      
      // Invalidate notification counts to update badges
      queryClient.invalidateQueries({ queryKey: ['/api/notifications/counts'] });
    } catch (error) {
      console.error(`Error marking ${type} notifications as read:`, error);
    }
  };

  // Handle conversation selection with scroll restoration
  const handleSelectConversation = (userId: number) => {
    // Store the previous conversation ID before setting the new one
    prevConversationIdRef.current = activeConversationId;
    
    // Set the new active conversation
    setActiveConversationId(userId);

    // Find the conversation for this user to get the conversation ID
    const conversation = safeConversations.find(conv => conv.otherUser.id === userId);
    
    // Mark message notifications as read only for this specific conversation
    if (conversation) {
      markNotificationsAsRead('message', conversation.id);
    }
  };
  
  // Reset scroll when active conversation changes - more aggressive approach
  useEffect(() => {
    const resetScroll = () => {
      // Force immediate scroll reset on all scrollable containers
      if (messageContainerRef.current) {
        // Hard reset scroll position to top
        messageContainerRef.current.scrollTop = 0;
        
        // Try twice to ensure it takes effect
        setTimeout(() => {
          if (messageContainerRef.current) {
            messageContainerRef.current.scrollTop = 0;
          }
        }, 50);
        
        // And again after layout is fully complete
        setTimeout(() => {
          if (messageContainerRef.current) {
            messageContainerRef.current.scrollTop = 0;
          }
        }, 200);
        
        console.log("[ConnectionsPage] Aggressively resetting message container scroll to top");
      }
    };
    
    // Reset scroll immediately
    resetScroll();
    
    // Also hook into next animation frame for smoother results
    requestAnimationFrame(resetScroll);
  }, [activeConversationId]);
  
  // Prevent body scrolling on desktop view
  useEffect(() => {
    if (deviceType === 'desktop') {
      // Save original styles
      const originalStyle = window.getComputedStyle(document.body).overflow;
      
      // Prevent scrolling on body
      document.body.style.overflow = 'hidden';
      
      // Restore on unmount
      return () => {
        document.body.style.overflow = originalStyle;
      };
    }
  }, [deviceType]);
  

  
  // Function to handle sending messages
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!newMessage.trim() || !currentUser?.id || !activeConversationId) return;
    
    // Create message structure
    const message: WebSocketMessage = {
      type: 'chat',
      receiverId: activeConversationId,
      content: newMessage.trim()
    };
    
    // Create temp message ID to track status
    const tempId = `temp-${Date.now()}`;
    
    // Add optimistic update
    const optimisticMessage: ExtendedMessage = {
      id: parseInt(tempId.replace('temp-', ''), 10), // Convert to numeric ID for compatibility
      conversationId: activeConversation?.id || 0,
      content: newMessage.trim(),
      senderId: currentUser.id,
      receiverId: activeConversationId || 0,
      createdAt: new Date().toISOString(),
      status: 'sending',
      isTemporary: true // Mark as temporary so we can identify it later
    };
    
    // Add to query cache
    const existingMessages = queryClient.getQueryData<ExtendedMessage[]>(["/api/messages", activeConversationId]) || [];
    queryClient.setQueryData(["/api/messages", activeConversationId], [...existingMessages, optimisticMessage]);
    
    // Clear the input
    setNewMessage("");
    
    // Scroll to the bottom to show the new message
    setTimeout(() => {
      if (messageContainerRef.current) {
        messageContainerRef.current.scrollTop = messageContainerRef.current.scrollHeight;
      }
    }, 50);
    
    try {
      // Try to send via WebSocket using the global hook
      if (isConnected) {
        sendWebSocketMessage(message);
      } else {
        // Send via API as backup if WebSocket not connected
        // Use apiRequest for proper JWT token handling on iOS
        const response = await apiRequest('POST', '/api/messages', {
          content: message.content,
          receiverId: message.receiverId,
        });
        
        if (!response.ok) {
          throw new Error('Failed to send message via API');
        }
      }
      
      // Invalidate queries to refresh data including notifications
      queryClient.invalidateQueries({
        queryKey: ["/api/messages", activeConversationId],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/conversations"],
      });
      // Make sure notification counts are immediately updated in UI
      queryClient.invalidateQueries({
        queryKey: ["/api/notifications/counts"],
      });
    } catch (error) {
      console.error('Error sending message:', error);
      
      // Update the message status to failed
      const existingMessages = queryClient.getQueryData<ExtendedMessage[]>(["/api/messages", activeConversationId]) || [];
      queryClient.setQueryData(
        ["/api/messages", activeConversationId],
        existingMessages.map((msg) => {
          // Check if this is our temporary message that failed
          const isTempMsg = msg.isTemporary && 
            msg.id.toString() === parseInt(tempId.replace('temp-', ''), 10).toString();
          return isTempMsg ? { ...msg, status: 'failed' as const } : msg;
        })
      );
      
      toast({
        variant: "destructive",
        title: "Message failed to send",
        description: "Please try again later."
      });
    }
  };

  // Fetch connections data with proper typing
  const { data: connections, isLoading: isLoadingConnections } = useQuery<Connection[]>({
    queryKey: ["/api/connections"],
    staleTime: 1000 * 60, // 1 minute
    refetchInterval: 1000 * 120, // 2 minutes
    retry: 2,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    select: (data) => data as Connection[] // Ensure correct typing
  });

  // Removed the automatic mark as read when loading the page
  // New connection notifications will persist until a connection is selected

  // Fetch conversations data with messages
  const { data: conversations, isLoading: isLoadingConversations } = useQuery<Conversation[]>({
    queryKey: ["/api/conversations"],
    staleTime: 1000 * 60, // 1 minute
    refetchInterval: 1000 * 120, // 2 minutes
    retry: 2,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    select: (data) => data as Conversation[] // Ensure correct typing
  });

  // Fetch search results when there's a search query
  const { data: searchResults, isLoading: isLoadingSearch } = useQuery<Conversation[]>({
    queryKey: ["/api/conversations/search", searchQuery],
    queryFn: async () => {
      if (!searchQuery.trim()) return [];
      const response = await fetch(`/api/conversations/search?q=${encodeURIComponent(searchQuery.trim())}`);
      if (!response.ok) throw new Error('Search failed');
      return response.json();
    },
    enabled: !!searchQuery.trim(),
    staleTime: 1000 * 30, // 30 seconds
    select: (data) => data as Conversation[]
  });
  
  // Removed the automatic mark as read when loading the page
  // Message notifications will persist until a conversation is selected

  // Ensure connections is always an array
  const safeConnections = connections || [];
  
  // Use search results if there's a search query, otherwise use regular conversations
  const conversationsToUse = searchQuery.trim() ? searchResults : conversations;
  
  // Filter conversations to only include those with messages, then sort by most recent message
  const safeConversations: ConversationWithMessage[] = conversationsToUse 
    ? [...conversationsToUse]
        .filter((conv): conv is ConversationWithMessage => conv.lastMessage !== undefined) // Only include conversations with messages
        .sort((a, b) => {
          const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
          const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
          return bTime - aTime;
        }) 
    : [];

  // Debug logging to understand data availability
  if (searchQuery) {
    console.log(`[Search Debug] Search Query: "${searchQuery}"`);
    console.log(`[Search Debug] Total connections:`, safeConnections.length);
    console.log(`[Search Debug] Total conversations:`, safeConversations.length);
    console.log(`[Search Debug] Connections data:`, safeConnections.map(conn => ({
      id: conn.otherUser.id,
      name: conn.otherUser.fullName
    })));
    console.log(`[Search Debug] Conversations data:`, safeConversations.map(conv => ({
      userId: conv.otherUser.id,
      userName: conv.otherUser.fullName,
      lastMessage: conv.lastMessage?.content || 'No content'
    })));
  }

  // Filter connections based on search query
  // When searching, only show connections whose names match the search query directly
  const filteredConnections = searchQuery 
    ? safeConnections.filter(conn => {
        // Only include connections whose names match the search query directly
        const nameMatch = conn.otherUser.fullName.toLowerCase().includes(searchQuery.toLowerCase());
        
        // Debug logging for troubleshooting
        if (searchQuery && nameMatch) {
          console.log(`[Search Debug] Connection name match found for "${searchQuery}":`, {
            connectionName: conn.otherUser.fullName,
            nameMatch
          });
        }
        
        return nameMatch;
      })
    : safeConnections;

  // Use the search results as filtered conversations (they're already filtered by the backend)
  const filteredConversations = safeConversations;
    
  // Get the active conversation from ID
  // Filter conversations to those with the given ID
  const activeConversation = activeConversationId 
    ? safeConversations.find(conv => conv.otherUser.id === activeConversationId) ?? null 
    : null;

  // Desktop-specific layout with split view
  if (deviceType === 'desktop') {
    return (
      <div className="h-screen overflow-hidden bg-background flex flex-col" style={{ height: 'calc(100vh - 64px)' }}>
        {/* Messages Section with desktop split layout */}
        {isLoadingConnections ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : safeConnections.length > 0 ? (
          <div className="h-full overflow-hidden">
            <div className="flex h-full overflow-hidden">
              {/* Left Column - Connections and Conversation List */}
              <div className={`${activeConversation ? 'w-1/3' : 'w-full'} h-full flex flex-col bg-background overflow-hidden`}>
                {/* Unified section for title, search and connections carousel */}
                <div className="w-full flex-none">
                  {/* Title and Search */}
                  <div className="mb-4 pl-4 pr-4 pt-4">
                    <div className="flex items-center justify-between">
                      <h1 className="text-2xl font-bold" style={{ color: 'hsl(215, 25%, 27%)' }}>
                        Connections
                      </h1>
                    </div>
                    {/* Search field below Connections title */}
                    {!isLoadingConnections && safeConnections.length > 0 && (
                      <div className="relative mt-2">
                        <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                          <Search className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <Input
                          type="text"
                          placeholder="Search names and messages..."
                          className="pl-10 py-1 text-sm h-8 border-none bg-muted/50 focus-visible:ring-0"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                        />
                      </div>
                    )}
                  </div>
                  
                  {/* Connections Carousel Section - in same container as title and search */}
                  {isLoadingConnections ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin" />
                    </div>
                  ) : (
                    <div className="overflow-visible">
                      <div className="connections-carousel-container" style={{ margin: 0 }}>
                        <ConnectionsCarousel
                          connections={filteredConnections}
                          isSearchFiltered={!!searchQuery && safeConnections.length > 0}
                          onSelectProfile={(profile) => {
                            setSelectedProfile(profile);
                            // Find the connection to mark as read by matching profile ID
                            const connection = filteredConnections.find(conn => conn.otherUser.id === profile.id);
                            if (connection && connection.isNew) {
                              // Only mark this specific connection as read
                              markNotificationsAsRead('new_connection', undefined, connection.id);
                            }
                          }}
                          onConnectionClick={(connection) => {
                            handleSelectConversation(connection.otherUser.id);
                            // Connection clicks already handle message notifications via handleSelectConversation
                            // Also mark this specific new connection as read if it's a new connection
                            if (connection.isNew) {
                              markNotificationsAsRead('new_connection', undefined, connection.id);
                            }
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Messages Title */}
                <div className="px-4 py-2">
                  <h2 className="text-xl font-semibold" style={{ color: 'hsl(215, 25%, 27%)' }}>
                    Messages
                  </h2>
                </div>

                {/* Conversations List */}
                <div className="flex-1 overflow-y-auto" style={{ paddingBottom: '10px' }}>
                  {isLoadingConversations || (searchQuery && isLoadingSearch) ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin" />
                    </div>
                  ) : filteredConversations.length === 0 ? (
                    <div className="text-center py-4">
                      <p className="text-muted-foreground">
                        {safeConversations.length === 0 
                          ? "No conversations with messages yet. Start chatting with your connections!" 
                          : "No matches for your search. Try different keywords."}
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col">
                      {filteredConversations.map((conversation) => (
                        <div
                          key={conversation.id}
                          className={`cursor-pointer py-2 ${activeConversationId === conversation.otherUser.id ? 'bg-muted' : 'hover:bg-muted/50'}`}
                          onClick={() => handleSelectConversation(conversation.otherUser.id)}
                        >
                          <div className="flex items-start gap-2 pl-2">
                            <div className={`flex-shrink-0 ${conversation.hasUnreadMessages ? 'shadow-[0_0_10px_3px_rgba(96,165,250,0.7)] rounded-full' : ''}`}>
                              <UserAvatar 
                                user={conversation.otherUser} 
                                className="h-10 w-10 rounded-full"
                                fallbackClassName="text-lg font-semibold bg-primary text-white"
                              />
                            </div>
                            <div className="flex-1 min-w-0 pb-3 border-b mr-4" style={{ borderColor: 'rgba(0, 0, 0, 0.08)' }}>
                              <div className="flex justify-between items-start">
                                <div className="flex items-center">
                                  <h3 className="font-semibold truncate pr-2">
                                    {conversation.otherUser.fullName}
                                  </h3>
                                </div>
                                <p className="text-xs text-muted-foreground whitespace-nowrap">
                                  {conversation.lastMessageAt && 
                                    new Date(conversation.lastMessageAt).toLocaleTimeString(undefined, {
                                      hour: '2-digit',
                                      minute: '2-digit'
                                    })
                                  }
                                </p>
                              </div>
                              
                              {/* Latest Message Preview */}
                              <div className="mt-1">
                                <p className="text-sm truncate text-muted-foreground">
                                  {conversation.lastMessage.content}
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column - Conversation View - Takes full height */}
              {activeConversation ? (
                <div className="w-2/3 h-full flex flex-col bg-background overflow-hidden border-l">
                  {/* Conversation Header */}
                  <div className="px-4 py-4 border-b bg-background flex flex-col items-center justify-center text-center flex-shrink-0">
                    <div 
                      className="cursor-pointer mb-1"
                      onClick={() => setSelectedProfile(activeConversation.otherUser)}
                    >
                      <UserAvatar 
                        user={activeConversation.otherUser} 
                        className="h-12 w-12 rounded-full"
                        fallbackClassName="text-base font-semibold bg-primary text-white"
                      />
                    </div>
                    <div className="text-center">
                      <h3 
                        className="font-medium cursor-pointer hover:underline"
                        onClick={() => setSelectedProfile(activeConversation.otherUser)}
                      >
                        {activeConversation.otherUser.fullName}
                      </h3>
                    </div>
                  </div>

                  {/* Main container for messages and input */}
                  <div className="flex-1 flex flex-col h-full overflow-hidden">
                    {/* Conversation Content - Scrollable message area */}
                    <div 
                      ref={messageContainerRef}
                      className="flex-1 overflow-y-auto scroll-container"
                      style={{ 
                        scrollBehavior: 'auto',
                        overscrollBehavior: 'none',
                        position: 'relative',
                        willChange: 'scroll-position'
                      }}
                    >
                      {/* Load the actual MessageList component */}
                      <MessageList 
                        conversationId={activeConversation.id}
                        recipientId={activeConversation.otherUser.id}
                        otherUser={activeConversation.otherUser}
                        onProfileClick={() => setSelectedProfile(activeConversation.otherUser)}
                      />
                    </div>

                    {/* Message Input - Fixed at bottom */}
                    <form 
                      onSubmit={handleSendMessage} 
                      className="py-1 px-4 pb-1 pt-1 border-t flex gap-2 bg-background z-10 flex-shrink-0"
                    >
                      <Input
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        placeholder={
                          connectionState === CONNECTION_STATES.CONNECTED
                            ? "Type a message..."
                            : connectionState === CONNECTION_STATES.CONNECTING
                            ? "Connecting..."
                            : "Type a message..."
                        }
                        className="flex-1"
                        disabled={connectionState === CONNECTION_STATES.FAILED}
                      />
                      <Button 
                        type="submit" 
                        disabled={connectionState === CONNECTION_STATES.FAILED || !newMessage.trim()}
                        className="px-4"
                      >
                        <SendHorizontal className="h-4 w-4" />
                      </Button>
                    </form>
                  </div>
                </div>
              ) : isGroupChatFeatureEnabled() && isCreatingGroupChat ? (
                // Show group chat creation interface in the right panel
                <div className="w-2/3 h-full flex flex-col bg-background overflow-hidden border-l">
                  {/* Group Chat Header - iOS-inspired style */}
                  <div className="px-4 py-4 border-b bg-background flex justify-between items-center flex-shrink-0">
                    <div className="flex items-center">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="mr-2"
                        onClick={() => setIsCreatingGroupChat(false)}
                      >
                        <ArrowLeft className="h-5 w-5" strokeWidth={2.5} />
                      </Button>
                      <div className="flex flex-col items-center">
                        <h3 className="font-semibold text-lg">New Group Chat</h3>
                        <p className="text-xs text-muted-foreground">
                          {selectedGroupMembers.length === 0 
                            ? "Select members and send a message" 
                            : `${selectedGroupMembers.length} member${selectedGroupMembers.length !== 1 ? 's' : ''} selected`}
                        </p>
                      </div>
                    </div>
                  </div>
                  
                  {/* Group Chat Creation Content */}
                  <div className="flex-1 flex flex-col h-full overflow-hidden">
                    {/* Search and Selected Members */}
                    <div className="p-4 border-b">
                      <div className="relative mb-4">
                        <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                          <Search className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <Input
                          type="text"
                          placeholder="Search connections..."
                          className="pl-10 py-2 text-sm border bg-background"
                          value={groupChatSearchQuery}
                          onChange={(e) => setGroupChatSearchQuery(e.target.value)}
                        />
                      </div>
                      
                      {/* Selected members */}
                      {selectedGroupMembers.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2">
                          {selectedGroupMembers.map(member => (
                            <Badge 
                              key={member.id} 
                              variant="secondary"
                              className="flex items-center gap-1 p-1 pl-2"
                            >
                              {member.fullName}
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-5 w-5 p-0 rounded-full"
                                onClick={() => {
                                  setSelectedGroupMembers(prev => prev.filter(m => m.id !== member.id));
                                }}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    
                    {/* Connections List */}
                    <ScrollArea className="flex-1">
                      <div className="p-2">
                        {safeConnections
                          .filter(conn => 
                            !selectedGroupMembers.some(member => member.id === conn.otherUser.id) &&
                            (groupChatSearchQuery === "" || 
                              conn.otherUser.fullName.toLowerCase().includes(groupChatSearchQuery.toLowerCase()))
                          )
                          .map(connection => (
                            <div 
                              key={connection.id}
                              className="flex items-center p-3 hover:bg-muted rounded-md cursor-pointer"
                              onClick={() => {
                                setSelectedGroupMembers(prev => [...prev, connection.otherUser]);
                              }}
                            >
                              <div className="mr-3">
                                <Avatar className="h-10 w-10">
                                  {connection.otherUser.photo ? (
                                    <AvatarImage src={connection.otherUser.photo} alt={connection.otherUser.fullName} />
                                  ) : (
                                    <AvatarFallback>{getInitials(connection.otherUser.fullName)}</AvatarFallback>
                                  )}
                                </Avatar>
                              </div>
                              <div className="flex-1">
                                <p className="font-medium">{connection.otherUser.fullName}</p>
                                <p className="text-sm text-muted-foreground truncate">{connection.otherUser.title}</p>
                              </div>
                              <Button variant="ghost" size="sm" className="rounded-full">
                                <Plus className="h-4 w-4" />
                              </Button>
                            </div>
                          ))
                        }
                      </div>
                    </ScrollArea>
                    
                    {/* Message Input Field */}
                    <div className="p-4 border-t">
                      <form 
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (newMessage.trim() && selectedGroupMembers.length > 0) {
                            // Use sendGroupMessageMutation from group-chat-page
                            console.log("Sending group message", {
                              messageContent: newMessage.trim(),
                              memberIds: selectedGroupMembers.map(member => member.id)
                            });
                            
                            // Send the message to create a group chat
                            sendGroupMessageMutation.mutate({
                              content: newMessage.trim(),
                              memberIds: selectedGroupMembers.map(member => member.id)
                            });
                          }
                        }}
                        className="w-full"
                      >
                        <div className="flex items-center gap-2">
                          <div className="relative flex-1">
                            <Input
                              value={newMessage}
                              onChange={(e) => setNewMessage(e.target.value)}
                              placeholder="Message"
                              className="pr-10 py-6 rounded-full bg-muted/40 border-none shadow-inner focus-visible:ring-0"
                              disabled={selectedGroupMembers.length === 0}
                            />
                          </div>
                          <button
                            className={`rounded-full p-3 flex items-center justify-center transition-colors ${
                              !newMessage.trim() || selectedGroupMembers.length === 0
                                ? 'bg-primary/50 text-white/70 cursor-not-allowed'
                                : 'bg-primary text-white hover:bg-primary/90 active:bg-primary/80'
                            }`}
                            disabled={!newMessage.trim() || selectedGroupMembers.length === 0}
                            type="submit"
                            aria-label="Send message"
                          >
                            <SendHorizontal className="h-5 w-5" />
                          </button>
                        </div>
                      </form>
                    </div>
                  </div>
                </div>
              ) : activeConversationId ? (
                // Show a blank messaging interface when a user is selected but no conversation exists yet
                <div className="w-2/3 h-full flex flex-col bg-background overflow-hidden border-l">
                  {/* User Profile Header */}
                  <div className="px-4 py-4 border-b bg-background flex flex-col items-center justify-center text-center flex-shrink-0">
                    {/* Find the user in connections */}
                    {(() => {
                      const selectedUser = safeConnections.find(conn => conn.otherUser.id === activeConversationId)?.otherUser;
                      if (selectedUser) {
                        return (
                          <>
                            <div 
                              role="button"
                              tabIndex={0}
                              aria-label={`View ${selectedUser.fullName}'s profile`}
                              className="h-12 w-12 rounded-full overflow-hidden cursor-pointer mb-1"
                              onClick={() => setSelectedProfile(selectedUser)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  setSelectedProfile(selectedUser);
                                }
                              }}
                            >
                              {selectedUser.photo ? (
                                <img
                                  src={selectedUser.photo}
                                  alt={selectedUser.fullName}
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <div className="h-full w-full bg-primary/10 flex items-center justify-center text-primary text-base font-semibold">
                                  {getInitials(selectedUser.fullName)}
                                </div>
                              )}
                            </div>
                            <div className="text-center">
                              <h3 
                                role="button"
                                tabIndex={0}
                                className="font-medium cursor-pointer hover:underline"
                                onClick={() => setSelectedProfile(selectedUser)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    setSelectedProfile(selectedUser);
                                  }
                                }}
                              >
                                {selectedUser.fullName}
                              </h3>
                            </div>
                          </>
                        );
                      }
                      return null;
                    })()}
                  </div>

                  {/* Empty message area with prompt */}
                  <div className="flex-1 flex flex-col justify-center items-center p-6 text-center">
                    {(() => {
                      const connection = safeConnections.find(conn => conn.otherUser.id === activeConversationId);
                      return connection ? (
                        <>
                          <div 
                            role="button"
                            tabIndex={0}
                            aria-label={`View ${connection.otherUser.fullName}'s profile`}
                            className="h-24 w-24 rounded-full overflow-hidden cursor-pointer mb-4"
                            onClick={() => setSelectedProfile(connection.otherUser)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setSelectedProfile(connection.otherUser);
                              }
                            }}
                          >
                            {connection.otherUser.photo && 
                             !connection.otherUser.photo.includes('placeholder') && 
                             connection.otherUser.photo !== '/placeholder.jpg' ? (
                              <img
                                src={connection.otherUser.photo}
                                alt={connection.otherUser.fullName}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="h-full w-full bg-primary flex items-center justify-center text-white text-2xl font-semibold">
                                {getInitials(connection.otherUser.fullName)}
                              </div>
                            )}
                          </div>
                          <h3 className="text-xl font-semibold mb-2" style={{ color: 'hsl(215, 25%, 27%)' }}>
                            You connected with {connection.otherUser.fullName}
                          </h3>
                          <p className="text-muted-foreground mb-6">
                            {new Date(connection.createdAt).toLocaleDateString(undefined, {
                              year: 'numeric', month: 'long', day: 'numeric'
                            })}
                          </p>
                          <p className="text-sm text-muted-foreground max-w-md">
                            Send a message below to start a conversation
                          </p>
                        </>
                      ) : (
                        <>
                          <MessageCircle className="h-16 w-16 text-muted-foreground mx-auto mb-4" strokeWidth={1.5} />
                          <h3 className="text-xl font-semibold mb-2" style={{ color: 'hsl(215, 25%, 27%)' }}>
                            Start a new conversation
                          </h3>
                          <p className="text-muted-foreground max-w-md">
                            Send a message below to begin chatting
                          </p>
                        </>
                      );
                    })()}
                  </div>

                  {/* Message Input - Fixed at bottom */}
                  <form 
                    onSubmit={handleSendMessage} 
                    className="py-1 px-4 pb-1 pt-1 border-t flex gap-2 bg-background z-10 flex-shrink-0"
                  >
                    <Input
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      placeholder={
                        connectionState === CONNECTION_STATES.CONNECTED
                          ? "Type a message..."
                          : connectionState === CONNECTION_STATES.CONNECTING
                          ? "Connecting..."
                          : "Type a message..."
                      }
                      className="flex-1"
                      disabled={connectionState === CONNECTION_STATES.FAILED}
                    />
                    <Button 
                      type="submit" 
                      disabled={connectionState === CONNECTION_STATES.FAILED || !newMessage.trim()}
                      className="px-4"
                    >
                      <SendHorizontal className="h-4 w-4" />
                    </Button>
                  </form>
                </div>
              ) : (
                <div className="w-2/3 h-full flex flex-col bg-background overflow-hidden border-l">
                  {/* Empty placeholder that matches the layout of the active conversation */}
                  <div className="flex-1 flex items-center justify-center bg-muted/30">
                    <div className="text-center">
                      <MessageSquare className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                      <h3 className="text-xl font-semibold mb-2" style={{ color: 'hsl(215, 25%, 27%)' }}>
                        No conversation selected
                      </h3>
                      <p className="text-muted-foreground">
                        Select a connection or conversation from the left to start messaging
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col">
            {/* Header title even when empty */}
            <div className="w-full flex-none">
              <div className="mb-4 pl-4 pr-4 pt-4">
                <div className="flex items-center justify-between">
                  <h1 className="text-2xl font-bold" style={{ color: 'hsl(215, 25%, 27%)' }}>
                    Connections
                  </h1>
                </div>
              </div>
            </div>
            
            {/* No connections notification */}
            <div className="flex items-center justify-center flex-1">
              <div className="text-center px-4 mx-4">
                <h2 className="text-xl font-semibold mb-2">
                  No connections yet
                </h2>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  Start connecting with other professionals to build your network
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Profile Dialog */}
        {selectedProfile && (
          <ProfileDialog
            profile={selectedProfile}
            open={!!selectedProfile}
            onOpenChange={(open) => !open && setSelectedProfile(null)}
            isConnected={true}
            onMessageClick={() => {
              const profileId = selectedProfile.id;
              setSelectedProfile(null);
              handleSelectConversation(profileId); // Use scroll-preserving handler
            }}
          />
        )}
      </div>
    );
  }

  // Original mobile layout
  return (
    <div className="min-h-[100dvh] bg-background flex flex-col">
      {/* Header Section with further reduced top padding */}
      <div className="container mx-auto pl-4 pr-4 pt-1 pb-2 flex-none">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold" style={{ color: 'hsl(215, 25%, 27%)' }}>
            Connections
          </h1>
        </div>
        {/* Only show search bar if there are connections */}
        {!isLoadingConnections && safeConnections.length > 0 && (
          <div className="relative mt-2">
            <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
              <Search className="h-4 w-4 text-muted-foreground" />
            </div>
            <Input
              type="text"
              placeholder="Search names and messages..."
              className="pl-10 py-2 text-sm border-none bg-muted/50 focus-visible:ring-0"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        )}
      </div>

      {/* Connections Carousel Section */}
      <div className="w-full mb-4 flex-none">
        {isLoadingConnections ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <div className="overflow-visible">
            <div className="connections-carousel-container" style={{ margin: 0 }}>
              <ConnectionsCarousel
                connections={filteredConnections}
                isSearchFiltered={!!searchQuery && safeConnections.length > 0}
                onSelectProfile={(profile) => {
                  setSelectedProfile(profile);
                  // Find the connection to mark as read by matching profile ID
                  const connection = filteredConnections.find(conn => conn.otherUser.id === profile.id);
                  if (connection && connection.isNew) {
                    // Only mark this specific connection as read
                    markNotificationsAsRead('new_connection', undefined, connection.id);
                  }
                }}
                onConnectionClick={(connection) => {
                  // Only mark message notifications for this specific conversation as read
                  markNotificationsAsRead('message', connection.id);
                  // Mark only this specific new connection as read if it's new
                  if (connection.isNew) {
                    markNotificationsAsRead('new_connection', undefined, connection.id);
                  }
                  navigate(`/chat/${connection.otherUser.id}`);
                }}
              />
            </div>
          </div>
        )}
      </div>
      
      {/* Messages Section - Only show if there are connections */}
      {!isLoadingConnections && safeConnections.length > 0 && (
        <>
          {/* Messages Title */}
          <div className="container mx-auto px-4 mb-2 flex-none">
            <h2 className="text-xl font-semibold" style={{ color: 'hsl(215, 25%, 27%)' }}>
              Messages
            </h2>
          </div>

          {/* Conversations with Messages Grid */}
          <div className="container mx-auto px-0 flex-1 pb-6">
            {isLoadingConversations || (searchQuery && isLoadingSearch) ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : filteredConversations.length === 0 ? (
              <div className="text-center py-4">
                <p className="text-muted-foreground">
                  {safeConversations.length === 0 
                    ? "No conversations with messages yet. Start chatting with your connections!" 
                    : "No matches for your search. Try different keywords."}
                </p>
              </div>
            ) : (
              <div className="flex flex-col">
                {filteredConversations.map((conversation) => (
                  <div
                    key={conversation.id}
                    className="cursor-pointer py-3"
                    onClick={() => {
                      // Mark message notifications as read for this specific conversation
                      markNotificationsAsRead('message', conversation.id);
                      navigate(`/chat/${conversation.otherUser.id}`);
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`h-12 w-12 rounded-full overflow-hidden bg-muted flex-shrink-0 ml-4 ${conversation.hasUnreadMessages ? 'shadow-[0_0_10px_3px_rgba(96,165,250,0.7)]' : ''}`}>
                        {conversation.otherUser.photo && 
                         !conversation.otherUser.photo.includes('placeholder') && 
                         conversation.otherUser.photo !== '/placeholder.jpg' ? (
                          <img
                            src={conversation.otherUser.photo}
                            alt={conversation.otherUser.fullName}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="h-full w-full bg-primary flex items-center justify-center text-white text-lg font-semibold">
                            {getInitials(conversation.otherUser.fullName)}
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0 pb-3 border-b" style={{ borderColor: 'rgba(0, 0, 0, 0.08)' }}>
                        <div className="flex justify-between items-start mr-4">
                          <div className="flex items-center">
                            {/* No blue dot for unread messages - removed feature */}
                            <h3 className="font-semibold truncate pr-2">
                              {conversation.otherUser.fullName}
                            </h3>
                          </div>
                          <p className="text-xs text-muted-foreground whitespace-nowrap">
                            {conversation.lastMessageAt && 
                              new Date(conversation.lastMessageAt).toLocaleTimeString(undefined, {
                                hour: '2-digit',
                                minute: '2-digit'
                              })
                            }
                          </p>
                        </div>
                        
                        {/* Latest Message Preview */}
                        <div className="mt-1 mr-4">
                          <p className="text-sm truncate text-muted-foreground">
                            {conversation.lastMessage.content}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Profile Dialog */}
      {selectedProfile && (
        <ProfileDialog
          profile={selectedProfile}
          open={!!selectedProfile}
          onOpenChange={(open) => !open && setSelectedProfile(null)}
          isConnected={true}
          onMessageClick={() => {
            const profileId = selectedProfile.id;
            setSelectedProfile(null);
            navigate(`/chat/${profileId}`);
          }}
        />
      )}

      {/* Group chat is intentionally unsupported; keep the retired UI unreachable. */}
      {isGroupChatFeatureEnabled() && (
      <Dialog open={isGroupChatOpen} onOpenChange={setIsGroupChatOpen}>
        <DialogContent className="sm:max-w-[500px] max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Create Group Chat</DialogTitle>
          </DialogHeader>
          
          {/* Search for connections */}
          <div className="relative my-2">
            <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
              <Search className="h-4 w-4 text-muted-foreground" />
            </div>
            <Input
              type="text"
              placeholder="Search connections..."
              className="pl-10 py-2 text-sm border bg-background focus-visible:ring-1"
              value={groupChatSearchQuery}
              onChange={(e) => setGroupChatSearchQuery(e.target.value)}
            />
          </div>
          
          {/* Selected members */}
          {selectedGroupMembers.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {selectedGroupMembers.map(member => (
                <Badge 
                  key={member.id} 
                  variant="secondary"
                  className="flex items-center gap-1 p-1 pl-2"
                >
                  {member.fullName}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 w-5 p-0 rounded-full"
                    onClick={() => {
                      setSelectedGroupMembers(prev => prev.filter(m => m.id !== member.id));
                    }}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </Badge>
              ))}
            </div>
          )}
          
          {/* Connections list */}
          <ScrollArea className="flex-1 pr-4 min-h-[300px]">
            {safeConnections.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-muted-foreground">No connections found</p>
              </div>
            ) : (
              <div className="space-y-2">
                {safeConnections
                  .filter(conn => 
                    !selectedGroupMembers.some(member => member.id === conn.otherUser.id) &&
                    (groupChatSearchQuery === "" || 
                      conn.otherUser.fullName.toLowerCase().includes(groupChatSearchQuery.toLowerCase()))
                  )
                  .map(connection => (
                    <div 
                      key={connection.id}
                      className="flex items-center p-2 hover:bg-muted rounded-md cursor-pointer"
                      onClick={() => {
                        setSelectedGroupMembers(prev => [...prev, connection.otherUser]);
                      }}
                    >
                      <div className="mr-3">
                        <Avatar className="h-10 w-10">
                          {connection.otherUser.photo ? (
                            <AvatarImage src={connection.otherUser.photo} alt={connection.otherUser.fullName} />
                          ) : (
                            <AvatarFallback>{getInitials(connection.otherUser.fullName)}</AvatarFallback>
                          )}
                        </Avatar>
                      </div>
                      <div className="flex-1">
                        <p className="font-medium">{connection.otherUser.fullName}</p>
                        <p className="text-sm text-muted-foreground truncate">{connection.otherUser.title}</p>
                      </div>
                      <Button variant="ghost" size="sm" className="ml-2 rounded-full">
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  ))
                }
              </div>
            )}
          </ScrollArea>
          
          <DialogFooter className="mt-4">
            <Button 
              variant="secondary" 
              onClick={() => {
                setIsGroupChatOpen(false);
                setSelectedGroupMembers([]);
                setGroupChatSearchQuery("");
              }}
            >
              Cancel
            </Button>
            <Button 
              disabled={selectedGroupMembers.length === 0}
              onClick={() => {
                if (selectedGroupMembers.length > 0) {
                  // TODO: Create the group chat and navigate to it
                  toast({
                    title: "Group chat created",
                    description: `Created a group chat with ${selectedGroupMembers.map(m => m.fullName).join(", ")}`,
                  });
                  setIsGroupChatOpen(false);
                  // Reset the state after creating the group
                  setSelectedGroupMembers([]);
                  setGroupChatSearchQuery("");
                }
              }}
            >
              Start Chat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      )}
    </div>
  );
}
