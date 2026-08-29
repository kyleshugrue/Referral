import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.professionalnetwork.app',
  appName: 'Professional Network',
  webDir: 'dist/public',
  // NO server.url = bundle assets locally for fast startup
  // API calls will still connect to backend via frontend config
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
    SplashScreen: {
      launchShowDuration: 3000, // Show native splash screen for 3 seconds
      launchAutoHide: false, // Don't auto-hide, let app control when to hide
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
      useDialog: false, // Use native iOS launch screen, not web dialog
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
      resize: 'body',
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
    // Enable cleartext traffic for development only
    // Remove allowMixedContent for production
    allowMixedContent: false
  }
};

export default config;