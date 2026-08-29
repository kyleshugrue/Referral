import { useEffect, useCallback, useSyncExternalStore } from 'react';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';

/**
 * Professional-grade iOS keyboard handling with FULL CONTROL positioning
 * 
 * KEY DESIGN PRINCIPLES (based on Bumble/Tinder patterns):
 * 1. DISABLE native iOS auto-scroll - we handle ALL positioning ourselves
 * 2. Wait for keyboard to FULLY appear (keyboardDidShow) before measuring
 * 3. Use visualViewport API for ACCURATE visible area measurements
 * 4. Use absolute scrollTo coordinates for PRECISE field placement
 * 5. ALWAYS scroll to target position - regardless of current field location
 * 
 * FIELD TYPES (set via data-keyboard-type attribute):
 * - "text": Standard text input, positioned at 30% of visible area
 * - "search-dropdown": Has dropdown below, positioned at 20% (upper area)
 * - "textarea": Long text, positioned at 30% for context visibility
 * - "number": Simple number input, positioned at 30%
 * - "location": Location search with autocomplete, positioned at 20%
 * 
 * Only activates on native iOS (web returns defaults)
 * SINGLETON: Only ONE set of listeners exists globally
 */

export type KeyboardFieldType = 'text' | 'search-dropdown' | 'textarea' | 'number' | 'location';

interface KeyboardPositionConfig {
  targetPosition: number;
}

/**
 * Position configs for different field types.
 * 
 * Target position is expressed as a fraction of the visible area (above keyboard).
 * 0.0 = top of visible area, 1.0 = just above keyboard
 * 
 * For consistency, most fields use 0.30 (30% from top).
 * Dropdown fields use 0.20 (20% from top) to show more suggestions below.
 */
const FIELD_POSITION_CONFIGS: Record<KeyboardFieldType, KeyboardPositionConfig> = {
  'text': { targetPosition: 0.30 },
  'search-dropdown': { targetPosition: 0.20 },
  'textarea': { targetPosition: 0.30 },
  'number': { targetPosition: 0.30 },
  'location': { targetPosition: 0.20 },
};

// Accessory toolbar height constant (standard iOS input accessory view is 44pt)
export const IOS_ACCESSORY_TOOLBAR_HEIGHT = 44;

interface UseIOSKeyboardProReturn {
  isNativeIOSApp: boolean;
  keyboardHeight: number;
  isKeyboardVisible: boolean;
  accessoryToolbarHeight: number;
  totalBottomInset: number;
  hideKeyboard: () => Promise<void>;
  scrollInputToCenter: (element: HTMLElement | null, fieldType?: KeyboardFieldType) => void;
  getFieldType: (element: HTMLElement | null) => KeyboardFieldType;
}

interface KeyboardState {
  isNativeIOSApp: boolean;
  keyboardHeight: number;
  isKeyboardVisible: boolean;
}

let globalKeyboardState: KeyboardState = {
  isNativeIOSApp: false,
  keyboardHeight: 0,
  isKeyboardVisible: false,
};

type Listener = () => void;
const listeners = new Set<Listener>();

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): KeyboardState {
  return globalKeyboardState;
}

function notifyListeners() {
  listeners.forEach(listener => listener());
}

function updateGlobalState(updates: Partial<KeyboardState>) {
  globalKeyboardState = { ...globalKeyboardState, ...updates };
  notifyListeners();
}

let listenersSetUp = false;
let instanceCount = 0;
let keyboardWillShowListener: PluginListenerHandle | null = null;
let keyboardDidShowListener: PluginListenerHandle | null = null;
let keyboardWillHideListener: PluginListenerHandle | null = null;
let keyboardDidHideListener: PluginListenerHandle | null = null;

function detectFieldType(element: HTMLElement | null): KeyboardFieldType {
  if (!element) return 'text';
  
  const dataType = element.getAttribute('data-keyboard-type') as KeyboardFieldType | null;
  if (dataType && FIELD_POSITION_CONFIGS[dataType]) {
    return dataType;
  }
  
  const parentWithType = element.closest('[data-keyboard-type]');
  if (parentWithType) {
    const parentType = parentWithType.getAttribute('data-keyboard-type') as KeyboardFieldType | null;
    if (parentType && FIELD_POSITION_CONFIGS[parentType]) {
      return parentType;
    }
  }
  
  if (element.tagName === 'TEXTAREA' || element.isContentEditable) {
    return 'textarea';
  }
  
  if (element instanceof HTMLInputElement) {
    if (element.type === 'number') {
      return 'number';
    }
    
    const hasDropdownParent = element.closest('[data-has-dropdown="true"]') !== null;
    const isSearchInput = element.classList.contains('search-input') || 
                          element.placeholder?.toLowerCase().includes('search');
    
    if (hasDropdownParent || isSearchInput) {
      return 'search-dropdown';
    }
  }
  
  return 'text';
}

