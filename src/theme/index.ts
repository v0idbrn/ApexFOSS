/**
 * Design tokens — the JS mirror of tailwind.config.js (single palette, D-032).
 * Canonical six colors: NIGHT RIDER #020101, AUBERGINE #3D0B0D,
 * MAHOGANY #53080E, DARK BURGUNDY #72090F, POHUTUKAWA #930510,
 * ROOF TERRACOTTA #B21F29.
 *
 * Documented accessibility exceptions (no palette color is light enough
 * for AA text, so neutral/tinted values are used for readability):
 * - fg/dim: neutral light grays for body/muted text (WCAG contrast).
 * - accent-ink: light tint of the ROOF TERRACOTTA hue, >= 4.5:1 on bg,
 *   surface and surface-2 (accent itself is only 3.1:1 — fills/borders).
 * - danger: light tint of the same red hue (7.5:1) for error text.
 * - success (Phase 2L): restrained green state hue for completion feedback
 *   (>= 4.5:1 on bg) — the palette has no positive-state hue; the red
 *   identity stays for primary surfaces and actions.
 * - warning (Phase 2L): amber advisory hue (>= 4.5:1 on bg) for integrity
 *   warnings and attention states.
 * - muted (Phase 2L): one step below dim for de-emphasized captions
 *   (still >= 4.5:1 on bg).
 * - QR modules stay pure black/white for scanner contrast (QrGrid.tsx).
 *
 * Phase 2L semantic layer: `theme.semantic` centralizes UI roles
 * (background, surface, elevated, border, primary, pressed, secondary,
 * success, warning, destructive, text*, disabled, focus) as aliases of the
 * colors above — screens should prefer semantic roles when expressing
 * intent, and raw palette keys when applying the identity itself.
 */
export const theme = {
  colors: {
    bg: '#020101',
    surface: '#3D0B0D',
    surface2: '#53080E',
    border: '#72090F',
    accent: '#B21F29',
    accentMuted: '#930510',
    accentInk: '#E3675F',
    text: '#F5F5F5',
    dim: '#A3A3A3',
    danger: '#F87171',
    success: '#79D6A8',
    warning: '#F0B35C',
    muted: '#8A8A8A',
  },
  /**
   * Semantic roles (Phase 2L design system 2.0). Every value is an alias of
   * a pinned color above — no new hex literals live here, so the palette
   * test remains the single source of truth.
   */
  semantic: {
    background: '#020101', // bg
    surface: '#3D0B0D', // default card surface
    elevated: '#53080E', // surface2 — raised/secondary surfaces
    border: '#72090F', // hairlines and card outlines
    primary: '#B21F29', // primary action fill
    pressed: '#930510', // pressed/active primary fill
    secondary: '#3D0B0D', // tonal secondary action fill
    success: '#79D6A8', // completion / positive state
    warning: '#F0B35C', // advisory / integrity warning
    destructive: '#F87171', // destructive action ink/fill tint
    textPrimary: '#F5F5F5', // primary text
    textSecondary: '#A3A3A3', // secondary text
    textMuted: '#8A8A8A', // de-emphasized captions
    disabled: '#A3A3A3', // disabled ink — pair with opacity-50
    focus: '#E3675F', // focus rings / input focus border
  },
  touch: {
    minTarget: 48,
  },
  /**
   * Typographic roles (Phase 2J, extended Phase 2L) — JS mirror of
   * tailwind.config.js fontSize. `metric*` roles are intended for
   * font-mono training numbers (weight, reps, timer, volume, PR values)
   * so numerics stay visually powerful.
   */
  type: {
    display: 34,
    title: 22,
    heading: 17,
    cardTitle: 16,
    body: 15,
    label: 13,
    caption: 13,
    overline: 11,
    metricXl: 36,
    metricLg: 26,
    metric: 18,
    // Legacy keys kept for existing callers.
    number: 32,
    small: 13,
  },
} as const;
