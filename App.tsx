import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme } from './src/components/ui';
import { AppLock } from './src/components/AppLock';
import { darkTheme, lightTheme, type } from './src/theme';
import { useStore } from './src/store';
import { HomeScreen } from './src/screens/HomeScreen';
import { BudgetScreen } from './src/screens/BudgetScreen';
import { TransactionsScreen } from './src/screens/TransactionsScreen';
import { ReportsScreen } from './src/screens/ReportsScreen';
import { MoreScreen } from './src/screens/MoreScreen';

const TABS = [
  { key: 'home', label: 'Home', icon: '🏠' },
  { key: 'budget', label: 'Budget', icon: '✉️' },
  { key: 'transactions', label: 'Activity', icon: '🧾' },
  { key: 'reports', label: 'Reports', icon: '📊' },
  { key: 'more', label: 'More', icon: '⚙️' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

function TabBar({ active, onSelect }: { active: TabKey; onSelect: (k: TabKey) => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        flexDirection: 'row', backgroundColor: t.surface,
        borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border,
        paddingBottom: Math.max(insets.bottom, 8), paddingTop: 8,
      }}
    >
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onSelect(tab.key)}
            style={{ flex: 1, alignItems: 'center', gap: 2 }}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
          >
            <Text style={{ fontSize: 20, opacity: isActive ? 1 : 0.45 }}>{tab.icon}</Text>
            <Text
              style={[
                type.tiny,
                { color: isActive ? t.accent : t.inkMuted, fontWeight: isActive ? '700' : '500' },
              ]}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Main() {
  const [tab, setTab] = useState<TabKey>('home');
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: t.plane, paddingTop: insets.top }}>
      <View style={{ flex: 1 }}>
        {tab === 'home' && <HomeScreen onGoToTab={(k) => setTab(k as TabKey)} />}
        {tab === 'budget' && <BudgetScreen />}
        {tab === 'transactions' && <TransactionsScreen />}
        {tab === 'reports' && <ReportsScreen />}
        {tab === 'more' && <MoreScreen />}
      </View>
      <TabBar active={tab} onSelect={setTab} />
    </View>
  );
}

export default function App() {
  const system = useColorScheme();
  const mode = useStore((s) => s.settings.themeMode);
  const theme = useMemo(() => {
    const dark = mode === 'dark' || (mode === 'system' && system === 'dark');
    return dark ? darkTheme : lightTheme;
  }, [mode, system]);

  return (
    <SafeAreaProvider>
      <ThemeProvider value={theme}>
        <StatusBar style={theme.dark ? 'light' : 'dark'} />
        <AppLock>
          <Main />
        </AppLock>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
