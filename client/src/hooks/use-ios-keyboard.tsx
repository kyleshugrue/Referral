import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';
import type { PluginListenerHandle } from '@capacitor/core';

/**
 * REBUILT: Clean iOS keyboard handling for registration forms
 * Matches profile page behavior by letting native iOS handle everything
 */
export function useIOSKeyboard() {
  const [isNativeIOSApp, setIsNativeIOSApp] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

  useEffect(() => {
    // Check if we're running in a native iOS Capacitor app
    const isIOS = Capacitor.getPlatform() === 'ios' && Capacitor.isNativePlatform();
    setIsNativeIOSApp(isIOS);
    
    // Add body class for iOS native app styling (required for CSS detection)
    if (isIOS) {
      document.body.classList.add('ios-capacitor-app');
    } else {
      document.body.classList.remove('ios-capacitor-app');
    }

    if (isIOS) {
      // CRITICAL: Configure keyboard to use native iOS behavior like profile page
      const configureIOSKeyboard = async () => {
        try {
          // Configure keyboard for proper body resize behavior
          await Keyboard.setAccessoryBarVisible({ isVisible: false });
          await Keyboard.setScroll({ isDisabled: false });
          // Note: setResizeMode is set in capacitor.config.ts
          console.log('iOS keyboard configured for native behavior');
        } catch (error) {
          console.log('iOS keyboard configuration failed:', error);
        }
      };

      configureIOSKeyboard();

      // Simple keyboard state tracking only - no viewport manipulation
      let keyboardDidShowListener: PluginListenerHandle;
      let keyboardDidHideListener: PluginListenerHandle;

      const setupKeyboardListeners = async () => {
        keyboardDidShowListener = await Keyboard.addListener('keyboardDidShow', (info) => {
          console.log('iOS keyboard shown, height:', info.keyboardHeight);
          setKeyboardHeight(info.keyboardHeight);
          setIsKeyboardVisible(true);
          
          // Add CSS custom property for dynamic keyboard height
          document.documentElement.style.setProperty('--ios-keyboard-height', `${info.keyboardHeight}px`);
          document.body.classList.add('ios-keyboard-visible');
          
          // Minimal smart scroll - only for elements truly blocked by keyboard
          setTimeout(() => {
            const focusedElement = document.activeElement as HTMLElement;
            
            if (focusedElement && (
              focusedElement.tagName === 'INPUT' || 
              focusedElement.tagName === 'TEXTAREA'
            )) {
              // Calculate if element is actually blocked by keyboard
              const rect = focusedElement.getBoundingClientRect();
              const viewportHeight = window.innerHeight;
              const keyboardTop = viewportHeight - info.keyboardHeight;
              const minClearance = 20; // Minimal clearance needed
              
              // Only scroll if element is genuinely blocked
              if (rect.bottom > keyboardTop - minClearance) {
                const scrollAmount = rect.bottom - (keyboardTop - minClearance);
                window.scrollBy({
                  top: scrollAmount,
                  behavior: 'smooth'
                });
              }
            }
          }, 150);
        });

        keyboardDidHideListener = await Keyboard.addListener('keyboardDidHide', () => {
          console.log('iOS keyboard hidden');
          setIsKeyboardVisible(false);
          setKeyboardHeight(0);
          
          // Remove CSS custom property and class
          document.documentElement.style.removeProperty('--ios-keyboard-height');
          document.body.classList.remove('ios-keyboard-visible');
        });
      };

      setupKeyboardListeners();

      // Cleanup listeners on unmount
      return () => {
        if (keyboardDidShowListener) keyboardDidShowListener.remove();
        if (keyboardDidHideListener) keyboardDidHideListener.remove();
      };
    }
  }, []);

  const hideKeyboard = async () => {
    if (isNativeIOSApp) {
      try {
        await Keyboard.hide();
      } catch (error) {
        console.log('Failed to hide iOS keyboard:', error);
      }
    }
  };

  return {
    isNativeIOSApp,
    keyboardHeight,
    isKeyboardVisible,
    hideKeyboard,
  };
}