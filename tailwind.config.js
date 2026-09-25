/**
 * ApexFOSS canonical six-color palette (docs/DECISIONS.md D-032):
 *   NIGHT RIDER #020101 · AUBERGINE #3D0B0D · MAHOGANY #53080E
 *   DARK BURGUNDY #72090F · POHUTUKAWA #930510 · ROOF TERRACOTTA #B21F29
 * Semantic tokens below map those colors onto UI roles. `accent-ink`,
 * `fg`, `dim` and `danger` are documented accessibility necessities
 * (tints/neutral) — see src/theme/index.ts for contrast rationale.
 * QR rendering intentionally stays pure black/white (scanner contrast).
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.tsx', './index.ts', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
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
        success: '#F5F5F5',
      },
    },
  },
  plugins: [],
};
