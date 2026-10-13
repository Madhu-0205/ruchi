import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ruchi.ruchi',
  appName: 'ruchi',
  webDir: 'public',
  server: {
    url: 'https://ruchi-sage.vercel.app',
    // Bundled fallback (public/offline.html): shown by the Android WebView
    // when the remote app cannot be reached, instead of a blank error page.
    // The retry link inside offline.html must match `url` above.
    errorPath: 'offline.html',
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
