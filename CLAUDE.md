# Survive Budget

Expo SDK 57 / React Native 0.86 / TypeScript strict. Read the versioned Expo docs
at https://docs.expo.dev/versions/v57.0.0/ before adding Expo APIs.

- Money is integer cents everywhere; expenses negative, income positive.
- Pure budget math lives in src/logic/budget.ts — keep screens free of business logic.
- State: zustand + AsyncStorage persistence in src/store.ts.
- Charts are hand-rolled react-native-svg in src/components/charts.tsx; chart colors
  come from the fixed categorical palette in src/theme.ts (never cycle hues, status
  colors reserved for over-budget states).
- Verify with: npx tsc --noEmit, then npx expo export --platform web.
