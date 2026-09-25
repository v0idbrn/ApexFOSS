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
 * - success: neutral (palette has no positive-state hue); completion is
 *   conveyed by weight/label, not color.
 * - QR modules stay pure black/white for scanner contrast (QrGrid.tsx).
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
    success: '#F5F5F5',
  },
  touch: {
    minTarget: 48,
  },
  type: {
    display: 40,
    number: 32,
    title: 20,
    body: 16,
    small: 13,
  },
} as const;
