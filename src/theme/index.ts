/** Design tokens (AMOLED black, high contrast). Mirrors tailwind.config.js. */
export const theme = {
  colors: {
    bg: '#000000',
    surface: '#0a0a0a',
    surface2: '#141414',
    border: '#262626',
    text: '#f5f5f5',
    dim: '#a3a3a3',
    accent: '#22d3ee',
    danger: '#f87171',
    success: '#4ade80',
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
