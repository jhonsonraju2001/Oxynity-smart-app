import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';

export const ALERT_CHANNEL_ID = 'oxynity_alerts';

/** Initialize high-priority Android notification channel for instant heads-up banners */
export async function initNotificationChannels() {
  if (Capacitor.isNativePlatform()) {
    try {
      await LocalNotifications.createChannel({
        id: ALERT_CHANNEL_ID,
        name: 'Oxynity Pond Alerts',
        description: 'Critical notifications for pond machinery and dissolved oxygen levels',
        importance: 5, // 5 = High / Max priority (heads-up banner and sound on Android)
        visibility: 1, // 1 = Public (shows on lock screen)
        sound: 'beep.wav',
        vibration: true,
        lights: true,
        lightColor: '#0284C7',
      });
      console.log('Oxynity notification channel registered');
    } catch (err) {
      console.warn('Failed to create notification channel:', err);
    }
  }
}

export async function requestNotificationPermission() {
  if (Capacitor.isNativePlatform()) {
    try {
      await initNotificationChannels();
      const status = await LocalNotifications.requestPermissions();
      return status.display === 'granted';
    } catch (err) {
      console.warn('Native notifications permission failed:', err);
    }
  } else if ('Notification' in window) {
    const perm = await Notification.requestPermission();
    return perm === 'granted';
  }
  return false;
}

export async function sendLocalNotification(
  title: string,
  body: string,
  id: number = Math.floor(Math.random() * 100000) + 1
) {
  if (Capacitor.isNativePlatform()) {
    try {
      await LocalNotifications.schedule({
        notifications: [
          {
            title,
            body,
            id,
            channelId: ALERT_CHANNEL_ID,
            sound: 'beep.wav',
            actionTypeId: '',
            extra: null,
            isExactNotification: false,
            isExactMandatory: false,
          },
        ],
      });
    } catch (err) {
      console.warn('Native notification failed:', err);
    }
  } else if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, { body, icon: '/favicon.ico' });
    } catch (err) {
      console.warn('Browser notification failed:', err);
    }
  }
}

