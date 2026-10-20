import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.forknight.app',
  appName: 'Forknight',
  webDir: 'dist',
  // Bundled mode — ships the built dist/ folder inside the app
  // No network dependency for the app shell
  server: {
    // Deep links from magic link emails open back in the app
    iosScheme: 'https',
    androidScheme: 'https',
    hostname: 'forknight.app',
    allowNavigation: [
      'forknight.app',
      '*.supabase.co',
      'fonts.googleapis.com',
      'fonts.gstatic.com',
    ],
  },
  ios: {
    // Matches your Apple Developer team once enrolled
    scheme: 'Forknight',
    contentInset: 'automatic',
    // Allows Supabase magic link redirects back into the app
    allowsLinkPreview: false,
    scrollEnabled: false, // React handles all scrolling
  },
  plugins: {
    // Native haptics — replaces navigator.vibrate() for iOS
    Haptics: {},
    // Status bar styling to match app theme
    StatusBar: {
      style: 'Default',
      backgroundColor: '#EDEEE8',
    },
    // Keyboard plugin — prevents viewport resize on keyboard show
    Keyboard: {
      resize: 'none',
      resizeOnFullScreen: false,
    },
    // Push notifications — for future household invite alerts
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
