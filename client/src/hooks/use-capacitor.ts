import { useEffect, useState, useCallback, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { Keyboard } from '@capacitor/keyboard';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import type { AppInfo } from '@capacitor/app';

export { ImpactStyle, NotificationType };

export function useCapacitor() {
  const [isNative, setIsNative] = useState(false);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [isAppReady, setIsAppReady] = useState(false);
  const splashHiddenRef = useRef(false);

  useEffect(() => {
    const native = Capacitor.isNativePlatform();
    setIsNative(native);

    const initializeCapacitor = async () => {
      if (native) {
        const info = await App.getInfo();
        setAppInfo(info);

        if (Capacitor.getPlatform() === 'ios') {
          await StatusBar.setStyle({ style: Style.Dark });
        }

        App.addListener('appStateChange', ({ isActive }) => {
          console.log('App state changed. Is active?', isActive);
        });

        App.addListener('backButton', ({ canGoBack }) => {
          if (!canGoBack) {
            App.exitApp();
          } else {
            window.history.back();
          }
        });

        Keyboard.addListener('keyboardWillShow', (info) => {
          document.body.style.paddingBottom = `${info.keyboardHeight}px`;
        });

        Keyboard.addListener('keyboardWillHide', () => {
          document.body.style.paddingBottom = '0px';
        });
      }
    };

    initializeCapacitor();

    return () => {
      if (native) {
        App.removeAllListeners();
        Keyboard.removeAllListeners();
      }
    };
  }, []);

  const hideSplashScreen = useCallback(async () => {
    if (splashHiddenRef.current) return;
    
    if (isNative && Capacitor.getPlatform() === 'ios') {
      try {
        splashHiddenRef.current = true;
        await SplashScreen.hide({ fadeOutDuration: 300 });
        setIsAppReady(true);
        console.log('[Capacitor] Splash screen hidden');
      } catch (error) {
        console.error('[Capacitor] Error hiding splash screen:', error);
      }
    }
  }, [isNative]);

  const hapticFeedback = useCallback(async (style: ImpactStyle = ImpactStyle.Medium) => {
    if (isNative) {
      try {
        await Haptics.impact({ style });
      } catch {
        console.debug('[Capacitor] Haptic feedback not available');
      }
    }
  }, [isNative]);

  const hapticNotification = useCallback(async (type: NotificationType = NotificationType.Success) => {
    if (isNative) {
      try {
        await Haptics.notification({ type });
      } catch {
        console.debug('[Capacitor] Haptic notification not available');
      }
    }
  }, [isNative]);

  const hapticSelection = useCallback(async () => {
    if (isNative) {
      try {
        await Haptics.selectionStart();
        await Haptics.selectionEnd();
      } catch {
        console.debug('[Capacitor] Haptic selection not available');
      }
    }
  }, [isNative]);

  const setStatusBarStyle = useCallback(async (isDarkBackground: boolean) => {
    if (isNative && Capacitor.getPlatform() === 'ios') {
      try {
        await StatusBar.setStyle({ 
          style: isDarkBackground ? Style.Light : Style.Dark 
        });
      } catch {
        console.debug('[Capacitor] Status bar style not available');
      }
    }
  }, [isNative]);

  const setStatusBarColor = useCallback(async (color: string, darkContent = false) => {
    if (isNative && Capacitor.getPlatform() === 'ios') {
      try {
        await StatusBar.setBackgroundColor({ color });
        await StatusBar.setStyle({ 
          style: darkContent ? Style.Dark : Style.Light 
        });
      } catch {
        console.debug('[Capacitor] Status bar color not available');
      }
    }
  }, [isNative]);

  return {
    isNative,
    appInfo,
    isAppReady,
    hideSplashScreen,
    hapticFeedback,
    hapticNotification,
    hapticSelection,
    setStatusBarStyle,
    setStatusBarColor,
    platform: Capacitor.getPlatform(),
  };
}