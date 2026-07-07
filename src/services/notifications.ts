// The only module that touches expo-notifications. Everything is a no-op on
// web (local scheduling is native-only); the planner in src/logic/reminders.ts
// stays pure and testable.
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { ReminderEntry } from '../logic/reminders';

let handlerInstalled = false;

/** Show reminders even when the app is foregrounded. */
function installForegroundHandler() {
  if (handlerInstalled || Platform.OS === 'web') return;
  handlerInstalled = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

export async function ensureNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('bills', {
    name: 'Bill reminders',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

/**
 * Replace all scheduled notifications with the given plan. Cancel-all is
 * safe because bill reminders are the app's only scheduled notifications;
 * if another feature ever schedules its own, switch to per-id tracking.
 */
export async function syncScheduledNotifications(entries: ReminderEntry[]): Promise<void> {
  if (Platform.OS === 'web') return;
  installForegroundHandler();
  await ensureAndroidChannel();
  await Notifications.cancelAllScheduledNotificationsAsync();
  for (const e of entries) {
    const [y, m, d] = e.dateIso.split('-').map(Number);
    await Notifications.scheduleNotificationAsync({
      content: { title: e.title, body: e.body },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        // Build from components — parsing the ISO string would give UTC
        // midnight and shift the local date in negative-offset timezones.
        date: new Date(y, m - 1, d, e.hour, 0, 0),
      },
    });
  }
}

export async function cancelAllReminders(): Promise<void> {
  if (Platform.OS === 'web') return;
  await Notifications.cancelAllScheduledNotificationsAsync();
}