/**
 * Get the actual visible viewport height using visualViewport API.
 * This accounts for the keyboard, URL bar, and other UI elements.
 * Falls back to window.innerHeight if visualViewport is not available.
 */
function getVisibleHeight(): number {
  if (window.visualViewport) {
    return window.visualViewport.height;
  }
  return window.innerHeight;
}

/**
 * Get the current scroll offset using visualViewport API.
 * This gives us the absolute page position of the visible area.
 */
function getPageTop(): number {
  if (window.visualViewport) {
    return window.visualViewport.pageTop;
  }
  return window.scrollY;
}

/**
 * ALWAYS scroll the focused field to the target position using ABSOLUTE coordinates.
 * 
 * This function:
 * 1. Uses visualViewport for accurate visible area measurements
 * 2. Calculates absolute scroll position (not relative delta)
 * 3. Always scrolls to target position regardless of current field location
 * 
 * The target position is typically around 30% from the top of the visible area,
 * giving room for the field label above and autocomplete/suggestions below.
 */
function scrollFieldToPosition(
  element: HTMLElement | null,
  fieldType: KeyboardFieldType
) {
  if (!element) return;
  
  const config = FIELD_POSITION_CONFIGS[fieldType];
  
  // Use visualViewport for accurate measurements AFTER keyboard is fully visible
  const visibleHeight = getVisibleHeight();
  const pageTop = getPageTop();
  
  // Get element's position relative to the document (not viewport)
  const rect = element.getBoundingClientRect();
  const elementPageTop = rect.top + pageTop;
  
  // Calculate where we want the field to be positioned (as absolute page coordinate)
  const targetOffsetFromTop = visibleHeight * config.targetPosition;
  const targetScrollY = elementPageTop - targetOffsetFromTop;
  
  console.log(`[useIOSKeyboardPro] === Positioning field type: ${fieldType} ===`);
  console.log(`[useIOSKeyboardPro] visualViewport.height: ${visibleHeight}`);
  console.log(`[useIOSKeyboardPro] visualViewport.pageTop: ${pageTop}`);
  console.log(`[useIOSKeyboardPro] Element rect.top (viewport): ${rect.top}`);
  console.log(`[useIOSKeyboardPro] Element pageTop (absolute): ${elementPageTop}`);
  console.log(`[useIOSKeyboardPro] Target offset from top: ${targetOffsetFromTop}`);
  console.log(`[useIOSKeyboardPro] Target scrollY: ${targetScrollY}`);
  console.log(`[useIOSKeyboardPro] Current window.scrollY: ${window.scrollY}`);
  
  // Use absolute scrollTo for precise positioning
  const scrollDelta = targetScrollY - window.scrollY;
  
  if (Math.abs(scrollDelta) > 5) {
    window.scrollTo({
      top: Math.max(0, targetScrollY),
      behavior: 'smooth'
    });
    console.log(`[useIOSKeyboardPro] Scrolling to ${targetScrollY}px (delta: ${scrollDelta}px)`);
  } else {
    console.log(`[useIOSKeyboardPro] Already at target position (within 5px)`);
  }
}

async function setupKeyboardListeners() {
  if (listenersSetUp) return;
  
  listenersSetUp = true;
  
  const isIOS = Capacitor.getPlatform() === 'ios' && Capacitor.isNativePlatform();
  updateGlobalState({ isNativeIOSApp: isIOS });

  if (!isIOS) {
    return;
  }

  document.body.classList.add('ios-capacitor-app');

  try {
    // CRITICAL: Disable native auto-scroll so we have FULL control
    // This prevents Safari's built-in scroll from competing with our positioning
    await Keyboard.setScroll({ isDisabled: true });
    await Keyboard.setAccessoryBarVisible({ isVisible: false });
    console.log('[useIOSKeyboardPro] iOS keyboard configured: native scroll DISABLED, full manual control');
  } catch (error) {
    console.log('[useIOSKeyboardPro] Configuration failed:', error);
  }

  // keyboardWillShow - update state and CSS variable immediately
  keyboardWillShowListener = await Keyboard.addListener('keyboardWillShow', (info) => {
    console.log('[useIOSKeyboardPro] keyboardWillShow, height:', info.keyboardHeight);
    
    updateGlobalState({
      keyboardHeight: info.keyboardHeight,
      isKeyboardVisible: true,
    });
    
    document.documentElement.style.setProperty('--ios-keyboard-height', `${info.keyboardHeight}px`);
    document.body.classList.add('ios-keyboard-visible');
  });

  // keyboardDidShow - AFTER keyboard is fully visible, do the scroll positioning
  // This is the KEY timing fix - we wait for keyboard animation to complete
  keyboardDidShowListener = await Keyboard.addListener('keyboardDidShow', () => {
    console.log('[useIOSKeyboardPro] keyboardDidShow - keyboard fully visible, positioning field');
    
    // Use requestAnimationFrame to ensure the layout has settled
    requestAnimationFrame(() => {
      const focusedElement = document.activeElement as HTMLElement;
      
      if (focusedElement && (
        focusedElement.tagName === 'INPUT' || 
        focusedElement.tagName === 'TEXTAREA' ||
        focusedElement.isContentEditable
      )) {
        const fieldType = detectFieldType(focusedElement);
        scrollFieldToPosition(focusedElement, fieldType);
      }
    });
  });

  keyboardWillHideListener = await Keyboard.addListener('keyboardWillHide', () => {
    console.log('[useIOSKeyboardPro] keyboardWillHide');
    document.body.classList.remove('ios-keyboard-visible');
  });

  keyboardDidHideListener = await Keyboard.addListener('keyboardDidHide', () => {
    console.log('[useIOSKeyboardPro] keyboardDidHide');
    
    updateGlobalState({
      isKeyboardVisible: false,
      keyboardHeight: 0,
    });
    
    document.documentElement.style.setProperty('--ios-keyboard-height', '0px');
  });
}

