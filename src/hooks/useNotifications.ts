import { useState, useCallback } from 'react';
import toast from 'react-hot-toast';

export function useNotifications() {
  const [permission, setPermission] = useState<NotificationPermission>(
    'Notification' in window ? Notification.permission : 'denied'
  );

  const requestPermission = useCallback(async () => {
    if (!('Notification' in window)) return 'denied' as NotificationPermission;
    const result = await Notification.requestPermission();
    setPermission(result);
    return result;
  }, []);

  const notify = useCallback(
    async (title: string, body: string, options?: NotificationOptions & { type?: 'success' | 'error' | 'warning' }) => {
      // In-app toast always
      const type = options?.type ?? 'success';
      if (type === 'error') toast.error(`${title}: ${body}`);
      else if (type === 'warning') toast(`${title}: ${body}`, { icon: '⚠️' });
      else toast.success(`${title}: ${body}`);

      // Browser notification if permitted
      if (permission === 'granted') {
        try {
          new Notification(title, {
            body,
            icon: '/favicon.svg',
            badge: '/favicon.svg',
            tag: title,
            ...options,
          });
        } catch {
          // Notifications blocked
        }
      }
    },
    [permission]
  );

  const notifyEmergency = useCallback(
    (message: string) => notify('🚨 EMERGENCY ALERT', message, { type: 'error' }),
    [notify]
  );

  const notifyInfo = useCallback(
    (title: string, message: string) => notify(title, message, { type: 'success' }),
    [notify]
  );

  return { permission, requestPermission, notify, notifyEmergency, notifyInfo };
}
