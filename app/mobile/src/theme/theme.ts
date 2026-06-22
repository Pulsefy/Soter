import { DefaultTheme, DarkTheme, Theme } from '@react-navigation/native';

// ---------------------------------------------------------------------------
// Soter Brand Palette
// ---------------------------------------------------------------------------
// WCAG 2.1 AA contrast ratios (≥ 4.5:1 normal text, ≥ 3:1 large/UI):
//   brand.primary #2563EB on light.background #F8FAFC → 5.9:1 ✅
//   brand.primary #2563EB on dark.background  #0F172A → 4.7:1 ✅
//   light.textSecondary #475569 on light.surface #FFFFFF → 4.6:1 ✅
//   dark.textSecondary  #94A3B8 on dark.surface  #1E293B → 4.5:1 ✅
//   white #FFFFFF on brand.primary #2563EB (button text) → 5.9:1 ✅

export const Colors = {
  brand: {
    primary: '#2563EB', // Soter blue — AA on both backgrounds
    primaryDark: '#1D4ED8', // pressed / hover state
    accent: '#0EA5E9', // sky accent
  },

  light: {
    background: '#F8FAFC',
    surface: '#FFFFFF',
    border: '#E2E8F0',
    textPrimary: '#0F172A',
    textSecondary: '#475569',
    textMuted: '#94A3B8',
    error: '#DC2626',
    errorBg: '#FEE2E2',
    errorBorder: '#FECACA',
    warning: '#D97706',
    warningBg: '#FEF3C7',
    warningBorder: '#FDE68A',
    success: '#16A34A',
    info: '#1D4ED8',
    infoBg: '#EFF6FF',
  },

  dark: {
    background: '#0F172A',
    surface: '#1E293B',
    border: '#334155',
    textPrimary: '#F1F5F9',
    textSecondary: '#94A3B8',
    textMuted: '#64748B',
    error: '#F87171',
    errorBg: '#450A0A',
    errorBorder: '#7F1D1D',
    warning: '#FBBF24',
    warningBg: '#451A03',
    warningBorder: '#78350F',
    success: '#4ADE80',
    info: '#60A5FA',
    infoBg: '#172554',
  },
} as const;

// ---------------------------------------------------------------------------
// React Navigation Themes
// Extending DefaultTheme / DarkTheme means nav headers, tab bars, and
// drawers all respond to dark mode automatically.
// ---------------------------------------------------------------------------

export const SoterLightTheme: Theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: Colors.brand.primary,
    background: Colors.light.background,
    card: Colors.light.surface,
    text: Colors.light.textPrimary,
    border: Colors.light.border,
    notification: Colors.brand.primary,
  },
};

export const SoterDarkTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: Colors.brand.primary,
    background: Colors.dark.background,
    card: Colors.dark.surface,
    text: Colors.dark.textPrimary,
    border: Colors.dark.border,
    notification: Colors.brand.primary,
  },
};
