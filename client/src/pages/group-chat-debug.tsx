import { useState } from "react";
import {
  Search, X, Plus, SendHorizontal, ChevronLeft, Loader2
} from "lucide-react";
import { type User } from "@shared/schema";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { getInitials } from "@/lib/avatar-utils";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

// Define the type for connection data
interface Connection {
  otherUser: User;
  id: number;
  createdAt: string;
}

// Thicker back button component to match messaging page
const GroupChatBackButton = ({ onClick }: { onClick: () => void }) => {
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-center cursor-pointer border-none bg-transparent p-0"
      aria-label="Back to connections"
    >
      <ChevronLeft width={28} height={28} strokeWidth={3} className="text-gray-700" />
    </button>
  );
}

interface GroupMessageResponse {
  conversationId: number;
  messages: unknown[];
  success: boolean;
}

export default function GroupChatDebugPage() {
  const { user: currentUser } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedGroupMembers, setSelectedGroupMembers] = useState<User[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  
  // Add debug log
  const addLog = (message: string) => {
    setDebugLogs(prev => [...prev, `${new Date().toISOString().substring(11, 19)}: ${message}`]);
  };
  
  // Fetch connections data with proper typing
  const { data: connections, isLoading: isLoadingConnections } = useQuery<Connection[]>({
    queryKey: ["/api/connections"],
    refetchInterval: 30000,
    staleTime: 10000
  });
  
  // Ensure connections is always an array
  const safeConnections = connections || [];
  
  // Filter connections based on search query
  const filteredConnections = searchQuery 
    ? safeConnections.filter(conn => 
        conn.otherUser.fullName.toLowerCase().includes(searchQuery.toLowerCase()))
    : safeConnections;
  
  const queryClient = useQueryClient();
  
  // Create a mutation for sending a message and creating a group chat
  const sendGroupMessageMutation = useMutation<
    GroupMessageResponse, 
    Error, 
    { content: string; memberIds: number[] }
  >({
    mutationFn: async ({ content, memberIds }) => {
      addLog(`Mutation called with: content='${content}', memberIds=[${memberIds.join(', ')}]`);
      
      try {
        addLog("Making API request to /api/messages/group");
        const response = await apiRequest(
          "POST",
          "/api/messages/group", 
          {
            content,
            memberIds
          }
        );
        
        addLog(`API response status: ${response.status}`);
        const data = await response.json();
        addLog(`Response data: ${JSON.stringify(data)}`);
        return data as GroupMessageResponse;
      } catch (error) {
        addLog(`Error in mutation: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
    },
    onSuccess: (data) => {
      addLog(`Group message sent successfully: ${JSON.stringify(data)}`);
      
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
        addLog(`Navigating to chat/${data.conversationId}`);
        navigate(`/chat/${data.conversationId}`);
      } else {
        addLog("No conversationId received, navigating to connections page");
        navigate('/connections');
      }
    },
    onError: (error) => {
      addLog(`Error in message mutation: ${error.message}`);
      toast({
        variant: "destructive",
        title: "Error sending message",
        description: "Could not send your message. Please try again.",
      });
    },
  });

  // Direct API call function
  const sendDirectApiCall = async () => {
    addLog("Sending direct API call");
    
    if (selectedGroupMembers.length === 0) {
      addLog("No members selected");
      toast({
        variant: "destructive",
        title: "No members selected",
        description: "Please select at least one connection to create a group chat."
      });
      return;
    }
    
    if (!newMessage.trim()) {
      addLog("No message entered");
      toast({
        variant: "destructive",
        title: "Message required", 
        description: "Please enter a message to send to the group."
      });
      return;
    }
    
    // Get the member IDs and validate them
    const memberIds = selectedGroupMembers.map(member => member.id);
    
    // Make sure all IDs are valid numbers and exclude current user's ID
    const validatedMemberIds = memberIds.filter(id => {
      const isValid = typeof id === 'number' && !isNaN(id) && id !== currentUser?.id;
      if (!isValid && id === currentUser?.id) {
        addLog(`Filtering out current user ID: ${id}`);
      }
      return isValid;
    });
    
    addLog(`Original member IDs: [${memberIds.join(', ')}]`);
    addLog(`Current user ID: ${currentUser?.id}`);
    addLog(`Filtered member IDs: [${validatedMemberIds.join(', ')}]`);
    
    if (validatedMemberIds.length === 0) {
      addLog("No valid members after filtering");
      toast({
        variant: "destructive",
        title: "No valid members", 
        description: "Please select valid connections for the group chat."
      });
      return;
    }
    
    addLog(`Preparing to send with content='${newMessage.trim()}', memberIds=[${validatedMemberIds.join(', ')}]`);
    
    try {
      // Use fetch directly
      addLog("Making direct fetch call");
      const response = await fetch('/api/messages/group', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: newMessage.trim(),
          memberIds: validatedMemberIds
        })
      });
      
      addLog(`Direct API response status: ${response.status}`);
      const data = await response.json();
      addLog(`Direct API response data: ${JSON.stringify(data)}`);
      
      // Handle success similar to mutation
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      setNewMessage("");
      
      toast({
        title: "Message sent",
        description: `Group message sent to ${selectedGroupMembers.length} member${selectedGroupMembers.length > 1 ? 's' : ''}`,
      });
      
      if (data?.conversationId) {
        navigate(`/chat/${data.conversationId}`);
      } else {
        navigate('/connections');
      }
    } catch (error) {
      addLog(`Error in direct API call: ${error instanceof Error ? error.message : String(error)}`);
      toast({
        variant: "destructive",
        title: "Error creating group chat",
        description: "An unexpected error occurred. Please try again."
      });
    }
  };
  
  // Function to handle creating the group chat and sending the first message
  const handleCreateGroupChat = () => {
    addLog("Create Group Chat button clicked");
    
    if (selectedGroupMembers.length === 0) {
      addLog("No members selected");
      toast({
        variant: "destructive",
        title: "No members selected",
        description: "Please select at least one connection to create a group chat."
      });
      return;
    }
    
    if (!newMessage.trim()) {
      addLog("No message entered");
      toast({
        variant: "destructive",
        title: "Message required", 
        description: "Please enter a message to send to the group."
      });
      return;
    }
    
    // Get current user's ID and the selected members' IDs
    const memberIds = selectedGroupMembers.map(member => member.id);
    
    // Make sure all IDs are valid numbers and exclude current user's ID
    const validatedMemberIds = memberIds.filter(id => {
      const isValid = typeof id === 'number' && !isNaN(id) && id !== currentUser?.id;
      if (!isValid && id === currentUser?.id) {
        addLog(`Filtering out current user ID: ${id}`);
      }
      return isValid;
    });
    
    addLog(`Original member IDs: [${memberIds.join(', ')}]`);
    addLog(`Current user ID: ${currentUser?.id}`);
    addLog(`Filtered member IDs: [${validatedMemberIds.join(', ')}]`);
    
    if (validatedMemberIds.length === 0) {
      addLog("No valid members after filtering");
      toast({
        variant: "destructive",
        title: "No valid members", 
        description: "Please select valid connections for the group chat."
      });
      return;
    }
    
    addLog(`Sending group message with content='${newMessage.trim()}', memberIds=[${validatedMemberIds.join(', ')}]`);
    
    try {
      // Send the message to create a group chat
      sendGroupMessageMutation.mutate({
        content: newMessage.trim(),
        memberIds: validatedMemberIds
      });
    } catch (error) {
      addLog(`Error in handleCreateGroupChat: ${error instanceof Error ? error.message : String(error)}`);
      toast({
        variant: "destructive",
        title: "Error creating group chat",
        description: "An unexpected error occurred. Please try again."
      });
    }
  };
  
  // Function to navigate back to connections
  const goToConnections = () => {
    navigate('/connections');
  };

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col">
      {/* Status Bar Safe Area */}
      <div className="bg-background h-14"></div>
      
      {/* Header with back button and title - matches messaging page */}
      <div className="container mx-auto px-2 py-3 flex items-center">
        <div className="w-12 flex items-center justify-start">
          <GroupChatBackButton onClick={goToConnections} />
        </div>
        <h1 className="flex-1 text-center text-lg font-semibold">
          Debug Group Chat
        </h1>
        <div className="w-12 opacity-0">
          {/* Empty div for spacing to balance the header */}
        </div>
      </div>
      
      {/* Search Bar - iOS Style */}
      <div className="container mx-auto px-4 pt-3 pb-2">
        <div className="relative">
          <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
            <Search className="h-4 w-4 text-muted-foreground" />
          </div>
          <Input
            type="text"
            placeholder="Search connections..."
            className="pl-10 py-1.5 text-sm bg-muted/40 border-none rounded-lg shadow-inner focus-visible:ring-0"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        
        {/* Selected members */}
        {selectedGroupMembers.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-3">
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
                  onClick={(e) => {
                    e.stopPropagation();
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
      
      {/* Connections List - iOS Style */}
      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          {isLoadingConnections ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : safeConnections.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">No connections found</p>
            </div>
          ) : (
            <div className="px-4">
              {filteredConnections
                .filter(conn => !selectedGroupMembers.some(member => member.id === conn.otherUser.id))
                .map((connection, index) => (
                  <div 
                    key={connection.id}
                    className={`flex items-center py-3 ${index !== filteredConnections.length - 1 ? 'border-b border-muted/30' : ''}`}
                    onClick={() => {
                      setSelectedGroupMembers(prev => [...prev, connection.otherUser]);
                    }}
                  >
                    <div className="mr-3">
                      <Avatar className="h-11 w-11 rounded-full bg-muted/40">
                        {connection.otherUser.photo ? (
                          <AvatarImage src={connection.otherUser.photo} alt={connection.otherUser.fullName} />
                        ) : (
                          <AvatarFallback className="font-medium">{getInitials(connection.otherUser.fullName)}</AvatarFallback>
                        )}
                      </Avatar>
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-base">{connection.otherUser.fullName}</p>
                      <p className="text-sm text-muted-foreground truncate">
                        {connection.otherUser.title || "Tester"}
                      </p>
                    </div>
                    <button className="w-8 h-8 flex items-center justify-center rounded-full">
                      <Plus className="h-5 w-5 text-primary" />
                    </button>
                  </div>
                ))
              }
            </div>
          )}
        </ScrollArea>
      </div>
      
      {/* Debug Info */}
      <div className="container mx-auto px-4 py-2 border-t bg-background">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Current Session:</h3>
          <div className="bg-muted/30 px-3 py-1 rounded-md text-xs font-mono">
            User ID: {currentUser?.id} ({currentUser?.fullName})
          </div>
        </div>
      </div>
      
      {/* Debug Logs */}
      <div className="container mx-auto px-4 py-4 border-t bg-muted/20 max-h-40 overflow-y-auto">
        <h3 className="font-medium mb-2">Debug Logs:</h3>
        {debugLogs.length === 0 ? (
          <p className="text-muted-foreground text-sm">No logs yet</p>
        ) : (
          <div className="space-y-1 text-xs font-mono">
            {debugLogs.map((log, i) => (
              <div key={i} className="border-b border-muted/30 pb-1">{log}</div>
            ))}
          </div>
        )}
      </div>
      
      {/* Debug Actions */}
      <div className="container mx-auto px-4 py-2 border-t">
        <div className="flex gap-2">
          <Button onClick={handleCreateGroupChat} variant="default" className="flex-1">
            Use Mutation
          </Button>
          <Button onClick={sendDirectApiCall} variant="secondary" className="flex-1">
            Direct API Call
          </Button>
          <Button onClick={() => setDebugLogs([])} variant="outline" size="sm">
            Clear Logs
          </Button>
        </div>
      </div>
      
      {/* Message Input Field - iOS Style */}
      <div className="container mx-auto px-4 py-4 border-t">
        <form 
          onSubmit={(e) => {
            e.preventDefault();
            addLog("Form submitted");
            if (newMessage.trim() && selectedGroupMembers.length > 0) {
              addLog("Form validation passed");
              handleCreateGroupChat();
            } else {
              addLog(`Form validation failed: message='${newMessage.trim()}', members=${selectedGroupMembers.length}`);
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
        {/* iOS Home Indicator spacing */}
        <div className="h-6"></div>
      </div>
    </div>
  );
}