import { useRef, useCallback, useState, useEffect, useMemo } from 'react';
import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';

interface FieldInfo {
  id: string;
  element: HTMLElement | null;
  label?: string;
  type: 'input' | 'textarea' | 'select' | 'searchable-select';
  order: number;
}

interface UseIOSFieldNavigationOptions {
  onFieldChange?: (fieldId: string, fieldIndex: number) => void;
  enabled?: boolean;
  scrollInputToCenter?: (element: HTMLElement | null) => void;
  isKeyboardVisible?: boolean;
}

interface UseIOSFieldNavigationReturn {
  registerField: (id: string, element: HTMLElement | null, options?: Partial<FieldInfo>) => (() => void) | undefined;
  unregisterField: (id: string) => void;
  clearAllFields: () => void;
  focusField: (id: string) => void;
  focusPrevious: () => void;
  focusNext: () => void;
  dismissKeyboard: () => Promise<void>;
  currentFieldId: string | null;
  currentFieldIndex: number;
  totalFields: number;
  canGoPrevious: boolean;
  canGoNext: boolean;
  isNativeIOS: boolean;
  getFieldLabel: (id: string) => string | undefined;
}

const isNativeIOS = () =>
  Capacitor.getPlatform() === 'ios' && Capacitor.isNativePlatform();

/**
 * Professional-grade iOS Field Navigation Hook
 * 
 * This hook manages form field navigation for iOS Capacitor apps,
 * implementing the same patterns used by Bumble, Tinder, and other
 * professional apps:
 * 
 * 1. Tracks all registered form fields in order
 * 2. Enables Previous/Next navigation between fields
 * 3. Handles keyboard dismissal
 * 4. Provides state for accessory toolbar (current position, can navigate)
 * 
 * IMPORTANT: This hook returns a stable memoized object to prevent
 * unnecessary re-renders in consuming components.
 */
