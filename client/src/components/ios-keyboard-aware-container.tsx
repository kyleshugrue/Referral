import { useEffect, useRef, ReactNode, forwardRef } from 'react';
import { useIOSKeyboardPro } from '@/hooks/use-ios-keyboard-pro';

interface IOSKeyboardAwareContainerProps {
  children: ReactNode;
  className?: string;
  enabled?: boolean;
  onKeyboardShow?: (height: number) => void;
  onKeyboardHide?: () => void;
}

/**
 * Scroll-preserving keyboard-aware container
 * Uses padding-based approach instead of transforms to preserve native scroll behavior
 */
export const IOSKeyboardAwareContainer = forwardRef<HTMLDivElement, IOSKeyboardAwareContainerProps>(({
  children,
  className = '',
  enabled = true,
  onKeyboardShow,
  onKeyboardHide,
}, ref) => {
  const internalRef = useRef<HTMLDivElement>(null);
  const containerRef = (ref as React.RefObject<HTMLDivElement>) || internalRef;
  
  const { isNativeIOSApp, keyboardHeight, isKeyboardVisible } = useIOSKeyboardPro();
  
  const isActive = enabled && isNativeIOSApp;

  useEffect(() => {
    if (!isActive) return;
    
    if (isKeyboardVisible && keyboardHeight > 0) {
      onKeyboardShow?.(keyboardHeight);
    } else if (!isKeyboardVisible) {
      onKeyboardHide?.();
    }
  }, [isActive, isKeyboardVisible, keyboardHeight, onKeyboardShow, onKeyboardHide]);

  // When not active (not on iOS or disabled), render children directly without extra wrapper
  if (!isActive) {
    if (className) {
      return (
        <div ref={containerRef} className={className}>
          {children}
        </div>
      );
    }
    return <>{children}</>;
  }

  return (
    <div
      ref={containerRef}
      className={`ios-keyboard-aware-container ${isKeyboardVisible ? 'ios-keyboard-active' : ''} ${className}`}
    >
      {children}
    </div>
  );
});

IOSKeyboardAwareContainer.displayName = 'IOSKeyboardAwareContainer';

interface IOSKeyboardAwareScrollViewProps {
  children: ReactNode;
  className?: string;
  enabled?: boolean;
  contentClassName?: string;
  paddingBottom?: number;
  accessoryToolbarHeight?: number;
}

/**
 * Scroll view that automatically adjusts padding when keyboard is visible
 * Uses native scrollIntoView for centering focused elements
 * 
 * When keyboard is visible, the padding accounts for:
 * - Keyboard height
 * - Accessory toolbar height (Previous/Next/Done - 44px)
 * - Base padding
 * 
 * Note: Save toolbar padding is NOT included here because the save toolbar
 * positions itself absolutely above the accessory toolbar. The scroll view
 * only needs to account for the keyboard and accessory toolbar.
 */
export function IOSKeyboardAwareScrollView({
  children,
  className = '',
  enabled = true,
  contentClassName = '',
  paddingBottom = 100,
  accessoryToolbarHeight = 44,
}: IOSKeyboardAwareScrollViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { isNativeIOSApp, keyboardHeight, isKeyboardVisible } = useIOSKeyboardPro();
  
  const isActive = enabled && isNativeIOSApp;

  // When keyboard is visible, add extra padding for accessory toolbar above keyboard
  // The save toolbar floats above content so doesn't need additional scroll padding
  const keyboardBottomPadding = isActive && isKeyboardVisible 
    ? keyboardHeight + accessoryToolbarHeight + paddingBottom
    : paddingBottom;

  const containerStyle = {
    paddingBottom: `${keyboardBottomPadding}px`,
    transition: 'padding-bottom 280ms cubic-bezier(0.32, 0, 0.68, 1)',
  };

  return (
    <div
      ref={scrollRef}
      className={`ios-keyboard-scroll-view overflow-auto ${className}`}
      style={containerStyle}
    >
      <div className={contentClassName}>
        {children}
      </div>
    </div>
  );
}

/**
 * Hook for keyboard-aware input handling
 * Provides methods to scroll inputs into view when focused
 */
export function useIOSKeyboardAware() {
  const keyboardPro = useIOSKeyboardPro();
  
  const handleInputFocus = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (!keyboardPro.isNativeIOSApp) return;
    
    setTimeout(() => {
      keyboardPro.scrollInputToCenter(e.target);
    }, 50);
  };

  return {
    isNativeIOS: keyboardPro.isNativeIOSApp,
    ...keyboardPro,
    handleInputFocus,
  };
}

export default IOSKeyboardAwareContainer;
