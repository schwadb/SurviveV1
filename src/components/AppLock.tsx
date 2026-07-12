import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, Text, View } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { useStore } from '../store';
import { type, spacing } from '../theme';
import { Button, useTheme } from './ui';

/** True when this device can enforce the app lock. Always false on web. */
export async function lockAvailable(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    return hasHardware && enrolled;
  } catch {
    return false;
  }
}

/**
 * Gates the app behind Face ID / Touch ID / device passcode when the
 * app-lock setting is on. Locks on cold start and whenever the app
 * returns from the background.
 */
export function AppLock({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  const appLock = useStore((s) => s.settings.appLock ?? false);
  const enforced = appLock && Platform.OS !== 'web';
  const [locked, setLocked] = useState(enforced);
  const [failed, setFailed] = useState(false);
  const authenticating = useRef(false);

  const unlock = useCallback(async () => {
    if (authenticating.current) return;
    authenticating.current = true;
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock Survive Budget',
      });
      if (result.success) {
        setLocked(false);
        setFailed(false);
      } else {
        setFailed(true);
      }
    } finally {
      authenticating.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enforced) {
      setLocked(false);
      return;
    }
    setLocked(true);
    void unlock();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') setLocked(true);
      else if (state === 'active') {
        // Re-prompt when coming back to a locked app.
        setLocked((isLocked) => {
          if (isLocked) void unlock();
          return isLocked;
        });
      }
    });
    return () => sub.remove();
  }, [enforced, unlock]);

  if (!locked) return <>{children}</>;

  return (
    <View
      style={{
        flex: 1, backgroundColor: t.plane, alignItems: 'center',
        justifyContent: 'center', padding: spacing.xl, gap: spacing.md,
      }}
    >
      <Text style={{ fontSize: 44 }}>🔒</Text>
      <Text style={[type.title, { color: t.inkPrimary }]}>Survive Budget is locked</Text>
      <Text style={[type.caption, { color: t.inkSecondary, textAlign: 'center' }]}>
        {failed
          ? 'Authentication failed or was canceled. Try again.'
          : 'Unlock with Face ID, fingerprint, or your device passcode.'}
      </Text>
      <Button title="Unlock" onPress={() => void unlock()} />
    </View>
  );
}