export function useIOSFieldNavigation(
  options: UseIOSFieldNavigationOptions = {}
): UseIOSFieldNavigationReturn {
  const { onFieldChange, enabled = true, scrollInputToCenter, isKeyboardVisible } = options;
  
  const [isNative, setIsNative] = useState(false);
  const [currentFieldId, setCurrentFieldId] = useState<string | null>(null);
  const fieldsRef = useRef<Map<string, FieldInfo>>(new Map());
  const listenersRef = useRef<Map<string, { focus: () => void; blur: () => void }>>(new Map());
  const [fieldVersion, setFieldVersion] = useState(0);
  
  // Refs for stable access to options in event handlers
  const scrollInputToCenterRef = useRef(scrollInputToCenter);
  const isKeyboardVisibleRef = useRef(isKeyboardVisible);
  scrollInputToCenterRef.current = scrollInputToCenter;
  isKeyboardVisibleRef.current = isKeyboardVisible;

  useEffect(() => {
    setIsNative(isNativeIOS());
  }, []);

  const sortedFields = useMemo(() => {
    const fields = fieldVersion >= 0 ? Array.from(fieldsRef.current.values()) : [];
    return fields.sort((a, b) => a.order - b.order);
  }, [fieldVersion]);

  const currentFieldIndex = useMemo(() => {
    if (!currentFieldId) return -1;
    return sortedFields.findIndex(f => f.id === currentFieldId);
  }, [sortedFields, currentFieldId]);

  const canGoPrevious = currentFieldIndex > 0;
  const canGoNext = currentFieldIndex >= 0 && currentFieldIndex < sortedFields.length - 1;

  const unregisterField = useCallback((id: string) => {
    const existingListeners = listenersRef.current.get(id);
    const field = fieldsRef.current.get(id);
    
    if (existingListeners && field?.element) {
      field.element.removeEventListener('focus', existingListeners.focus, true);
      field.element.removeEventListener('blur', existingListeners.blur, true);
    }
    
    listenersRef.current.delete(id);
    fieldsRef.current.delete(id);
    setFieldVersion(v => v + 1);
  }, []);

  const clearAllFields = useCallback(() => {
    listenersRef.current.forEach((listeners, id) => {
      const field = fieldsRef.current.get(id);
      if (field?.element) {
        field.element.removeEventListener('focus', listeners.focus, true);
        field.element.removeEventListener('blur', listeners.blur, true);
      }
    });
    
    listenersRef.current.clear();
    fieldsRef.current.clear();
    setCurrentFieldId(null);
    setFieldVersion(v => v + 1);
  }, []);

  const registerField = useCallback((
    id: string,
    element: HTMLElement | null,
    fieldOptions: Partial<FieldInfo> = {}
  ): (() => void) | undefined => {
    if (!element) {
      unregisterField(id);
      return undefined;
    }

    unregisterField(id);

    const newOrder = fieldOptions.order ?? fieldsRef.current.size;
    
    fieldsRef.current.set(id, {
      id,
      element,
      label: fieldOptions.label,
      type: fieldOptions.type || 'input',
      order: newOrder,
    });

    const handleFocus = () => {
      setCurrentFieldId(id);
      const index = Array.from(fieldsRef.current.values())
        .sort((a, b) => a.order - b.order)
        .findIndex(f => f.id === id);
      onFieldChange?.(id, index);
      
      // Auto-scroll to field when focused while keyboard is already visible
      // Uses requestAnimationFrame to ensure layout is settled
      if (scrollInputToCenterRef.current && isKeyboardVisibleRef.current) {
        requestAnimationFrame(() => {
          scrollInputToCenterRef.current?.(element);
        });
      }
    };

    const handleBlur = () => {
      setTimeout(() => {
        const activeElement = document.activeElement;
        const isStillInForm = Array.from(fieldsRef.current.values())
          .some(f => f.element === activeElement || f.element?.contains(activeElement as Node));
        
        if (!isStillInForm) {
          setCurrentFieldId(null);
        }
      }, 100);
    };

    element.addEventListener('focus', handleFocus, true);
    element.addEventListener('blur', handleBlur, true);

    listenersRef.current.set(id, { focus: handleFocus, blur: handleBlur });

    setFieldVersion(v => v + 1);

    return () => {
      unregisterField(id);
    };
  }, [onFieldChange, unregisterField]);

  const focusField = useCallback((id: string) => {
    const field = fieldsRef.current.get(id);
    if (field?.element) {
      const input = field.element.querySelector('input, textarea') || field.element;
      if (input instanceof HTMLElement) {
        input.focus();
      }
    }
  }, []);

  const focusPrevious = useCallback(() => {
    if (currentFieldIndex <= 0) return;
    
    const previousField = sortedFields[currentFieldIndex - 1];
    if (previousField) {
      focusField(previousField.id);
    }
  }, [currentFieldIndex, sortedFields, focusField]);

  const focusNext = useCallback(() => {
    if (currentFieldIndex < 0 || currentFieldIndex >= sortedFields.length - 1) return;
    
    const nextField = sortedFields[currentFieldIndex + 1];
    if (nextField) {
      focusField(nextField.id);
    }
  }, [currentFieldIndex, sortedFields, focusField]);

  const dismissKeyboard = useCallback(async () => {
    if (isNative) {
      try {
        await Keyboard.hide();
      } catch (e) {
        console.log('[useIOSFieldNavigation] Failed to hide keyboard:', e);
      }
    }
    
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    
    setCurrentFieldId(null);
  }, [isNative]);

  const getFieldLabel = useCallback((id: string): string | undefined => {
    return fieldsRef.current.get(id)?.label;
  }, []);

  useEffect(() => {
    if (!enabled || !isNative) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && currentFieldId) {
        const currentField = fieldsRef.current.get(currentFieldId);
        
        if (currentField?.type !== 'textarea') {
          e.preventDefault();
          
          if (canGoNext) {
            focusNext();
          } else {
            dismissKeyboard();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [enabled, isNative, currentFieldId, canGoNext, focusNext, dismissKeyboard]);

  return useMemo(() => ({
    registerField,
    unregisterField,
    clearAllFields,
    focusField,
    focusPrevious,
    focusNext,
    dismissKeyboard,
    currentFieldId,
    currentFieldIndex,
    totalFields: sortedFields.length,
    canGoPrevious,
    canGoNext,
    isNativeIOS: isNative,
    getFieldLabel,
  }), [
    registerField,
    unregisterField,
    clearAllFields,
    focusField,
    focusPrevious,
    focusNext,
    dismissKeyboard,
    currentFieldId,
    currentFieldIndex,
    sortedFields.length,
    canGoPrevious,
    canGoNext,
    isNative,
    getFieldLabel,
  ]);
}

export default useIOSFieldNavigation;
