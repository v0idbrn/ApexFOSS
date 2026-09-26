/**
 * ApexFOSS canonical six-color palette (docs/DECISIONS.md D-032):
 *   NIGHT RIDER #020101 → AUBERGINE #3D0B0D → MAHOGANY #53080E
 *   DARK BURGUNDY #72090F → POHUTUKAWA #930510 → ROOF TERRACOTTA #B21F29
 * Semantic tokens below map those colors onto UI roles. `accent-ink`,
 * `fg`, `dim`, `danger` and the Phase 2L state hues (`success`, `warning`,
 * `muted`) are documented accessibility necessities (tints/neutral) —
 * see src/theme/index.ts for contrast rationale.
 * QR rendering intentionally stays pure black/white (scanner contrast).
 *
 * Phase 2L: the `background/surface/elevated/border/primary/pressed/
 * secondary/destructive/focus/text-*` names are semantic aliases of the
 * same hexes (mirrored by theme.semantic) so screens can express intent
 * without inventing new colors.
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.tsx', './index.ts', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // Pinned palette + documented exceptions (D-032 + Phase 2L).
        bg: '#020101',
        surface: '#3D0B0D',
        'surface-2': '#53080E',
        line: '#72090F',
        accent: '#B21F29',
        'accent-muted': '#930510',
        'accent-ink': '#E3675F',
        fg: '#F5F5F5',
        dim: '#A3A3A3',
        danger: '#F87171',
        success: '#79D6A8',
        warning: '#F0B35C',
        muted: '#8A8A8A',
        // Semantic aliases (Phase 2L design system 2.0).
        background: '#020101',
        elevated: '#53080E',
        border: '#72090F',
        primary: '#B21F29',
        pressed: '#930510',
        secondary: '#3D0B0D',
        destructive: '#F87171',
        focus: '#E3675F',
        'text-primary': '#F5F5F5',
        'text-secondary': '#A3A3A3',
        'text-muted': '#8A8A8A',
      },
      /**
       * Typographic roles (Phase 2J premium design system). Sizes pair with
       * line-height + default weight so every usage lands consistently.
       * Numeric roles are intended for font-mono training numbers.
       */
      fontSize: {
        display: ['2.125rem', { lineHeight: '2.5rem', fontWeight: '700' }], // 34/40
        title: ['1.375rem', { lineHeight: '1.75rem', fontWeight: '700' }], // 22/28
        heading: ['1.0625rem', { lineHeight: '1.5rem', fontWeight: '600' }], // 17/24
        'card-title': ['1rem', { lineHeight: '1.375rem', fontWeight: '600' }], // 16/22
        body: ['0.9375rem', { lineHeight: '1.375rem' }], // 15/22
        label: ['0.8125rem', { lineHeight: '1.125rem', fontWeight: '600' }], // 13/18
        caption: ['0.8125rem', { lineHeight: '1.125rem' }], // 13/18
        overline: ['0.6875rem', { lineHeight: '1rem', fontWeight: '600', letterSpacing: '0.08em' }], // 11/16
        'metric-xl': ['2.25rem', { lineHeight: '2.625rem', fontWeight: '700' }], // 36/42
        'metric-lg': ['1.625rem', { lineHeight: '2rem', fontWeight: '700' }], // 26/32
        metric: ['1.125rem', { lineHeight: '1.5rem', fontWeight: '600' }], // 18/24
      },
    },
  },
  plugins: [],
};
