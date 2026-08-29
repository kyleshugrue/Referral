import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.professionalnetwork.app',
  appName: 'Professional Network',
  webDir: 'dist/public',
  // NO server URL - loads from local dist/public for fast development
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000, // Shorter for development
      launchAutoHide: true, // Auto-hide for faster testing
      backgroundColor: "#ffffffff",
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
      androidSpinnerStyle: "large",
      iosSpinnerStyle: "small",
      spinnerColor: "#999999",
      splashFullScreen: true,
      splashImmersive: true,
      layoutName: "launch_screen",
      useDialog: false,
    },
    App: {
      // Handle deep links and app state
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#ffffff'
    },
    Camera: {
      permissions: ['camera', 'photos']
    },
    Filesystem: {
      permissions: ['readExternalStorage', 'writeExternalStorage']
    },
    Keyboard: {
      resize: 'ionic',
      resizeOnFullScreen: true,
      style: 'light'
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"]
    },
    FirebaseMessaging: {
      presentationOptions: ["badge", "sound", "alert"]
    }
  },
  ios: {
    scheme: 'Professional Network'
  },
  android: {
    allowMixedContent: true // Development only
  }
};

export default config;
