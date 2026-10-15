import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PALETTES } from './palette';

type Rgb = [number, number, number];
type Tokens = Record<string, string>;

const css = readFileSync(resolve(process.cwd(), 'src/shared/styles.css'), 'utf8');

function tokensOf(selector: string): Tokens {
  const block = css.split(`\n${selector} {`)[1]?.split('\n}')[0];
  if (!block) throw new Error(`no block for ${selector}`);
  const tokens: Tokens = {};
  for (const [, name, value] of block.matchAll(/--([\w-]+): (.+);/g)) tokens[name!] = value!;
  return tokens;
}

/** The lab's conversion: oklch -> linear sRGB, clipped to gamut. */
function oklchToLinear(value: string): [Rgb, number] {
  const [L, C, H, A = 100] = value.match(/[\d.]+/g)!.map(Number);
  const h = (H! * Math.PI) / 180;
  const a = C! * Math.cos(h);
  const b = C! * Math.sin(h);
  const l = (L! + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L! - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L! - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb: Rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return [rgb.map((v) => Math.min(1, Math.max(0, v))) as Rgb, value.includes('/') ? A / 100 : 1];
}

const luminance = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function contrast(tokens: Tokens, fg: string, bg: string): number {
  const [back] = oklchToLinear(tokens[bg]!);
  const [front, alpha] = oklchToLinear(tokens[fg]!);
  const blended = front.map((v, i) => v * alpha + back[i]! * (1 - alpha)) as Rgb;
  const a = luminance(blended);
  const b = luminance(back);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const TEXT_PAIRS: [string, string][] = [
  ['foreground', 'background'],
  ['foreground', 'card'],
  ['muted-foreground', 'background'],
  ['muted-foreground', 'card'],
  ['muted-foreground', 'muted'],
  ['primary', 'background'],
  ['primary-foreground', 'primary'],
  ['accent-foreground', 'accent'],
  ['income', 'background'],
  ['expense', 'background'],
  ['warning-foreground', 'background'],
];
const CONTROL_PAIRS: [string, string][] = [
  ['input', 'background'],
  ['ring', 'background'],
];

const sets = PALETTES.flatMap((palette) => {
  const light = palette === 'emerald' ? ':root' : `[data-palette='${palette}']`;
  const dark = palette === 'emerald' ? '.dark' : `.dark[data-palette='${palette}']`;
  return [
    { name: `${palette} light`, tokens: tokensOf(light) },
    { name: `${palette} dark`, tokens: { ...tokensOf(light), ...tokensOf(dark) } },
  ];
});

describe.each(sets)('$name', ({ tokens }) => {
  it.each(TEXT_PAIRS)('%s on %s reads at AA (4.5:1)', (fg, bg) => {
    expect(contrast(tokens, fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(CONTROL_PAIRS)('%s on %s stands out at 3:1', (fg, bg) => {
    expect(contrast(tokens, fg, bg)).toBeGreaterThanOrEqual(3);
  });
});
