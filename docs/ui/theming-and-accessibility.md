# UI Theming & Accessibility Guide

This document defines the design rules, implementation touchpoints, dark-mode expectations, and regression-testing practices for all Soter UI work — web (Next.js) and mobile (React Native / Expo).

It is intentionally project-specific: every token, file path, and pitfall referenced here maps to code that already exists in this repository.

---

## 1. Theme Tokens

All colors, spacing, typography, and radii live as **named tokens** — developers must never hardcode hex/rgb values or raw numbers in components.

### 1.1 Color tokens

Colors are defined in two places, one per platform, with identical semantic names so screens stay consistent.

**Web (Next.js / Tailwind v4):**
`app/frontend/src/app/globals.css` (lines 7-38)

```
:root + html.light → light mode
html.dark          → dark mode

CSS custom properties (the source of truth):
  --background      page background  (#ffffff / #0f172a)
  --foreground      primary text     (#111827 / #f1f5f9)
  --nav-background  nav/surface bar  (#ffffff / #1e293b)
  --nav-foreground  nav primary text (#111827 / #f1f5f9)
  --nav-border      nav divider      (#e5e7eb / #334155)

Exposed to Tailwind via @theme inline:
  --color-background → bg-background
  --color-foreground → text-foreground

The .aid-marker* classes and their hex colors (#2563eb, #38bdf8,
#22c55e, #f59e0b, #0ea5e9, #ef4444) are the ONLY exceptions — they
target SVG/Leaflet markers in map popups, not text or UI surfaces.
```

**Mobile (React Native / Expo):**
`app/mobile/src/theme/theme.ts` (lines 13-55), const `Colors`

```
Colors.brand.primary      = #2563EB  (Soter blue)
Colors.brand.primaryDark  = #1D4ED8  (pressed/hover state)
Colors.brand.accent       = #0EA5E9  (sky accent)

Colors.light / Colors.dark share this shape:
  background     page background
  surface        cards / modals
  border         dividers
  textPrimary    primary body text
  textSecondary  subtitles / supporting text
  textMuted      disabled / placeholder text
  error  errorBg  errorBorder     (danger state)
  warning warningBg warningBorder (warn state)
  success                                   (success state)
  info infoBg                             (info state)
```

### 1.2 Spacing

Web: Tailwind's default spacing scale (`p-0`…`p-96`, `gap-1`…`gap-20`, etc.) consumed via class names. Do **not** use raw `padding: 13px` or similar — stick to Tailwind tokens.

Mobile: No fixed scale is enforced today; prefer step sizes of 4 (e.g. 8, 12, 16, 20, 24) so components align with the web platform. If a reusable scale is added later, it must be exported from `app/mobile/src/theme/theme.ts` alongside `Colors`.

### 1.3 Typography

Web: Fonts are loaded in `app/frontend/src/app/layout.tsx` via `next/font/google` and exposed as CSS variables:

```
--font-geist-sans   ← Geist     (body/UI)
--font-geist-mono   ← Geist Mono (code/addresses)
```

Tailwind maps them to `font-sans` / `font-mono` in `globals.css` (line 36-37). Mobile: no platform-wide type tokens yet — keep font weights (`400/500/600/700`) consistent with web and do **not** load custom fonts from assets without a documented performance story.

### 1.4 Border radius

Web: Tailwind scale (`rounded-md`, `rounded-lg`, `rounded-2xl`, `rounded-full`). The global Leaflet popup wrapper uses `rounded: 12px` (`.aid-popup`).

Mobile: Match web at 12 px for card surfaces and map popups (`borderRadius: 12`), 999 px for pills/buttons.

### 1.5 Where tokens are defined — and how to extend them safely

| Concern | File (project-relative) | How to extend |
|---|---|---|
| Web color tokens | `app/frontend/src/app/globals.css` `:root` / `html.dark` / `html.light` blocks | Add the CSS var in all three blocks, then mirror it under `@theme inline` if Tailwind classes need to see it. |
| Web dark-mode fallbacks | Same file, lines 46-194 (the `html.dark [class~=...] :not([class*=dark:...])` rules) | These are remediation for Tailwind utility classes missing their `dark:` pair. If you add a new palette to Tailwind, add a matching rule here BEFORE relying on it. |
| Mobile color tokens | `app/mobile/src/theme/theme.ts` `Colors` object | Extend the `light`/`dark`/`brand` shapes symmetrically — never add a key to only one mode. |
| Mobile React Navigation themes | Same file, `SoterLightTheme` / `SoterDarkTheme` | Always keep both `...Theme` objects in sync with `Colors.light` / `Colors.dark`. Nav headers, tab bars, drawers read from here directly. |
| Global focus ring | `app/frontend/src/app/globals.css` lines 196-202 `:focus-visible { ... }` | Never remove this. Components can override with `focus-visible:ring-*` per-element. |

