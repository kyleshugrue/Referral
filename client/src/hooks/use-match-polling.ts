import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

interface UseMatchPollingOptions {
  userId: number | undefined;
  enabled: boolean;
  onMatchesReady?: () => void;
}

const MAX_POLL_DURATION = 180000; // 3 minutes (match generation can take time)
const POLL_INTERVAL = 5000; // 5 seconds
const MAX_POLLS = MAX_POLL_DURATION / POLL_INTERVAL; // 36 polls

/**
 * Smart polling hook that checks for match generation completion
 * Polls every 5 seconds for up to 30 seconds after profile update
 */
export function useMatchPolling({ userId, enabled, onMatchesReady }: UseMatchPollingOptions) {
  const [isPolling, setIsPolling] = useState(false);
  const queryClient = useQueryClient();
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);
  const pollCountRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled || !userId) {
      return;
    }

    const startPolling = async () => {
      console.log('[Match Polling] Starting smart polling for user', userId);
      setIsPolling(true);
      startTimeRef.current = Date.now();
      pollCountRef.current = 0;

      const poll = async () => {
        pollCountRef.current += 1;
        const elapsed = Date.now() - startTimeRef.current;

        console.log(`[Match Polling] Poll #${pollCountRef.current} (${elapsed}ms elapsed)`);

        // Stop polling if max duration reached
        if (elapsed >= MAX_POLL_DURATION || pollCountRef.current > MAX_POLLS) {
          console.log('[Match Polling] Max duration reached, stopping polling');
          stopPolling();
          return;
        }

        try {
          // Check job status
          const response = await fetch(`/api/matches/job-status/${userId}`, {
            credentials: 'include'
          });

          if (response.ok) {
            const data = await response.json();
            console.log('[Match Polling] Job status:', data);

            if (data.status === 'completed' && data.matchCount > 0) {
              console.log('[Match Polling] Matches are ready! Invalidating queries...');
              
              // Invalidate queries to fetch fresh matches
              await queryClient.invalidateQueries({ queryKey: ["/api/matches/synergy"] });
              await queryClient.invalidateQueries({ queryKey: ["/api/matches"] });
              
              // Notify callback
              onMatchesReady?.();
              
              // Stop polling
              stopPolling();
              return;
            }
          }
        } catch (error) {
          console.error('[Match Polling] Error checking job status:', error);
        }
      };

      // Poll immediately, then every 5 seconds
      await poll();
      intervalRef.current = setInterval(poll, POLL_INTERVAL);
    };

    const stopPolling = () => {
      console.log('[Match Polling] Stopping polling');
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setIsPolling(false);
      pollCountRef.current = 0;
    };

    startPolling();

    // Cleanup on unmount or when enabled changes
    return () => {
      stopPolling();
    };
  }, [enabled, userId, queryClient, onMatchesReady]);

  return { isPolling };
}
