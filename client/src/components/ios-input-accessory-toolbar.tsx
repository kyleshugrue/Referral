import { useEffect, useState, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface IOSInputAccessoryToolbarProps {
  onPrevious?: () => void;
  onNext?: () => void;
  onDone?: () => void;
  canGoPrevious?: boolean;
  canGoNext?: boolean;
  className?: string;
  visible?: boolean;
  fieldLabel?: string;
  keyboardHeight?: number;
}

const isNativeIOS = () => 
  Capacitor.getPlatform() === 'ios' && Capacitor.isNativePlatform();

/**
 * Professional-grade iOS Input Accessory Toolbar
 * 
 * Mimics the native iOS keyboard accessory view with Previous/Next/Done buttons.
 * This is the standard pattern used in apps like Bumble, Tinder, and all
 * professional iOS applications with form inputs.
 * 
 * Features:
 * - Floats above keyboard with proper positioning
 * - Previous/Next arrows for field navigation
 * - Done button to dismiss keyboard
 * - Smooth animations matching native iOS timing
 * - Disabled state styling for first/last fields
 * 
 * IMPORTANT: This component receives keyboard visibility and height from its parent
 * via props (from useIOSKeyboardPro) to maintain a single source of truth for
 * keyboard state across the application.
 */
export function IOSInputAccessoryToolbar({
  onPrevious,
  onNext,
  onDone,
  canGoPrevious = true,
  canGoNext = true,
  className = '',
  visible = false,
  fieldLabel,
  keyboardHeight = 0,
}: IOSInputAccessoryToolbarProps) {
  const [isNative, setIsNative] = useState(false);

  useEffect(() => {
    setIsNative(isNativeIOS());
  }, []);

  const handleDone = useCallback(async () => {
    if (onDone) {
      onDone();
    } else {
      try {
        await Keyboard.hide();
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
      } catch (e) {
        console.log('[IOSInputAccessoryToolbar] Failed to hide keyboard:', e);
      }
    }
  }, [onDone]);

  const handlePrevious = useCallback(() => {
    if (canGoPrevious && onPrevious) {
      onPrevious();
    }
  }, [canGoPrevious, onPrevious]);

  const handleNext = useCallback(() => {
    if (canGoNext && onNext) {
      onNext();
    }
  }, [canGoNext, onNext]);

  if (!isNative) {
    return null;
  }

  const shouldShow = visible;

  return (
    <div
      className={cn(
        'ios-input-accessory-toolbar',
        shouldShow && 'visible',
        className
      )}
      style={{
        bottom: shouldShow ? `${keyboardHeight}px` : '-44px',
      }}
      data-testid="ios-input-accessory-toolbar"
    >
      <div className="ios-accessory-toolbar-content">
        <div className="ios-accessory-nav-buttons">
          <button
            type="button"
            onClick={handlePrevious}
            disabled={!canGoPrevious}
            className={cn(
              'ios-accessory-nav-btn',
              !canGoPrevious && 'disabled'
            )}
            aria-label="Previous field"
            data-testid="ios-accessory-previous"
          >
            <ChevronUp className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={handleNext}
            disabled={!canGoNext}
            className={cn(
              'ios-accessory-nav-btn',
              !canGoNext && 'disabled'
            )}
            aria-label="Next field"
            data-testid="ios-accessory-next"
          >
            <ChevronDown className="w-5 h-5" />
          </button>
        </div>

        {fieldLabel && (
          <span className="ios-accessory-field-label">{fieldLabel}</span>
        )}

        <button
          type="button"
          onClick={handleDone}
          className="ios-accessory-done-btn"
          data-testid="ios-accessory-done"
        >
          Done
        </button>
      </div>
    </div>
  );
}

export default IOSInputAccessoryToolbar;
