import * as fs from 'fs';
import * as path from 'path';
import { theme } from '../theme';

/**
 * Palette pinning + accessibility (spec section 1, D-032).
 * Six canonical colors only; exceptions must stay documented and numeric.
 */

const PALETTE: Record<string, string> = {
  bg: '#020101', // NIGHT RIDER
  surface: '#3D0B0D', // AUBERGINE
  surface2: '#53080E', // MAHOGANY
  border: '#72090F', // DARK BURGUNDY
  accent: '#B21F29', // ROOF TERRACOTTA
  accentMuted: '#930510', // POHUTUKAWA
};

const DOCUMENTED_EXCEPTIONS: Record<string, string> = {
  accentInk: '#E3675F', // light tint of accent hue (readability)
  danger: '#F87171', // light tint of red hue (errors)
  text: '#F5F5F5', // neutral body text
  dim: '#A3A3A3', // neutral muted text
  success: '#F5F5F5', // neutral (no positive hue in palette)
};

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

describe('canonical six-color palette (D-032)', () => {
  it('theme tokens are exactly the six palette colors plus documented exceptions', () => {
    expect(theme.colors).toEqual({ ...PALETTE, ...DOCUMENTED_EXCEPTIONS });
  });

  it('palette values match the approved hex codes exactly', () => {
    expect(theme.colors.bg).toBe('#020101');
    expect(theme.colors.surface).toBe('#3D0B0D');
    expect(theme.colors.surface2).toBe('#53080E');
    expect(theme.colors.border).toBe('#72090F');
    expect(theme.colors.accent).toBe('#B21F29');
    expect(theme.colors.accentMuted).toBe('#930510');
  });

  it('tailwind config carries the same palette + exceptions', () => {
    const cfg = fs.readFileSync(path.join(__dirname, '../../tailwind.config.js'), 'utf8');
    for (const hex of [...Object.values(PALETTE), ...Object.values(DOCUMENTED_EXCEPTIONS)]) {
      expect(cfg).toContain(hex);
    }
  });
});

describe('contrast floors (WCAG 2.1 AA)', () => {
  it('body text on the dominant background is at least 7:1', () => {
    expect(contrast(theme.colors.text, theme.colors.bg)).toBeGreaterThanOrEqual(7);
  });

  it('accent-ink text is readable on bg, surface and surface-2', () => {
    expect(contrast(theme.colors.accentInk, theme.colors.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme.colors.accentInk, theme.colors.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme.colors.accentInk, theme.colors.surface2)).toBeGreaterThanOrEqual(4.5);
  });

  it('muted text and danger text clear 4.5:1 on bg', () => {
    expect(contrast(theme.colors.dim, theme.colors.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme.colors.danger, theme.colors.bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('primary button label clears 4.5:1 on the accent fill', () => {
    expect(contrast(theme.colors.text, theme.colors.accent)).toBeGreaterThanOrEqual(4.5);
  });

  it('accent fill is at least 3:1 against bg (non-text UI)', () => {
    expect(contrast(theme.colors.accent, theme.colors.bg)).toBeGreaterThanOrEqual(3);
  });

  it('borders and elevation steps are visible against the background', () => {
    expect(contrast(theme.colors.border, theme.colors.bg)).toBeGreaterThanOrEqual(1.4);
    expect(contrast(theme.colors.accentMuted, theme.colors.bg)).toBeGreaterThanOrEqual(1.4);
    expect(contrast(theme.colors.surface, theme.colors.bg)).toBeGreaterThanOrEqual(1.15);
    expect(contrast(theme.colors.surface2, theme.colors.bg)).toBeGreaterThanOrEqual(1.2);
  });

  it('accent-muted can carry light banner text', () => {
    expect(contrast(theme.colors.text, theme.colors.accentMuted)).toBeGreaterThanOrEqual(7);
  });
});
