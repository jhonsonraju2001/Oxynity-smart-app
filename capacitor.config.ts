import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.oxynity.smart',
  appName: 'Oxynity Smart',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  },
  plugins: {
    LocalNotifications: {
      // smallIcon / sound removed: those files are not in the app (add res/drawable/ic_stat_*.png and res/raw/beep.wav to use them)
      iconColor: '#0284C7',
    },
  },
};

export default config;
