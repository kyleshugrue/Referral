import { useCallback, useSyncExternalStore } from 'react';

const GENERATION_FLAG_KEY = 'synergyMatchesRefreshing';
const GENERATION_START_TIME_KEY = 'synergyMatchesRefreshingStartTime';
const FLAG_TIMEOUT_MS = 120000; // 2 minutes - match generation timeout

export interface UseMatchGenerationFlagResult {
  isGenerationFlagSet: boolean;
  clearFlag: () => void;
  setFlag: () => void;
}

function checkGenerationFlag(): boolean {
  try {
    const flagValue = localStorage.getItem(GENERATION_FLAG_KEY);
    
    if (flagValue !== 'true') {
      return false;
    }
    
    const startTimeStr = localStorage.getItem(GENERATION_START_TIME_KEY);
    if (startTimeStr) {
      const startTime = parseInt(startTimeStr, 10);
      const elapsed = Date.now() - startTime;
      
      if (elapsed > FLAG_TIMEOUT_MS) {
        console.log('[MatchGenerationFlag] Flag timed out after', elapsed, 'ms, clearing');
        localStorage.removeItem(GENERATION_FLAG_KEY);
        localStorage.removeItem(GENERATION_START_TIME_KEY);
        return false;
      }
    }
    
    return true;
  } catch (e) {
    console.error('[MatchGenerationFlag] Error checking flag:', e);
    return false;
  }
}

const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach(listener => listener());
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  
  const handleStorageChange = (e: StorageEvent) => {
    if (e.key === GENERATION_FLAG_KEY || e.key === GENERATION_START_TIME_KEY || e.key === null) {
      notifyListeners();
    }
  };
  
  const handleMatchesUpdated = () => {
    console.log('[MatchGenerationFlag] matchesUpdated event received, clearing flag');
    localStorage.removeItem(GENERATION_FLAG_KEY);
    localStorage.removeItem(GENERATION_START_TIME_KEY);
    notifyListeners();
  };
  
  window.addEventListener('storage', handleStorageChange);
  window.addEventListener('matchesUpdated', handleMatchesUpdated);
  
  const pollInterval = setInterval(() => {
    notifyListeners();
  }, 100);
  
  return () => {
    listeners.delete(callback);
    window.removeEventListener('storage', handleStorageChange);
    window.removeEventListener('matchesUpdated', handleMatchesUpdated);
    clearInterval(pollInterval);
  };
}

function getSnapshot(): boolean {
  return checkGenerationFlag();
}

function getServerSnapshot(): boolean {
  return false;
}

export function useMatchGenerationFlag(): UseMatchGenerationFlagResult {
  const isGenerationFlagSet = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  );

  const clearFlag = useCallback(() => {
    console.log('[MatchGenerationFlag] Clearing generation flag');
    localStorage.removeItem(GENERATION_FLAG_KEY);
    localStorage.removeItem(GENERATION_START_TIME_KEY);
    notifyListeners();
  }, []);

  const setFlag = useCallback(() => {
    console.log('[MatchGenerationFlag] Setting generation flag');
    localStorage.setItem(GENERATION_FLAG_KEY, 'true');
    localStorage.setItem(GENERATION_START_TIME_KEY, Date.now().toString());
    notifyListeners();
  }, []);

  return {
    isGenerationFlagSet,
    clearFlag,
    setFlag
  };
}

export function clearMatchGenerationFlag(): void {
  console.log('[MatchGenerationFlag] Clearing generation flag (static)');
  localStorage.removeItem(GENERATION_FLAG_KEY);
  localStorage.removeItem(GENERATION_START_TIME_KEY);
  notifyListeners();
}

export function setMatchGenerationFlag(): void {
  console.log('[MatchGenerationFlag] Setting generation flag (static)');
  localStorage.setItem(GENERATION_FLAG_KEY, 'true');
  localStorage.setItem(GENERATION_START_TIME_KEY, Date.now().toString());
  notifyListeners();
}

export function isMatchGenerationFlagSet(): boolean {
  return checkGenerationFlag();
}
