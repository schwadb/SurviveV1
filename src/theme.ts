// Design tokens. Chart colors follow the validated reference palette:
// categorical slots are assigned in fixed order (never cycled), status
// colors are reserved for budget states and never used as series colors.

export interface Theme {
  dark: boolean;
  surface: string; // chart/card surface
  plane: string; // page background
  inkPrimary: string;
  inkSecondary: string;
  inkMuted: string;
  gridline: string;
  baseline: string;
  border: string;
  accent: string; // primary action color (categorical slot 1 blue)
  accentSoft: string;
  good: string;
  warning: string;
  serious: string;
  critical: string;
  goodText: string;
  series: string[]; // categorical slots 1-8, fixed order
}

export const lightTheme: Theme = {
  dark: false,
  surface: '#fcfcfb',
  plane: '#f9f9f7',
  inkPrimary: '#0b0b0b',
  inkSecondary: '#52514e',
  inkMuted: '#898781',
  gridline: '#e1e0d9',
  baseline: '#c3c2b7',
  border: 'rgba(11,11,11,0.10)',
  accent: '#2a78d6',
  accentSoft: '#cde2fb',
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
  goodText: '#006300',
  series: ['#2a78d6', '#1baf7a', '#eda100', '#008300', '#4a3aa7', '#e34948', '#e87ba4', '#eb6834'],
};

export const darkTheme: Theme = {
  dark: true,
  surface: '#1a1a19',
  plane: '#0d0d0d',
  inkPrimary: '#ffffff',
  inkSecondary: '#c3c2b7',
  inkMuted: '#898781',
  gridline: '#2c2c2a',
  baseline: '#383835',
  border: 'rgba(255,255,255,0.10)',
  accent: '#3987e5',
  accentSoft: '#104281',
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
  goodText: '#0ca30c',
  series: ['#3987e5', '#199e70', '#c98500', '#008300', '#9085e9', '#e66767', '#d55181', '#d95926'],
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const type = {
  hero: { fontSize: 34, fontWeight: '700' as const },
  title: { fontSize: 22, fontWeight: '700' as const },
  heading: { fontSize: 17, fontWeight: '600' as const },
  body: { fontSize: 15, fontWeight: '400' as const },
  caption: { fontSize: 13, fontWeight: '400' as const },
  tiny: { fontSize: 11, fontWeight: '500' as const },
};
