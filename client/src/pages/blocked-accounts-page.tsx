import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { User, UserBlock } from "@shared/schema";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import ProfileDialog from "@/components/profile-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { getInitials } from "@/lib/avatar-utils";

type BlockedUserWithProfile = UserBlock & { blockedUser: User };

export default function BlockedAccountsPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedProfile, setSelectedProfile] = useState<User | null>(null);

  // Scroll to top when component mounts
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Fetch blocked users
  const { 
    data: blockedUsers, 
    isLoading, 
    error
  } = useQuery<BlockedUserWithProfile[]>({
    queryKey: ["/api/users/blocked"],
    refetchOnWindowFocus: false,
    staleTime: 30000 // 30 seconds
  });
  
  // Log the query results
  useEffect(() => {
    if (blockedUsers) {
      console.log("Blocked users fetched successfully:", blockedUsers);
    }
    if (error) {
      console.error("Error fetching blocked users:", error);
    }
  }, [blockedUsers, error]);

  // Unblock user mutation
  const unblockMutation = useMutation({
    mutationFn: async (blockedUserId: number) => {
      const response = await apiRequest("DELETE", `/api/users/block/${blockedUserId}`);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to unblock user");
      }
      return { success: true };
    },
    onSuccess: () => {
      // Invalidate affected queries
      queryClient.invalidateQueries({ queryKey: ["/api/users/blocked"] });
      queryClient.invalidateQueries({ queryKey: ["/api/connections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/network/potential"] });
      
      toast({
        title: "User Unblocked",
        description: "User has been unblocked successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to unblock user",
        variant: "destructive",
      });
    }
  });

  const handleUnblock = (blockedUserId: number) => {
    unblockMutation.mutate(blockedUserId);
  };

  const handleViewProfile = (user: User) => {
    setSelectedProfile(user);
  };

  return (
    <div className="min-h-[100dvh] bg-background pb-32">
      <div className="px-4">
        <div className="flex items-center justify-between pt-4 [transition:none!important]">
          <button
            className="flex items-center justify-center text-[hsl(215, 25%, 27%)] rounded-full p-2 [transition:none!important] focus:outline-none"
            onClick={() => setLocation('/settings')}
          >
            <ChevronLeft className="h-5 w-5 [transition:none!important]" />
          </button>
          <h1 className="text-xl font-bold flex-1 text-center mr-9" style={{ color: 'hsl(215, 25%, 27%)' }}>
            Blocked Accounts
          </h1>
        </div>

        <div className="max-w-2xl mx-auto">
          <div className="p-6 rounded-lg">
            
            {isLoading ? (
              // Skeleton loading UI
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center gap-3">
                      <Skeleton className="h-12 w-12 rounded-full" />
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-40" />
                        <Skeleton className="h-4 w-24" />
                      </div>
                    </div>
                    <Skeleton className="h-9 w-24" />
                  </div>
                ))}
              </div>
            ) : error ? (
              <div className="text-center py-8">
                <p className="text-red-500">Error loading blocked accounts</p>
                <p className="text-sm text-muted-foreground mt-2">{error instanceof Error ? error.message : 'Unknown error'}</p>
                <pre className="text-xs text-muted-foreground mt-2 bg-gray-100 p-2 rounded overflow-auto max-w-full">
                  {JSON.stringify(error, null, 2)}
                </pre>
              </div>
            ) : blockedUsers && blockedUsers.length > 0 ? (
              <div className="space-y-4">
                {blockedUsers.map((blockedUser) => (
                  <div key={blockedUser.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div 
                      className="flex items-center gap-3 cursor-pointer" 
                      onClick={() => handleViewProfile(blockedUser.blockedUser)}
                    >
                      <div className="h-12 w-12 rounded-full overflow-hidden">
                        {blockedUser.blockedUser.photo ? (
                          <img 
                            src={blockedUser.blockedUser.photo} 
                            alt={blockedUser.blockedUser.fullName}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="h-full w-full flex items-center justify-center text-primary text-xl font-semibold bg-primary/10">
                            {getInitials(blockedUser.blockedUser.fullName)}
                          </div>
                        )}
                      </div>
                      <div>
                        <h3 className="font-medium">{blockedUser.blockedUser.fullName}</h3>
                        <p className="text-sm text-muted-foreground">
                          {blockedUser.blockedUser.title || "No title"}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleUnblock(blockedUser.blockedUserId)}
                      disabled={unblockMutation.isPending}
                    >
                      Unblock
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-muted-foreground">You haven't blocked anyone yet.</p>
                <p className="text-sm text-muted-foreground mt-2">
                  If you block a user, they will appear here and will not show up in your network.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Profile dialog */}
      {selectedProfile && (
        <ProfileDialog
          profile={selectedProfile}
          open={!!selectedProfile}
          onOpenChange={(open) => !open && setSelectedProfile(null)}
        />
      )}
    </div>
  );
}