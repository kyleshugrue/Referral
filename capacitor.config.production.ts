import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.professionalnetwork.app',
  appName: 'Professional Network',
  webDir: 'dist/public',
  // PRODUCTION: No server.url = bundle assets locally for instant startup
  // API calls will still go to production server via frontend config
  plugins: {
    SplashScreen: {
      launchShowDuration: 3000,
      launchAutoHide: false,
      backgroundColor: "#ffffff",
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
    // Production settings - no cleartext traffic
    allowMixedContent: false
  }
};

export default config;