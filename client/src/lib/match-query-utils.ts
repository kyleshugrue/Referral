import { QueryClient } from '@tanstack/react-query';
import type { User } from '@shared/schema';

interface MatchWithDescription extends User {
  matchDescription?: string;
  matchScore?: number;
  matchReasons?: string[];
  jobTitle?: string;
  location?: string;
}

interface MatchesResponse {
  matches: MatchWithDescription[];
  apiConnectionIssue: boolean;
}

interface PendingResponse {
  pending: true;
  reason: string;
  message: string;
}

type MatchesOrPendingResponse = MatchesResponse | PendingResponse;

export const MATCHES_QUERY_KEY = ['/api/matches/synergy'] as const;

export function isPendingResponse(data: MatchesOrPendingResponse | undefined): data is PendingResponse {
  return data !== undefined && 'pending' in data && data.pending === true;
}

export function isMatchesResponse(data: MatchesOrPendingResponse | undefined): data is MatchesResponse {
  return data !== undefined && 'matches' in data;
}

export function getCachedMatches(queryClient: QueryClient): MatchWithDescription[] | null {
  const cachedData = queryClient.getQueryData<MatchesOrPendingResponse>(MATCHES_QUERY_KEY);
  
  if (cachedData && isMatchesResponse(cachedData) && cachedData.matches.length > 0) {
    return cachedData.matches;
  }
  
  return null;
}

export function hasCachedMatches(queryClient: QueryClient): boolean {
  const cached = getCachedMatches(queryClient);
  return cached !== null && cached.length > 0;
}

export interface MatchQueryState {
  isLoading: boolean;
  isFetching: boolean;
  data: MatchesOrPendingResponse | undefined;
  isError: boolean;
}

export interface MatchDisplayState {
  shouldShowGenerating: boolean;
  shouldShowMatches: boolean;
  shouldShowError: boolean;
  shouldShowEmpty: boolean;
  isBackendGenerating: boolean;
  cachedMatches: MatchWithDescription[] | null;
  currentMatches: MatchWithDescription[];
}

export interface MatchDisplayOptions {
  isGenerationFlagSet?: boolean;
}

export function getMatchDisplayState(
  queryClient: QueryClient,
  queryState: MatchQueryState,
  options: MatchDisplayOptions = {}
): MatchDisplayState {
  const { isLoading, isFetching, data, isError } = queryState;
  const { isGenerationFlagSet = false } = options;
  
  const cachedMatches = getCachedMatches(queryClient);
  const hasCached = cachedMatches !== null && cachedMatches.length > 0;
  
  const isBackendGenerating = isPendingResponse(data);
  
  const currentMatches = isMatchesResponse(data) ? data.matches : [];
  const hasCurrentMatches = currentMatches.length > 0;
  
  // CRITICAL FIX: Generation flag from localStorage takes HIGHEST PRIORITY
  // This prevents stale cached matches from flashing before the refetch completes
  // 
  // Priority order for showing generating state:
  // 1. localStorage flag is set (isGenerationFlagSet) - IMMEDIATE, no waiting for refetch
  // 2. Backend explicitly returns pending:true (match generation in progress)
  // 3. Initial loading with no data available
  //
  // The localStorage flag is set when profile is edited and cleared when:
  // - Backend returns non-pending response (generation complete)
  // - WebSocket matchesUpdated/matchRefresh event received
  const shouldShowGenerating = isGenerationFlagSet || isBackendGenerating || isLoading;
  
  // Show matches when:
  // 1. Not error
  // 2. Generation flag is NOT set (localStorage)
  // 3. Backend is NOT generating (pending:true)
  // 4. Not initial loading
  // 5. Have current matches from response, OR have cached matches during background refetch
  const shouldShowMatches = 
    !isError && 
    !isGenerationFlagSet &&
    !isBackendGenerating &&
    !isLoading &&
    (hasCurrentMatches || (isFetching && hasCached));
  
  const shouldShowError = isError && !isLoading && !isGenerationFlagSet;
  
  // Show empty state ONLY when:
  // 1. Not in error state
  // 2. Generation flag is NOT set
  // 3. Backend is NOT generating (not pending:true)
  // 4. Not loading/fetching
  // 5. Response contains 0 matches (generation completed with no results)
  // 6. No cached matches either
  const shouldShowEmpty = 
    !isError && 
    !isGenerationFlagSet &&
    !isBackendGenerating &&
    !isLoading &&
    !isFetching &&
    !hasCurrentMatches &&
    !hasCached;
  
  // Determine which matches to show
  // When generation is in progress (flag set OR backend pending), return empty to force generating UI
  const generationInProgress = isGenerationFlagSet || isBackendGenerating;
  
  return {
    shouldShowGenerating,
    shouldShowMatches,
    shouldShowError,
    shouldShowEmpty,
    isBackendGenerating,
    cachedMatches,
    currentMatches: generationInProgress ? [] : (hasCurrentMatches ? currentMatches : (cachedMatches || []))
  };
}

export function getMatchesToDisplay(
  queryClient: QueryClient,
  queryState: MatchQueryState,
  options: MatchDisplayOptions = {}
): MatchWithDescription[] {
  const { data, isFetching } = queryState;
  const { isGenerationFlagSet = false } = options;
  
  // When generation flag is set OR backend returns pending:true, don't show any matches
  // This ensures the generating state is shown consistently during match generation
  if (isGenerationFlagSet || isPendingResponse(data)) {
    return [];
  }
  
  // Return current matches if available from response
  if (isMatchesResponse(data) && data.matches.length > 0) {
    return data.matches;
  }
  
  // During background refetch (stale-while-revalidate), show cached matches
  // Note: We've already checked that generation is NOT in progress above
  if (isFetching) {
    const cached = getCachedMatches(queryClient);
    if (cached) {
      return cached;
    }
  }
  
  return [];
}
