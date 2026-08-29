import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Capacitor } from '@capacitor/core';

interface SplashScreenProps {
  onVisibilityChange?: (isVisible: boolean) => void;
}

export function SplashScreen({ onVisibilityChange }: SplashScreenProps) {
  // On native platforms, don't show web splash screen - use native only
  const isNative = Capacitor.isNativePlatform();
  const [show, setShow] = useState(!isNative); // Only show on web platforms
  const [imageLoaded, setImageLoaded] = useState(false);

  // Preload the splash image for smoother experience
  useEffect(() => {
    if (!isNative) {
      const img = new Image();
      img.onload = () => setImageLoaded(true);
      img.src = "/assets/Photoroom_20250223_190416.jpeg";
    }
  }, [isNative]);

  useEffect(() => {
    if (isNative) {
      // On native platforms, immediately hide this component and rely on native splash
      setShow(false);
      onVisibilityChange?.(false);
      return;
    }

    // Web platform: Show animated splash screen
    const hasLoadedThisSession = sessionStorage.getItem('hasLoadedApp');

    if (hasLoadedThisSession) {
      // If already loaded this session, immediately hide
      setShow(false);
      onVisibilityChange?.(false);
    } else {
      // Only show animation for first load
      const timer = setTimeout(() => {
        setShow(false);
        onVisibilityChange?.(false);
        sessionStorage.setItem('hasLoadedApp', 'true'); // Set flag after timeout
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [onVisibilityChange, isNative]);

  return (
    <AnimatePresence mode="wait">
      {show && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ 
            opacity: 0,
            scale: 0.95,
            transition: { duration: 0.4, ease: "easeInOut" }
          }}
          className="splash-container bg-white dark:bg-gray-950"
          style={{
            // iOS safe area handling for notched devices
            paddingTop: 'env(safe-area-inset-top, 0px)',
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            paddingLeft: 'env(safe-area-inset-left, 0px)',
            paddingRight: 'env(safe-area-inset-right, 0px)'
          }}
        >
          <motion.img 
            initial={{ scale: 0.3, opacity: 0, y: -10 }}
            animate={{ 
              scale: imageLoaded ? 1 : 0.3, 
              opacity: imageLoaded ? 1 : 0, 
              y: imageLoaded ? 0 : -10,
              transition: { 
                duration: imageLoaded ? 0.6 : 0, 
                ease: "easeOut",
                type: "spring",
                stiffness: 100,
                damping: 15
              }
            }}
            exit={{
              scale: 1.1,
              opacity: 0,
              transition: { duration: 0.3, ease: "easeIn" }
            }}
            src="/assets/Photoroom_20250223_190416.jpeg"
            alt="Referral Logo"
            className="splash-logo"
            onLoad={() => setImageLoaded(true)}
          />
          <motion.h1
            initial={{ y: 30, opacity: 0 }}
            animate={{ 
              y: 0, 
              opacity: 1,
              transition: { 
                delay: 0.2, 
                duration: 0.5, 
                ease: "easeOut"
              }
            }}
            exit={{
              y: -10,
              opacity: 0,
              transition: { duration: 0.3, ease: "easeIn" }
            }}
            className="splash-title text-primary"
          >
            Referral
          </motion.h1>
        </motion.div>
      )}
    </AnimatePresence>
  );
}