function cleanupKeyboardListeners() {
  if (!listenersSetUp) return;
  
  listenersSetUp = false;
  
  if (keyboardWillShowListener) {
    keyboardWillShowListener.remove();
    keyboardWillShowListener = null;
  }
  if (keyboardDidShowListener) {
    keyboardDidShowListener.remove();
    keyboardDidShowListener = null;
  }
  if (keyboardWillHideListener) {
    keyboardWillHideListener.remove();
    keyboardWillHideListener = null;
  }
  if (keyboardDidHideListener) {
    keyboardDidHideListener.remove();
    keyboardDidHideListener = null;
  }

  document.body.classList.remove('ios-capacitor-app');
  document.body.classList.remove('ios-keyboard-visible');
  document.documentElement.style.removeProperty('--ios-keyboard-height');
  
  updateGlobalState({
    isNativeIOSApp: false,
    keyboardHeight: 0,
    isKeyboardVisible: false,
  });
}

export function useIOSKeyboardPro(): UseIOSKeyboardProReturn {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  
  useEffect(() => {
    instanceCount++;
    
    if (instanceCount === 1) {
      setupKeyboardListeners();
    }

    return () => {
      instanceCount--;
      
      if (instanceCount === 0) {
        cleanupKeyboardListeners();
      }
    };
  }, []);

  const scrollInputToCenter = useCallback((element: HTMLElement | null, fieldType?: KeyboardFieldType) => {
    if (!state.isNativeIOSApp || !element) return;
    
    const resolvedType = fieldType || detectFieldType(element);
    scrollFieldToPosition(element, resolvedType);
  }, [state.isNativeIOSApp]);

  const getFieldType = useCallback((element: HTMLElement | null): KeyboardFieldType => {
    return detectFieldType(element);
  }, []);

  const hideKeyboard = useCallback(async (): Promise<void> => {
    if (!state.isNativeIOSApp) return;
    
    try {
      await Keyboard.hide();
    } catch (error) {
      console.log('[useIOSKeyboardPro] Failed to hide keyboard:', error);
    }
  }, [state.isNativeIOSApp]);

  // Calculate total bottom inset when keyboard is visible
  // This includes: keyboard height + accessory toolbar height
  const accessoryToolbarHeight = state.isKeyboardVisible ? IOS_ACCESSORY_TOOLBAR_HEIGHT : 0;
  const totalBottomInset = state.isKeyboardVisible 
    ? state.keyboardHeight + IOS_ACCESSORY_TOOLBAR_HEIGHT 
    : 0;

  return {
    isNativeIOSApp: state.isNativeIOSApp,
    keyboardHeight: state.keyboardHeight,
    isKeyboardVisible: state.isKeyboardVisible,
    accessoryToolbarHeight,
    totalBottomInset,
    hideKeyboard,
    scrollInputToCenter,
    getFieldType,
  };
}

export function useIOSKeyboardAware() {
  const keyboard = useIOSKeyboardPro();
  const {
    isNativeIOSApp,
    getFieldType,
    scrollInputToCenter,
  } = keyboard;
  
  const handleInputFocus = useCallback((e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (!isNativeIOSApp) return;
    
    const fieldType = getFieldType(e.target);
    scrollInputToCenter(e.target, fieldType);
  }, [isNativeIOSApp, scrollInputToCenter, getFieldType]);

  const createFocusHandler = useCallback((fieldType: KeyboardFieldType) => {
    return (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (!isNativeIOSApp) return;
      scrollInputToCenter(e.target, fieldType);
    };
  }, [isNativeIOSApp, scrollInputToCenter]);

  return {
    isNativeIOS: keyboard.isNativeIOSApp,
    ...keyboard,
    handleInputFocus,
    createFocusHandler,
  };
}