---

## 2. Dark Mode Expectations

### 2.1 How dark mode works

**Web (Next.js):**
- `app/frontend/src/components/ThemeProvider.tsx` wraps `next-themes` with `attribute="class"`, `defaultTheme="system"`, `storageKey="soter-theme"`.
- Mounted in `app/frontend/src/app/layout.tsx` inside `<NextIntlClientProvider>`.
- `next-themes` toggles the `html.dark` / `html.light` class, which activates the CSS variables in `globals.css`.
- `app/frontend/src/hooks/useTheme.ts` (thin wrapper) exposes `theme`, `resolvedTheme`, `setTheme('light' \| 'dark' \| 'system')` to client components.

**Mobile (React Native):**
- `app/mobile/src/theme/useAppTheme.ts` reads `Appearance.getColorScheme()` and subscribes to changes.
- `app/mobile/src/theme/ThemeContext.tsx` exports `<ThemeProvider>` + `useTheme()` hook.
- `App.tsx` passes `navTheme` (resolved `SoterLightTheme` / `SoterDarkTheme`) into `<NavigationContainer theme={...}>` and flips `<StatusBar style=...>` based on scheme.

### 2.2 Hard rules

1. **No hardcoded colors.** Ever. Not inline styles, not default props, not ternaries that return hex strings.
2. **Always pair a Tailwind utility with its `dark:` variant** unless the remediation block in `globals.css` already covers it. Prefer `bg-surface dark:bg-slate-900 text-slate-900 dark:text-slate-100` over relying on the fallbacks (see §3.3).
3. **Mobile screens must read colors from `const { colors } = useTheme()`.** Never reference `Colors.light.foo` or `Colors.dark.foo` directly outside of `theme.ts` itself.

### 2.3 Correct vs incorrect usage

**✅ Correct (Web)**

```tsx
<div className="bg-surface text-foreground rounded-lg border border-slate-200 dark:border-slate-700 p-6">
  <p className="text-slate-700 dark:text-slate-300">…</p>
</div>
```

**❌ Incorrect (Web)**

```tsx
<div style={{ background: '#fff', color: '#111', borderRadius: 8, padding: 24 }}>
  <p style={{ color: '#374151' }}>…</p>
</div>
```

**✅ Correct (Mobile)**

```tsx
function Card({ children }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.border,
        padding: 24,
        borderRadius: 12,
        borderWidth: 1,
      }}
    >
      <Text style={{ color: colors.textPrimary }}>{children}</Text>
    </View>
  );
}
```

**❌ Incorrect (Mobile)**

```tsx
function Card({ children }) {
  return (
    <View style={{ backgroundColor: '#fff', padding: 24, borderRadius: 12 }}>
      <Text style={{ color: '#0F172A' }}>{children}</Text>
    </View>
  );
}
```

---

## 3. Contrast & Accessibility

### 3.1 Baseline standard

**WCAG 2.1 Level AA** is the floor for every screen shipped in this repo:

| Target | Minimum contrast |
|---|---|
| Normal text (< 18 pt or < 14 pt bold) | 4.5 : 1 |
| Large text (≥ 18 pt or ≥ 14 pt bold)  | 3.0 : 1 |
| UI components / graphical objects      | 3.0 : 1 |

The brand palette in `app/mobile/src/theme/theme.ts` (lines 6-11) lists already-verified ratios:

```
brand.primary #2563EB on light.background → 5.9:1 ✅
brand.primary #2563EB on dark.background  → 4.7:1 ✅
light.textSecondary on light.surface      → 4.6:1 ✅
dark.textSecondary  on dark.surface       → 4.5:1 ✅
white on brand.primary (button text)      → 5.9:1 ✅
```

If you change any token value, re-verify these pairs before merging.

### 3.2 Known pitfalls already observed in the repo

Keep this list in code review. Every item below was found at least once during Soter development.

