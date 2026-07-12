import React, { createContext, useContext, ReactNode } from 'react';
import {
  Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, ViewStyle, TextStyle,
} from 'react-native';
import { Theme, lightTheme, spacing, type } from '../theme';
import { fmt } from '../utils/money';

const ThemeContext = createContext<Theme>(lightTheme);
export const ThemeProvider = ThemeContext.Provider;
export const useTheme = () => useContext(ThemeContext);

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: t.surface, borderRadius: 16, padding: spacing.lg,
          borderWidth: StyleSheet.hairlineWidth, borderColor: t.border,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function SectionHeader({ title, right }: { title: string; right?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={styles.sectionHeader}>
      <Text style={[type.heading, { color: t.inkPrimary }]}>{title}</Text>
      {right}
    </View>
  );
}

export function Label({ children, style }: { children: ReactNode; style?: TextStyle }) {
  const t = useTheme();
  return <Text style={[type.caption, { color: t.inkSecondary }, style]}>{children}</Text>;
}

export function Amount({
  cents, size = 'body', colorize = false, sign = false, style,
}: {
  cents: number; size?: keyof typeof type; colorize?: boolean; sign?: boolean; style?: TextStyle;
}) {
  const t = useTheme();
  const color = colorize ? (cents < 0 ? t.critical : t.goodText) : t.inkPrimary;
  return (
    <Text style={[type[size], { color, fontVariant: ['tabular-nums'] }, style]}>
      {fmt(cents, { sign })}
    </Text>
  );
}

/** Budget progress bar; over-budget shows the reserved critical status color. */
export function ProgressBar({
  fraction, color, height = 8,
}: { fraction: number; color: string; height?: number }) {
  const t = useTheme();
  const clamped = Math.max(0, Math.min(1, fraction));
  const over = fraction > 1;
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: t.gridline, overflow: 'hidden' }}>
      <View
        style={{
          width: `${clamped * 100}%`, height: '100%',
          borderRadius: height / 2, backgroundColor: over ? t.critical : color,
        }}
      />
    </View>
  );
}

export function Pill({
  label, active, onPress, tone,
}: { label: string; active?: boolean; onPress?: () => void; tone?: 'critical' | 'good' | 'warning' }) {
  const t = useTheme();
  const toneColor = tone === 'critical' ? t.critical : tone === 'good' ? t.good : tone === 'warning' ? t.warning : t.accent;
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: 999,
        backgroundColor: active ? toneColor : t.plane,
        borderWidth: StyleSheet.hairlineWidth, borderColor: active ? toneColor : t.border,
      }}
    >
      <Text style={[type.tiny, { color: active ? '#fff' : t.inkSecondary }]}>{label}</Text>
    </Pressable>
  );
}

export function Button({
  title, onPress, variant = 'primary', disabled,
}: { title: string; onPress: () => void; variant?: 'primary' | 'ghost' | 'danger'; disabled?: boolean }) {
  const t = useTheme();
  const bg = variant === 'primary' ? t.accent : variant === 'danger' ? t.critical : 'transparent';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.75 : 1,
        paddingVertical: 12, paddingHorizontal: spacing.lg, borderRadius: 12, alignItems: 'center',
        borderWidth: variant === 'ghost' ? StyleSheet.hairlineWidth : 0, borderColor: t.border,
      })}
    >
      <Text style={[type.heading, { color: variant === 'ghost' ? t.accent : '#fff' }]}>{title}</Text>
    </Pressable>
  );
}

export function Field({
  label, value, onChangeText, placeholder, keyboardType, autoFocus, multiline,
}: {
  label: string; value: string; onChangeText: (v: string) => void; placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad'; autoFocus?: boolean; multiline?: boolean;
}) {
  const t = useTheme();
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Label style={{ marginBottom: 4 }}>{label}</Label>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.inkMuted}
        keyboardType={keyboardType}
        autoFocus={autoFocus}
        multiline={multiline}
        style={{
          backgroundColor: t.plane, color: t.inkPrimary, borderRadius: 10,
          paddingHorizontal: spacing.md, paddingVertical: 10, fontSize: 15,
          borderWidth: StyleSheet.hairlineWidth, borderColor: t.border,
          minHeight: multiline ? 100 : undefined, textAlignVertical: multiline ? 'top' : 'center',
        }}
      />
    </View>
  );
}

/** Horizontal chip picker used for category/account selection in forms. */
export function ChipPicker<T extends { id: string }>({
  items, selectedId, onSelect, labelFor,
}: {
  items: T[]; selectedId: string | null; onSelect: (id: string) => void; labelFor: (item: T) => string;
}) {
  const t = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }}>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        {items.map((item) => {
          const active = item.id === selectedId;
          return (
            <Pressable
              key={item.id}
              onPress={() => onSelect(item.id)}
              style={{
                paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: 999,
                backgroundColor: active ? t.accent : t.plane,
                borderWidth: StyleSheet.hairlineWidth, borderColor: active ? t.accent : t.border,
              }}
            >
              <Text style={[type.caption, { color: active ? '#fff' : t.inkPrimary }]}>{labelFor(item)}</Text>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

/** Bottom sheet style modal for forms. */
export function Sheet({
  visible, onClose, title, children,
}: { visible: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: t.surface, borderColor: t.border }]}>
        <View style={styles.sheetHeader}>
          <Text style={[type.title, { color: t.inkPrimary }]}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={{ color: t.inkMuted, fontSize: 22 }}>✕</Text>
          </Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 520 }}>
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

export function EmptyState({ emoji, title, subtitle }: { emoji: string; title: string; subtitle?: string }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: spacing.xxl }}>
      <Text style={{ fontSize: 40, marginBottom: spacing.sm }}>{emoji}</Text>
      <Text style={[type.heading, { color: t.inkPrimary }]}>{title}</Text>
      {subtitle ? <Label style={{ marginTop: 4, textAlign: 'center' }}>{subtitle}</Label> : null}
    </View>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center' }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: spacing.xl, marginBottom: spacing.sm,
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.xl,
    paddingBottom: spacing.xxl, borderWidth: StyleSheet.hairlineWidth,
  },
  sheetHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: spacing.lg,
  },
});
