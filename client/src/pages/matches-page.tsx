import { useQuery } from "@tanstack/react-query";
import { type User } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MessageSquare, AlertCircle, RefreshCw } from "lucide-react";
import ProtectedLayout from "@/components/protected-layout";
import { Loader2 } from "lucide-react";
import { useEffect, useState, useRef } from "react";
import { useGlobalWebSocket } from "@/hooks/use-global-websocket";

interface MatchWithDescription extends User {
  matchDescription?: string;
  matchScore?: number;
  matchReasons?: string[];
}

interface MatchesResponse {
  matches: MatchWithDescription[];
  apiConnectionIssue: boolean;
  pending?: boolean;
  reason?: string;
  message?: string;
}

const LOADING_TIMEOUT_MS = 90000;

export default function MatchesPage() {
  const { isConnected } = useGlobalWebSocket();
  const [hasTimedOut, setHasTimedOut] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingStartTimeRef = useRef<number | null>(null);

  const { data, isLoading: isLoadingMatches, refetch, isFetching } = useQuery<MatchesResponse>({
    queryKey: ["/api/matches/synergy"],
    refetchOnMount: true,
    staleTime: 60000,
    refetchOnWindowFocus: true,
  });

  const matches = data?.matches || [];
  const isPending = data?.pending || false;
  const pendingMessage = data?.message || 'Generating your matches...';

  useEffect(() => {
    console.log('[Matches Page] WebSocket connection status:', isConnected ? 'CONNECTED' : 'DISCONNECTED');
  }, [isConnected]);

  useEffect(() => {
    if (isPending && !hasTimedOut) {
      if (!pendingStartTimeRef.current) {
        const storedStartTime = localStorage.getItem('synergyMatchesRefreshingStartTime');
        pendingStartTimeRef.current = storedStartTime ? parseInt(storedStartTime, 10) : Date.now();
        console.log('[Matches Page] Pending state started at:', pendingStartTimeRef.current);
      }

      const elapsed = Date.now() - pendingStartTimeRef.current;
      const remainingTime = LOADING_TIMEOUT_MS - elapsed;

      if (remainingTime <= 0) {
        console.log('[Matches Page] Already exceeded timeout, showing timeout state');
        setHasTimedOut(true);
        localStorage.removeItem('synergyMatchesRefreshing');
        localStorage.removeItem('synergyMatchesRefreshingStartTime');
        return;
      }

      console.log(`[Matches Page] Setting ${Math.round(remainingTime / 1000)}s timeout for loading state`);
      
      timeoutRef.current = setTimeout(() => {
        console.log('[Matches Page] Loading timeout exceeded (90s), showing timeout state');
        setHasTimedOut(true);
        localStorage.removeItem('synergyMatchesRefreshing');
        localStorage.removeItem('synergyMatchesRefreshingStartTime');
      }, remainingTime);

      return () => {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
      };
    }
  }, [isPending, hasTimedOut]);

  useEffect(() => {
    if (!isPending && !isLoadingMatches && matches.length >= 0) {
      console.log('[Matches Page] Matches loaded successfully, cleaning up flags');
      localStorage.removeItem('synergyMatchesRefreshing');
      localStorage.removeItem('synergyMatchesRefreshingStartTime');
      pendingStartTimeRef.current = null;
      
      if (hasTimedOut) {
        setHasTimedOut(false);
      }
    }
  }, [isPending, isLoadingMatches, matches.length, hasTimedOut]);

  useEffect(() => {
    if (!isPending) {
      return;
    }

    console.log('[Matches Page] Matches are pending, starting fallback polling...');
    
    const pollInterval = setInterval(() => {
      if (!hasTimedOut) {
        console.log('[Matches Page] Fallback poll for match updates...');
        refetch();
      }
    }, 5000);

    return () => {
      console.log('[Matches Page] Stopping fallback polling');
      clearInterval(pollInterval);
    };
  }, [isPending, refetch, hasTimedOut]);

  useEffect(() => {
    const handleMatchesUpdated = () => {
      console.log('[Matches Page] Received matchesUpdated event from WebSocket - refreshing immediately');
      setHasTimedOut(false);
      pendingStartTimeRef.current = null;
      refetch();
    };

    window.addEventListener('matchesUpdated', handleMatchesUpdated);

    return () => {
      window.removeEventListener('matchesUpdated', handleMatchesUpdated);
    };
  }, [refetch]);

  const handleRetry = () => {
    console.log('[Matches Page] User clicked retry, resetting timeout and refetching');
    setHasTimedOut(false);
    pendingStartTimeRef.current = Date.now();
    localStorage.setItem('synergyMatchesRefreshingStartTime', Date.now().toString());
    refetch();
  };

  if (hasTimedOut) {
    return (
      <ProtectedLayout>
        <div className="flex flex-col items-center justify-center min-h-[100dvh] px-4">
          <AlertCircle className="h-12 w-12 text-amber-500 mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            Taking longer than expected
          </h2>
          <p className="text-gray-600 text-center mb-6 max-w-md">
            Your matches are still being generated. This can happen when our AI is processing complex profiles.
          </p>
          <div className="flex gap-3">
            <Button 
              onClick={handleRetry}
              disabled={isFetching}
              className="gap-2"
              data-testid="button-retry-matches"
            >
              {isFetching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Try Again
            </Button>
          </div>
          {matches.length > 0 && (
            <div className="mt-8 w-full max-w-4xl">
              <p className="text-sm text-gray-500 mb-4">
                Here are your previously generated matches:
              </p>
              <div className="space-y-4">
                {matches.map((match) => (
                  <Card key={match.id}>
                    <CardContent className="p-4 sm:p-6">
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 sm:gap-0">
                        <div className="flex items-center gap-3 sm:gap-4">
                          <div className="h-12 w-12 rounded-full overflow-hidden flex-shrink-0">
                            <img
                              src={match.photo}
                              alt={match.fullName}
                              className="h-full w-full object-cover"
                            />
                          </div>
                          <div className="min-w-0">
                            <h3 className="font-semibold text-base sm:text-lg truncate">
                              {match.fullName}
                            </h3>
                            <p className="text-xs sm:text-sm text-gray-500 truncate">
                              {match.currentCompany} • {match.industry}
                            </p>
                          </div>
                        </div>
                        <Button size="sm" className="w-full sm:w-auto gap-2" data-testid={`button-message-${match.id}`}>
                          <MessageSquare className="h-4 w-4" />
                          Message
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      </ProtectedLayout>
    );
  }

  if (isLoadingMatches || isPending) {
    return (
      <ProtectedLayout>
        <div className="flex flex-col items-center justify-center min-h-[100dvh] px-4">
          <Loader2 className="h-8 w-8 sm:h-12 sm:w-12 animate-spin mb-4" />
          <p className="text-base sm:text-lg text-gray-600">{pendingMessage}</p>
        </div>
      </ProtectedLayout>
    );
  }

  return (
    <ProtectedLayout>
      <div className="max-w-4xl mx-auto pt-20 pb-6 sm:pb-12 px-4">
        <h1 className="text-2xl sm:text-3xl font-bold mb-6 sm:mb-8" style={{ color: 'hsl(215, 25%, 27%)' }}>Your Matches</h1>

        <div className="space-y-4 sm:space-y-6">
          {matches.length > 0 ? (
            matches.map((match) => (
              <Card key={match.id} data-testid={`card-match-${match.id}`}>
                <CardContent className="p-4 sm:p-6">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 sm:gap-0">
                    <div className="flex items-center gap-3 sm:gap-4">
                      <div className="h-12 w-12 rounded-full overflow-hidden flex-shrink-0">
                        <img
                          src={match.photo}
                          alt={match.fullName}
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-base sm:text-lg truncate" data-testid={`text-match-name-${match.id}`}>
                          {match.fullName}
                        </h3>
                        <p className="text-xs sm:text-sm text-gray-500 truncate" data-testid={`text-match-info-${match.id}`}>
                          {match.currentCompany} • {match.industry}
                        </p>
                      </div>
                    </div>
                    <Button size="sm" className="w-full sm:w-auto gap-2" data-testid={`button-message-${match.id}`}>
                      <MessageSquare className="h-4 w-4" />
                      Message
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          ) : (
            <div className="text-center py-8 sm:py-12" data-testid="text-no-matches">
              <h2 className="text-xl sm:text-2xl font-semibold text-gray-900 mb-2">
                No matches yet
              </h2>
              <p className="text-sm sm:text-base text-gray-500">
                Complete your profile to start getting matched with other professionals
              </p>
            </div>
          )}
        </div>
      </div>
    </ProtectedLayout>
  );
}