1. **Hardcoded hex colors in inline styles / `style=` props.**
   - Typically surfaces in: one-off cards, map markers (non-marker UI, not `.aid-marker*`), toast content, disabled states.
   - Catch it with: grepping for `/^#[0-9a-fA-F]{3,8}/` outside the token files in §1.

2. **Low-contrast secondary text on dark surfaces.**
   - Pattern: `text-slate-500` used without `dark:text-slate-400` (or equivalent). In dark mode this drops from 4.5:1 on light to ~2.1:1 on slate-900 — **fails AA**.
   - Remediation in place today: the big `html.dark [class~=...]` fallback block in `globals.css` (lines 46-182). Treat it as a guardrail, not a free pass. Fix the original class instead.

3. **Missing / invisible focus states on interactive elements.**
   - Pattern: `outline-none` or `focus:outline-none` without a replacement `focus-visible:ring-*`.
   - Safe default: the global `:focus-visible` rule (lines 196-202 in `globals.css`) applies a `blue-500` ring at 5.9:1 / 7.2:1 contrast. Override per-component only if you provide an equally-visible alternative.
   - Also check custom checkboxes, toggles, icon-only buttons (they need `aria-label` AND a focus ring), and `<a>` tags styled to look like text.

4. **Broken dark-mode visibility on `text-*-900` + `bg-white` surfaces.**
   - Pattern: component renders `className="bg-white text-gray-900"` without `dark:` variants. Switches to dark → white text on white surface → invisible.
   - Fallback remediations exist (see §2.2 rule 2), but the only real fix is explicit `dark:bg-slate-900 dark:text-slate-100` pairs in the component.

