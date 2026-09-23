/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.tsx', './index.ts', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        bg: '#000000',
        surface: '#0a0a0a',
        'surface-2': '#141414',
        line: '#262626',
        fg: '#f5f5f5',
        dim: '#a3a3a3',
        accent: '#22d3ee',
        danger: '#f87171',
        success: '#4ade80',
      },
    },
  },
  plugins: [],
};