5. **React Native screens reading `Colors.light.*` directly.**
   - `Colors.light.textPrimary` (#0F172A) on dark.background (#0F172A) = **0:1 contrast**, completely invisible.
   - Lint rule: only `theme.ts` itself may dot into `Colors.light` / `Colors.dark`. Screens always go through the `useTheme()` hook.

6. **Form inputs & placeholders in dark mode.**
   - Web inputs get fallback remapping in `globals.css` lines 184-194, but custom styled inputs (comboboxes, date pickers, OTP fields) need explicit dark variants.
   - Mobile: use `colors.textPrimary` + `colors.textMuted` for placeholder, never hardcoded gray.

---

## 4. Implementation Touchpoints

### 4.1 Web (Next.js + Tailwind v4 + next-themes)

| What | Where |
|---|---|
| Theme provider component | `app/frontend/src/components/ThemeProvider.tsx` — wraps `next-themes` provider with `attribute="class"`, `storageKey="soter-theme"`. |
| Provider mount point | `app/frontend/src/app/layout.tsx` root layout, inside `<NextIntlClientProvider>`. |
| Consumer hook for client components | `app/frontend/src/hooks/useTheme.ts` — returns `{ theme, resolvedTheme, setTheme }`. |
| Global CSS + token definition | `app/frontend/src/app/globals.css` — CSS vars, `@theme inline`, dark-mode remediations, focus ring. |
| PostCSS / Tailwind wiring | `app/frontend/postcss.config.mjs` — uses `@tailwindcss/postcss` (Tailwind v4 mode). |
| Component-level theming | Tailwind utility classes + `dark:` variant. Use `text-foreground`, `bg-background`, semantic colors from tokens. |

### 4.2 Mobile (React Native / Expo + React Navigation)

| What | Where |
|---|---|
| Token definition | `app/mobile/src/theme/theme.ts` — `Colors`, `SoterLightTheme`, `SoterDarkTheme`. |
| Scheme hook + resolver | `app/mobile/src/theme/useAppTheme.ts` — `useColorScheme()`, merges `Colors.light`/`dark` with brand. |
| Theme context | `app/mobile/src/theme/ThemeContext.tsx` — `<ThemeProvider>` + `useTheme()` hook. |
| Provider mount point | `app/mobile/App.tsx` root, inside `<SafeAreaProvider>`. |
| Navigation theming | Same `App.tsx`: `<NavigationContainer theme={navTheme}>` + `<StatusBar style>` flip. |
| Screen-level consumption | `const { colors, navTheme, scheme } = useTheme()` at the top of every screen. |

### 4.3 Rules for both platforms

- **Never add a new color without pairing it in both modes** and verifying both AA ratios (§3.1).
- **Never reference `Colors.*` outside the theme layer** on mobile; never reference hex colors outside `globals.css` on the web.
- **New components must render correctly through `<ThemeProvider>` (not just light-mode defaults).** If a component snapshot test exists, add a dark-mode variant.

---

## 5. Regression Practices

Preventing UI breakage during theme work boils down to treating light + dark as **co-equal outputs**, not as an afterthought.

1. **Always view the change in both `light` and `dark` before opening a PR.**
   - Web: toggle via the theme switch (or call `setTheme('dark')` from `useTheme()` in dev tools).
   - Mobile: iOS Simulator → Settings → Developer → Dark Appearance toggle; Android: Settings → Display → Dark theme.

2. **Inspect high-risk surfaces first.**
   - Cards with `bg-white` / `text-gray-*` (pitfall #4).
   - Empty states, skeleton loaders, and disabled button variants.
   - Inputs with placeholders, OTP fields, dropdown popovers (pitfall #6).
   - Toast banners (error / warning / info / success on both modes).

3. **Use the fallbacks block as a code-smell detector.** Any class that only renders correctly because of `html.dark [class~=...] :not([class*=dark:...])` is a bug waiting to happen when Tailwind re-orders classes or a variant changes. Fix the component.

4. **Never edit `globals.css` token values during feature work.** Token changes = separate ticket, separate review, contrast re-check (§3.1 table).

5. **Visual regressions in common components:** If you tweak spacing/radii in `Button`, `Card`, `ToastProvider`, `Navbar`, or `Pagination`, re-run the screenshots in Storybook (if present) or compare the affected screens side-by-side.

---

## 6. Testing Checklist (MANDATORY)

Mark every item on every UI PR. Anything unchecked = not ready to merge.

- [ ] Works in light mode
- [ ] Works in dark mode
- [ ] Text contrast is readable
- [ ] Buttons are visible and accessible
- [ ] Focus/hover states exist
- [ ] No hardcoded colors used
- [ ] Mobile UI matches web behavior

---

## 7. Mobile-Specific Notes

Styling on web and React Native use **different primitives**, but the design rules are identical. Here is the translation table engineers should keep in mind when building both platforms side-by-side.

| Concern | Web (Next.js / Tailwind) | Mobile (React Native / Expo) |
|---|---|---|
| Color source | CSS custom properties + Tailwind classes from `globals.css` | `useTheme().colors` (never `Colors.light` directly) |
| Background / foreground | `bg-background text-foreground` utility classes | `colors.background`, `colors.foreground` in `style={{ }}` |
| Surface card | `bg-surface border rounded-xl shadow-sm` | `backgroundColor: colors.surface`, `borderRadius: 12`, `borderWidth: 1`, `borderColor: colors.border` |
| Dark variants | `dark:bg-slate-900 dark:text-slate-100` pairings; global fallbacks in CSS | Automatic via `useTheme()` if colors are consumed correctly |
| Spacing | Tailwind scale (`gap-4`, `p-6`, etc.) | Multiples of 4 (`8, 12, 16, 20, 24`) |
| Typography | `font-sans`, `font-semibold`, `text-sm / lg / 2xl` | React Native `<Text style={{ fontWeight: '600', fontSize: 14 }}>` — mirror the sizes + weights web uses for the same screen |
| Focus / keyboard | Tailwind `focus-visible:ring-*`; global `:focus-visible` rule in `globals.css` | `accessibilityRole`, `accessibilityLabel`, `accessibilityState={{ disabled }}` on every `<Pressable>` / `<TouchableOpacity>` |
| Nav chrome styling | `<Navbar>` component; reads `--nav-*` CSS vars | `<NavigationContainer theme={navTheme}>`; `navTheme` is resolved from `useAppTheme()` |
| Status / system bars | Browser-controlled | `<StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />` in `App.tsx` |
| Theme change source | `next-themes` + localStorage (`soter-theme`) + OS preference | `Appearance.addChangeListener` + `useColorScheme` — manual toggle tracked in `ThemeContext` if added later |

**Consistency rule:** if a web screen uses `Colors.light.success` green (#16A34A) for a success badge, the mobile screen on the same feature must use `colors.success` from the hook (green in light = #16A34A green variant, in dark = #4ADE80 per `theme.ts`) — never a different hex or a different hue. Maintain semantic parity first; exact visual match second.
